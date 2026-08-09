import { Duplex } from 'node:stream';
import { connect as netConnect, type Socket } from 'node:net';
import { randomBytes, X509Certificate, verify as cryptoVerify, constants as cryptoConstants } from 'node:crypto';
import { rootCertificates } from 'node:tls';
import { brotliDecompressSync, inflateSync } from 'node:zlib';
import { ByteReader, ByteWriter, concatBytes, hex } from '../util/bytes.js';
import { nonNull } from '../util/assert.js';
import { ContentType, HandshakeType, ExtensionType, TLS_VERSION } from './constants.js';
import { buildClientHello } from './clienthello.js';
import { parseServerHello } from './serverhello.js';
import { generateKeyShares } from './keyexchange.js';
import { generateGrease } from './grease.js';
import { KeySchedule, cipherParams, trafficKeyIv, finishedVerifyData, type CipherParams } from './keyschedule.js';
import { RecordProtection, plaintextRecord, readRecord } from './record.js';
import type { TlsProfile } from '../profiles/types.js';

const MAX_PLAINTEXT = 16384;

export interface ConnectOptions {
    host: string;
    port?: number;
    profile: TlsProfile;
    /** Skip certificate chain/hostname verification. NEVER use in production. */
    insecureSkipVerify?: boolean;
    /** Existing socket to use instead of dialing (mainly for tests). */
    socket?: Socket;
    /** Optional diagnostic hook, called with human-readable handshake events. */
    debug?: (event: string) => void;
}

/** A structurally valid GREASE encrypted_client_hello (outer), as Chrome sends when no real ECH config exists. */
function buildGreaseEch(): Uint8Array {
    const enc = randomBytes(32); // HPKE X25519 "enc" public key
    const payload = randomBytes(191); // opaque payload, sized so the whole extension ~= Chrome's
    return new ByteWriter()
        .u8(0) // ECHClientHelloType = outer
        .u16(0x0001) // HpkeKdfId = HKDF-SHA256
        .u16(0x0001) // HpkeAeadId = AES-128-GCM
        .u8(randomBytes(1)[0] ?? 0) // config_id
        .u16Vec((w) => w.bytes(enc))
        .u16Vec((w) => w.bytes(payload))
        .result();
}

/**
 * A pure-TypeScript TLS 1.3 client connection. After `handshake()` resolves it behaves as a
 * Duplex carrying *application data*: writes are encrypted into records, and decrypted
 * application data is readable. Post-handshake NewSessionTicket / KeyUpdate messages are
 * handled internally. Node's `http2` can ride on this via `createConnection`.
 */
export class TlsConnection extends Duplex {
    readonly host: string;
    /** Negotiated ALPN protocol (e.g. "h2"), available after handshake. */
    alpn: string | null = null;
    /** Compatibility shims so Node's http2 client accepts this as its (TLS) socket. */
    readonly encrypted = true;

    get alpnProtocol(): string | false {
        return this.alpn ?? false;
    }

    get servername(): string {
        return this.host;
    }

    setTimeout(_ms: number, cb?: () => void): this {
        if (cb) this.once('timeout', cb);
        return this;
    }
    setNoDelay(): this {
        this.socket.setNoDelay?.(true);
        return this;
    }
    setKeepAlive(): this {
        return this;
    }
    ref(): this {
        this.socket.ref?.();
        return this;
    }
    unref(): this {
        this.socket.unref?.();
        return this;
    }

    private readonly socket: Socket;
    private readonly profile: TlsProfile;
    private readonly insecureSkipVerify: boolean;
    private readonly debug: ((event: string) => void) | undefined;

    private incoming: Uint8Array = new Uint8Array(0);
    private handshakeDone = false;
    private readonly recordQueue: { type: number; fragment: Uint8Array }[] = [];
    private recordWaiter: ((r: { type: number; fragment: Uint8Array }) => void) | null = null;
    private fatal: Error | null = null;

    private clientAppProt: RecordProtection | null = null;
    private serverAppProt: RecordProtection | null = null;

    get rawSocket(): Socket {
        return this.socket;
    }

    constructor(opts: ConnectOptions) {
        super();
        this.host = opts.host;
        this.profile = opts.profile;
        this.insecureSkipVerify = opts.insecureSkipVerify ?? false;
        this.debug = opts.debug;
        this.socket = opts.socket ?? netConnect({ host: opts.host, port: opts.port ?? 443 });
        this.socket.on('data', (d: Buffer) => this.onSocketData(d));
        this.socket.on('error', (e) => this.fail(e));
        this.socket.on('close', () => {
            if (!this.fatal) this.push(null);
        });
    }

    // ---- socket read side: split into records and dispatch ----

    private onSocketData(chunk: Uint8Array): void {
        this.incoming = concatBytes(this.incoming, chunk);
        for (;;) {
            const rec = readRecord(this.incoming, 0);
            if (!rec) break;
            this.incoming = this.incoming.subarray(rec.end);
            this.dispatchRecord({ type: rec.type, fragment: rec.fragment });
        }
    }

    private dispatchRecord(rec: { type: number; fragment: Uint8Array }): void {
        if (!this.handshakeDone) {
            if (this.recordWaiter) {
                const w = this.recordWaiter;
                this.recordWaiter = null;
                w(rec);
            } else {
                this.recordQueue.push(rec);
            }
            return;
        }
        this.handleAppRecord(rec);
    }

    private takeRecord(): Promise<{ type: number; fragment: Uint8Array }> {
        const queued = this.recordQueue.shift();
        if (queued) return Promise.resolve(queued);
        return new Promise((resolve, reject) => {
            if (this.fatal) {
                reject(this.fatal);
                return;
            }
            this.recordWaiter = resolve;
        });
    }

    private fail(err: Error): void {
        this.fatal = err;
        this.destroy(err);
    }

    // ---- the handshake state machine ----

    async handshake(): Promise<void> {
        const keyShares = generateKeyShares(this.profile.keyShareGroups);
        const grease = generateGrease((n) => randomBytes(n));
        const clientHelloMsg = buildClientHello({
            profile: this.profile,
            serverName: this.host,
            clientRandom: randomBytes(32),
            sessionId: randomBytes(32),
            grease,
            keyShares: keyShares.map((k) => ({ group: k.group, keyExchange: k.publicKey })),
            echGreasePayload: this.profile.echGrease ? buildGreaseEch() : undefined,
        });
        this.socket.write(plaintextRecord(ContentType.Handshake, clientHelloMsg, TLS_VERSION.TLS10));

        // ServerHello (plaintext handshake record).
        let rec = await this.takeRecord();
        while (rec.type === ContentType.ChangeCipherSpec) rec = await this.takeRecord();
        if (rec.type === ContentType.Alert) {
            throw new Error(`server sent plaintext alert before ServerHello: ${hex(rec.fragment)}`);
        }
        if (rec.type !== ContentType.Handshake) {
            throw new Error(`expected ServerHello, got record type ${rec.type}`);
        }
        const sh = parseServerHello(rec.fragment);
        if (sh.isHelloRetryRequest) throw new Error('HelloRetryRequest not yet supported');
        if (sh.selectedVersion !== TLS_VERSION.TLS13) {
            throw new Error(`server did not negotiate TLS 1.3 (got 0x${sh.selectedVersion.toString(16)})`);
        }
        const serverShare = nonNull(sh.keyShare, 'ServerHello missing key_share');
        const chosen = nonNull(
            keyShares.find((k) => k.group === serverShare.group),
            `server chose group 0x${serverShare.group.toString(16)} we did not offer`,
        );

        this.debug?.(`ServerHello cipher=0x${sh.cipherSuite.toString(16)} group=0x${serverShare.group.toString(16)}`);
        const params = cipherParams(sh.cipherSuite);
        const sharedSecret = chosen.computeSharedSecret(serverShare.keyExchange);

        const ks = new KeySchedule(sh.cipherSuite);
        ks.deriveHandshakeSecret(sharedSecret);
        const transcript: Uint8Array[] = [clientHelloMsg, rec.fragment];
        const chSh = concatBytes(...transcript);
        const clientHsSecret = ks.clientHandshakeTrafficSecret(chSh);
        const serverHsSecret = ks.serverHandshakeTrafficSecret(chSh);

        const clientHs = trafficKeyIv(params, clientHsSecret);
        const serverHs = trafficKeyIv(params, serverHsSecret);
        const clientHsProt = new RecordProtection(params, clientHs.key, clientHs.iv);
        const serverHsProt = new RecordProtection(params, serverHs.key, serverHs.iv);

        // Read + decrypt the server's encrypted flight, reassembling handshake messages.
        const { certificates, tHashAfterCert, certVerify, serverFinished, endTranscript } = await this.readServerFlight(
            transcript,
            params,
            serverHsProt,
        );

        // Authenticate the server (certificate chain + CertificateVerify + Finished).
        if (!this.insecureSkipVerify) {
            this.verifyCertificateChain(certificates);
            this.verifyCertificateVerify(certVerify.algorithm, certVerify.signature, certificates[0], tHashAfterCert);
        }
        const expectedServerFinished = finishedVerifyData(
            params.hash,
            serverHsSecret,
            certVerify.transcriptForFinished,
        );
        if (!timingSafeEqualBytes(expectedServerFinished, serverFinished)) {
            throw new Error('server Finished verification failed');
        }

        // Application traffic keys (transcript through the server Finished).
        ks.deriveMasterSecret();
        const clientAppSecret = ks.clientAppTrafficSecret(endTranscript);
        const serverAppSecret = ks.serverAppTrafficSecret(endTranscript);
        const clientApp = trafficKeyIv(params, clientAppSecret);
        const serverApp = trafficKeyIv(params, serverAppSecret);

        // Send client Finished (middlebox-compat CCS first), encrypted under handshake keys.
        this.socket.write(plaintextRecord(ContentType.ChangeCipherSpec, Uint8Array.of(1), TLS_VERSION.TLS12));
        const clientFinished = clientFinishedMessage(params, clientHsSecret, endTranscript);
        this.socket.write(clientHsProt.encryptRecord(ContentType.Handshake, clientFinished));

        this.clientAppProt = new RecordProtection(params, clientApp.key, clientApp.iv);
        this.serverAppProt = new RecordProtection(params, serverApp.key, serverApp.iv);
        this.handshakeDone = true;
    }

    private async readServerFlight(
        transcript: Uint8Array[],
        params: CipherParams,
        serverHsProt: RecordProtection,
    ): Promise<{
        certificates: X509Certificate[];
        tHashAfterCert: Uint8Array;
        certVerify: { algorithm: number; signature: Uint8Array; transcriptForFinished: Uint8Array };
        serverFinished: Uint8Array;
        endTranscript: Uint8Array;
    }> {
        let hsBuf: Uint8Array = new Uint8Array(0);
        let certificates: X509Certificate[] = [];
        let tHashAfterCert: Uint8Array = new Uint8Array(0);
        let cvAlgorithm = 0;
        let cvSignature: Uint8Array = new Uint8Array(0);
        let transcriptForFinished: Uint8Array = new Uint8Array(0);
        let serverFinished: Uint8Array | null = null;

        while (serverFinished === null) {
            const rec = await this.takeRecord();
            this.debug?.(`flight record type=${rec.type} len=${rec.fragment.length}`);
            if (rec.type === ContentType.ChangeCipherSpec) continue;
            if (rec.type === ContentType.Alert) throw new Error('server sent an alert during handshake');
            if (rec.type !== ContentType.ApplicationData) {
                throw new Error(`unexpected record type ${rec.type} in encrypted flight`);
            }
            const { type, data } = serverHsProt.decryptRecord(recordBytes(rec));
            if (type === ContentType.Alert) throw new Error('server sent an encrypted alert during handshake');
            if (type !== ContentType.Handshake) throw new Error(`unexpected inner type ${type} in flight`);

            hsBuf = concatBytes(hsBuf, data);
            for (;;) {
                const msg = takeHandshakeMessage(hsBuf);
                if (!msg) break;
                hsBuf = hsBuf.subarray(msg.end);
                const msgBytes = msg.bytes;
                this.debug?.(`hs msg type=${msg.msgType} len=${msg.bytes.length}`);
                switch (msg.msgType) {
                    case HandshakeType.EncryptedExtensions:
                        this.alpn = parseAlpnFromEncryptedExtensions(msgBytes);
                        transcript.push(msgBytes);
                        break;
                    case HandshakeType.Certificate:
                        certificates = parseCertificateBody(msgBytes.subarray(4));
                        transcript.push(msgBytes);
                        tHashAfterCert = params.hash(concatBytes(...transcript));
                        break;
                    case HandshakeType.CompressedCertificate:
                        certificates = parseCompressedCertificate(msgBytes);
                        // Transcript uses the CompressedCertificate message as sent (RFC 8879).
                        transcript.push(msgBytes);
                        tHashAfterCert = params.hash(concatBytes(...transcript));
                        break;
                    case HandshakeType.CertificateRequest:
                        transcript.push(msgBytes); // client auth not supported; ignore contents
                        break;
                    case HandshakeType.CertificateVerify: {
                        const r = new ByteReader(msgBytes.subarray(4));
                        cvAlgorithm = r.u16();
                        cvSignature = r.bytes(r.u16());
                        transcript.push(msgBytes);
                        transcriptForFinished = concatBytes(...transcript);
                        break;
                    }
                    case HandshakeType.Finished:
                        serverFinished = msgBytes.subarray(4);
                        transcript.push(msgBytes);
                        break;
                    default:
                        transcript.push(msgBytes);
                }
            }
        }

        return {
            certificates,
            tHashAfterCert,
            certVerify: { algorithm: cvAlgorithm, signature: cvSignature, transcriptForFinished },
            serverFinished,
            endTranscript: concatBytes(...transcript),
        };
    }

    // ---- certificate authentication (reuses Node's X509 + root store) ----

    private verifyCertificateChain(certs: X509Certificate[]): void {
        const leaf = certs[0];
        if (!leaf) throw new Error('server sent no certificate');
        if (!leaf.checkHost(this.host)) throw new Error(`certificate is not valid for host ${this.host}`);
        const now = Date.now();
        if (now < Date.parse(leaf.validFrom) || now > Date.parse(leaf.validTo)) {
            throw new Error('leaf certificate is expired or not yet valid');
        }
        // Link each cert to its issuer, then anchor the top to a trusted root.
        const roots = rootCertificates.map((pem) => new X509Certificate(pem));
        for (let i = 0; i < certs.length; i++) {
            const cur = nonNull(certs[i]);
            const issuer = certs[i + 1] ?? roots.find((r) => cur.checkIssued(r));
            if (!issuer) throw new Error('could not build certificate chain to a trusted root');
            if (!cur.verify(issuer.publicKey)) throw new Error('certificate signature verification failed');
        }
        const top = nonNull(certs[certs.length - 1]);
        const anchored = certs.length > 1 || roots.some((r) => top.checkIssued(r) && top.verify(r.publicKey));
        if (!anchored) throw new Error('certificate chain is not anchored to a trusted root');
    }

    private verifyCertificateVerify(
        algorithm: number,
        signature: Uint8Array,
        leaf: X509Certificate | undefined,
        transcriptHashThroughCert: Uint8Array,
    ): void {
        if (!leaf) throw new Error('no leaf certificate for CertificateVerify');
        const context = concatBytes(
            new Uint8Array(64).fill(0x20),
            new TextEncoder().encode('TLS 1.3, server CertificateVerify'),
            Uint8Array.of(0),
            transcriptHashThroughCert,
        );
        const scheme = SIGNATURE_SCHEMES[algorithm];
        if (!scheme) throw new Error(`unsupported CertificateVerify algorithm 0x${algorithm.toString(16)}`);
        const key =
            scheme.type === 'rsa-pss'
                ? {
                      key: leaf.publicKey,
                      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
                      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
                  }
                : { key: leaf.publicKey, dsaEncoding: 'der' as const };
        const ok = cryptoVerify(scheme.hash, context, key, signature);
        if (!ok) throw new Error('CertificateVerify signature is invalid');
    }

    // ---- application data (post-handshake) ----

    private handleAppRecord(rec: { type: number; fragment: Uint8Array }): void {
        if (rec.type === ContentType.ChangeCipherSpec) return;
        const prot = this.serverAppProt;
        if (!prot) return;
        try {
            const { type, data } = prot.decryptRecord(recordBytes(rec));
            if (type === ContentType.ApplicationData) {
                this.push(Buffer.from(data));
            } else if (type === ContentType.Handshake) {
                // NewSessionTicket / KeyUpdate — consume; ticket storage is a future feature.
            } else if (type === ContentType.Alert) {
                const closeNotify = data[1] === 0; // level warning + close_notify
                if (closeNotify) this.push(null);
                else this.fail(new Error(`TLS alert ${data[0]}/${data[1]}`));
            }
        } catch (e) {
            this.fail(e as Error);
        }
    }

    override _read(): void {
        // Data is pushed as it is decrypted; nothing to pull.
    }

    override _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
        const prot = this.clientAppProt;
        if (!prot) {
            cb(new Error('write before handshake completed'));
            return;
        }
        try {
            for (let off = 0; off < chunk.length; off += MAX_PLAINTEXT) {
                const slice = chunk.subarray(off, off + MAX_PLAINTEXT);
                this.socket.write(prot.encryptRecord(ContentType.ApplicationData, slice));
            }
            cb();
        } catch (e) {
            cb(e as Error);
        }
    }

    override _destroy(err: Error | null, cb: (err?: Error | null) => void): void {
        this.socket.destroy(err ?? undefined);
        cb(err);
    }
}

/** Dial a host and complete the TLS 1.3 handshake, returning a ready connection. */
export async function connect(opts: ConnectOptions): Promise<TlsConnection> {
    const conn = new TlsConnection(opts);
    await once(conn.rawSocket, 'connect', opts.socket);
    await conn.handshake();
    return conn;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SIGNATURE_SCHEMES: Record<number, { type: 'rsa-pss' | 'ecdsa' | 'rsa-pkcs1'; hash: string }> = {
    0x0804: { type: 'rsa-pss', hash: 'sha256' },
    0x0805: { type: 'rsa-pss', hash: 'sha384' },
    0x0806: { type: 'rsa-pss', hash: 'sha512' },
    0x0403: { type: 'ecdsa', hash: 'sha256' },
    0x0503: { type: 'ecdsa', hash: 'sha384' },
    0x0603: { type: 'ecdsa', hash: 'sha512' },
    0x0401: { type: 'rsa-pkcs1', hash: 'sha256' },
    0x0501: { type: 'rsa-pkcs1', hash: 'sha384' },
    0x0601: { type: 'rsa-pkcs1', hash: 'sha512' },
};

function recordBytes(rec: { type: number; fragment: Uint8Array }): Uint8Array {
    const header = Uint8Array.of(
        rec.type,
        (TLS_VERSION.TLS12 >> 8) & 0xff,
        TLS_VERSION.TLS12 & 0xff,
        (rec.fragment.length >> 8) & 0xff,
        rec.fragment.length & 0xff,
    );
    return concatBytes(header, rec.fragment);
}

function takeHandshakeMessage(buf: Uint8Array): { msgType: number; bytes: Uint8Array; end: number } | null {
    if (buf.length < 4) return null;
    const msgType = nonNull(buf[0]);
    const len = (nonNull(buf[1]) << 16) | (nonNull(buf[2]) << 8) | nonNull(buf[3]);
    if (buf.length < 4 + len) return null;
    return { msgType, bytes: buf.subarray(0, 4 + len), end: 4 + len };
}

function parseAlpnFromEncryptedExtensions(msg: Uint8Array): string | null {
    const r = new ByteReader(msg.subarray(4));
    if (r.remaining < 2) return null;
    const total = r.u16();
    const end = r.offset + total;
    while (r.offset < end) {
        const etype = r.u16();
        const data = r.bytes(r.u16());
        if (etype === ExtensionType.application_layer_protocol_negotiation) {
            const er = new ByteReader(data);
            er.u16(); // list length
            return new TextDecoder().decode(er.bytes(er.u8()));
        }
    }
    return null;
}

/** Parse a Certificate message *body* (without the 4-byte handshake header). */
function parseCertificateBody(body: Uint8Array): X509Certificate[] {
    const r = new ByteReader(body);
    r.bytes(r.u8()); // certificate_request_context
    const listLen = r.u24();
    const end = r.offset + listLen;
    const certs: X509Certificate[] = [];
    while (r.offset < end) {
        const der = r.bytes(r.u24());
        certs.push(new X509Certificate(Buffer.from(der)));
        r.bytes(r.u16()); // per-certificate extensions
    }
    return certs;
}

/** Parse a CompressedCertificate message (RFC 8879): decompress, then parse the body. */
function parseCompressedCertificate(msg: Uint8Array): X509Certificate[] {
    const r = new ByteReader(msg.subarray(4));
    const algorithm = r.u16();
    const uncompressedLen = r.u24();
    const compressed = r.bytes(r.u24());
    let body: Uint8Array;
    switch (algorithm) {
        case 2: // brotli — the only algorithm we advertise
            body = brotliDecompressSync(compressed);
            break;
        case 1: // zlib
            body = inflateSync(compressed);
            break;
        default:
            throw new Error(`unsupported certificate compression algorithm ${algorithm}`);
    }
    if (body.length !== uncompressedLen) {
        throw new Error('decompressed certificate length mismatch');
    }
    return parseCertificateBody(body);
}

function clientFinishedMessage(params: CipherParams, clientHsSecret: Uint8Array, transcript: Uint8Array): Uint8Array {
    const verifyData = finishedVerifyData(params.hash, clientHsSecret, transcript);
    return new ByteWriter()
        .u8(HandshakeType.Finished)
        .u24Vec((w) => w.bytes(verifyData))
        .result();
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= nonNull(a[i]) ^ nonNull(b[i]);
    return diff === 0;
}

function once(socket: Socket, event: string, alreadyConnected?: Socket): Promise<void> {
    if (alreadyConnected) return Promise.resolve();
    return new Promise((resolve, reject) => {
        socket.once(event, () => resolve());
        socket.once('error', reject);
    });
}
