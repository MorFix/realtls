import { ByteWriter, ByteReader } from '../util/bytes.js';
import { nonNull } from '../util/assert.js';
import { ExtensionType, HandshakeType } from './constants.js';
import { isGrease, type GreaseValues } from './grease.js';
import type { TlsProfile } from '../profiles/types.js';

export interface KeyShareEntry {
    group: number;
    keyExchange: Uint8Array;
}

export interface ClientHelloParams {
    profile: TlsProfile;
    serverName: string;
    clientRandom: Uint8Array; // 32 bytes
    sessionId: Uint8Array; // 32 bytes (Chrome sends a random legacy session id)
    keyShares: KeyShareEntry[]; // real shares, order matching profile.keyShareGroups
    grease: GreaseValues;
    echGreasePayload?: Uint8Array; // opaque bytes for the GREASE ECH extension
    /**
     * Permutation applied to the *middle* extensions (everything except the leading and
     * trailing GREASE). An array of indices into the middle-extension list. If omitted,
     * identity order is used (useful for deterministic tests).
     */
    permutation?: number[];
}

interface Ext {
    type: number;
    data: Uint8Array;
}

function ext(type: number, build?: (w: ByteWriter) => void): Ext {
    const w = new ByteWriter();
    build?.(w);
    return { type, data: w.result() };
}

function serializeExt(w: ByteWriter, e: Ext): void {
    w.u16(e.type);
    w.u16(e.data.length);
    w.bytes(e.data);
}

/** Build the middle (permutable) extensions in Chrome's canonical construction order. */
function buildMiddleExtensions(p: ClientHelloParams): Ext[] {
    const { profile, grease } = p;
    const exts: Ext[] = [];

    exts.push(
        ext(ExtensionType.server_name, (w) =>
            w.u16Vec((l) => {
                l.u8(0); // host_name
                l.u16Vec((n) => n.bytes(new TextEncoder().encode(p.serverName)));
            }),
        ),
    );
    exts.push(ext(ExtensionType.extended_master_secret));
    exts.push(ext(ExtensionType.renegotiation_info, (w) => w.u8(0)));
    exts.push(
        ext(ExtensionType.supported_groups, (w) =>
            w.u16Vec((l) => {
                l.u16(grease.group);
                for (const g of profile.supportedGroups) l.u16(g);
            }),
        ),
    );
    exts.push(
        ext(ExtensionType.ec_point_formats, (w) =>
            w.u8Vec((l) => {
                for (const f of profile.ecPointFormats) l.u8(f);
            }),
        ),
    );
    exts.push(ext(ExtensionType.session_ticket));
    exts.push(
        ext(ExtensionType.status_request, (w) => {
            w.u8(1); // OCSP
            w.u16(0); // responder_id_list length
            w.u16(0); // request_extensions length
        }),
    );
    exts.push(
        ext(ExtensionType.signature_algorithms, (w) =>
            w.u16Vec((l) => {
                for (const s of profile.signatureAlgorithms) l.u16(s);
            }),
        ),
    );
    exts.push(ext(ExtensionType.signed_certificate_timestamp));
    exts.push(
        ext(ExtensionType.psk_key_exchange_modes, (w) =>
            w.u8Vec((l) => {
                for (const m of profile.pskKeyExchangeModes) l.u8(m);
            }),
        ),
    );
    exts.push(
        ext(ExtensionType.key_share, (w) =>
            w.u16Vec((l) => {
                l.u16(grease.group);
                l.u16Vec((g) => g.u8(0)); // 1-byte GREASE key share
                for (const ks of p.keyShares) {
                    l.u16(ks.group);
                    l.u16Vec((g) => g.bytes(ks.keyExchange));
                }
            }),
        ),
    );
    exts.push(
        ext(ExtensionType.supported_versions, (w) =>
            w.u8Vec((l) => {
                l.u16(grease.version);
                for (const v of profile.supportedVersions) l.u16(v);
            }),
        ),
    );
    exts.push(
        ext(ExtensionType.application_layer_protocol_negotiation, (w) =>
            w.u16Vec((l) => {
                for (const proto of profile.alpn) {
                    l.u8Vec((x) => x.bytes(new TextEncoder().encode(proto)));
                }
            }),
        ),
    );
    exts.push(
        ext(ExtensionType.compress_certificate, (w) =>
            w.u8Vec((l) => {
                for (const a of profile.certCompressionAlgorithms) l.u16(a);
            }),
        ),
    );
    if (profile.echGrease) {
        exts.push(
            ext(ExtensionType.encrypted_client_hello, (w) => {
                w.bytes(p.echGreasePayload ?? new Uint8Array(0));
            }),
        );
    }
    exts.push(
        ext(ExtensionType.application_settings, (w) =>
            w.u16Vec((l) => {
                for (const proto of profile.alps) {
                    l.u8Vec((x) => x.bytes(new TextEncoder().encode(proto)));
                }
            }),
        ),
    );
    return exts;
}

/** Serialize a full ClientHello handshake message (starts with the 0x01 type byte). */
export function buildClientHello(p: ClientHelloParams): Uint8Array {
    const { profile, grease } = p;
    const middle = buildMiddleExtensions(p);

    const ordered = p.permutation?.length === middle.length ? p.permutation.map((i) => nonNull(middle[i])) : middle;

    const body = new ByteWriter();
    body.u16(profile.handshakeVersion);
    body.bytes(p.clientRandom);
    body.u8Vec((w) => w.bytes(p.sessionId));
    body.u16Vec((w) => {
        if (profile.greaseExtensions) w.u16(grease.cipher);
        for (const c of profile.cipherSuites) w.u16(c);
    });
    body.u8Vec((w) => w.u8(0)); // compression methods = [null]
    body.u16Vec((w) => {
        if (profile.greaseExtensions) serializeExt(w, { type: grease.extensionFirst, data: new Uint8Array(0) });
        for (const e of ordered) serializeExt(w, e);
        if (profile.greaseExtensions) serializeExt(w, { type: grease.extensionLast, data: Uint8Array.of(0) });
    });

    const out = new ByteWriter();
    out.u8(HandshakeType.ClientHello);
    out.u24Vec((w) => w.bytes(body.result()));
    return out.result();
}

// ---------------------------------------------------------------------------
// Parser (used for tests against captured Chrome bytes, and for JA3/JA4).
// ---------------------------------------------------------------------------

export interface ParsedClientHello {
    legacyVersion: number;
    random: Uint8Array;
    sessionId: Uint8Array;
    cipherSuites: number[];
    extensions: { type: number; data: Uint8Array }[];
    supportedGroups: number[];
    signatureAlgorithms: number[];
    supportedVersions: number[];
    alpn: string[];
    serverName: string | null;
}

export function parseClientHello(msg: Uint8Array): ParsedClientHello {
    const r = new ByteReader(msg);
    const type = r.u8();
    if (type !== HandshakeType.ClientHello) throw new Error(`not a ClientHello (type ${type})`);
    r.u24(); // body length
    const legacyVersion = r.u16();
    const random = r.bytes(32);
    const sessionId = r.bytes(r.u8());
    const csLen = r.u16();
    const cipherSuites: number[] = [];
    for (let i = 0; i < csLen; i += 2) cipherSuites.push(r.u16());
    const compLen = r.u8();
    r.bytes(compLen);

    const extensions: { type: number; data: Uint8Array }[] = [];
    const supportedGroups: number[] = [];
    const signatureAlgorithms: number[] = [];
    const supportedVersions: number[] = [];
    const alpn: string[] = [];
    let serverName: string | null = null;

    if (r.remaining >= 2) {
        const extTotal = r.u16();
        const end = r.offset + extTotal;
        while (r.offset < end) {
            const etype = r.u16();
            const elen = r.u16();
            const data = r.bytes(elen);
            extensions.push({ type: etype, data });
            const er = new ByteReader(data);
            switch (etype) {
                case ExtensionType.supported_groups: {
                    const n = er.u16();
                    for (let i = 0; i < n; i += 2) supportedGroups.push(er.u16());
                    break;
                }
                case ExtensionType.signature_algorithms: {
                    const n = er.u16();
                    for (let i = 0; i < n; i += 2) signatureAlgorithms.push(er.u16());
                    break;
                }
                case ExtensionType.supported_versions: {
                    const n = er.u8();
                    for (let i = 0; i < n; i += 2) supportedVersions.push(er.u16());
                    break;
                }
                case ExtensionType.application_layer_protocol_negotiation: {
                    er.u16(); // list length
                    while (er.remaining > 0) alpn.push(new TextDecoder().decode(er.bytes(er.u8())));
                    break;
                }
                case ExtensionType.server_name: {
                    if (data.length >= 5) {
                        er.u16(); // list length
                        er.u8(); // name type
                        serverName = new TextDecoder().decode(er.bytes(er.u16()));
                    }
                    break;
                }
            }
        }
    }

    return {
        legacyVersion,
        random,
        sessionId,
        cipherSuites,
        extensions,
        supportedGroups,
        signatureAlgorithms,
        supportedVersions,
        alpn,
        serverName,
    };
}

export { isGrease };
