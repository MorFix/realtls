import { expand, extract } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha384 } from '@noble/hashes/sha2.js';
import type { CHash } from '@noble/hashes/utils.js';
import { ByteWriter, concatBytes } from '../util/bytes.js';

/**
 * TLS 1.3 key schedule (RFC 8446 §7.1).
 *
 * Everything in TLS 1.3 secrecy is derived by chaining two HKDF operations:
 *
 *   - HKDF-Extract(salt, IKM) -> a pseudo-random key (PRK)
 *   - HKDF-Expand-Label(secret, label, context, len) -> keying material
 *
 * The chain is: 0 --Extract(PSK)--> Early Secret --Extract(ECDHE)--> Handshake
 * Secret --Extract(0)--> Master Secret. At each stage, Derive-Secret() mixes in the
 * running transcript hash to bind the keys to the exact bytes exchanged so far.
 *
 * We never implement the hash/HMAC ourselves — those come from @noble/hashes.
 */

type Hash = CHash;

const EMPTY = new Uint8Array(0);

export type AeadId = 'aes-128-gcm' | 'aes-256-gcm' | 'chacha20-poly1305';

export interface CipherParams {
    suite: number;
    hash: Hash;
    hashLen: number;
    keyLen: number;
    ivLen: number;
    aead: AeadId;
}

/** Map a TLS 1.3 cipher suite to its hash and AEAD parameters. */
export function cipherParams(suite: number): CipherParams {
    switch (suite) {
        case 0x1301: // TLS_AES_128_GCM_SHA256
            return { suite, hash: sha256, hashLen: 32, keyLen: 16, ivLen: 12, aead: 'aes-128-gcm' };
        case 0x1302: // TLS_AES_256_GCM_SHA384
            return { suite, hash: sha384, hashLen: 48, keyLen: 32, ivLen: 12, aead: 'aes-256-gcm' };
        case 0x1303: // TLS_CHACHA20_POLY1305_SHA256
            return { suite, hash: sha256, hashLen: 32, keyLen: 32, ivLen: 12, aead: 'chacha20-poly1305' };
        default:
            throw new Error(`unsupported TLS 1.3 cipher suite 0x${suite.toString(16)}`);
    }
}

/** HKDF-Extract(salt, IKM). */
export function hkdfExtract(hash: Hash, salt: Uint8Array, ikm: Uint8Array): Uint8Array {
    return extract(hash, ikm, salt);
}

/**
 * HKDF-Expand-Label from RFC 8446 §7.1:
 *   HkdfLabel = uint16 length || opaque("tls13 " + label)<u8> || opaque(context)<u8>
 */
export function hkdfExpandLabel(
    hash: Hash,
    secret: Uint8Array,
    label: string,
    context: Uint8Array,
    length: number,
): Uint8Array {
    const info = new ByteWriter()
        .u16(length)
        .u8Vec((w) => w.bytes(new TextEncoder().encode(`tls13 ${label}`)))
        .u8Vec((w) => w.bytes(context))
        .result();
    return expand(hash, secret, info, length);
}

/** Transcript-Hash(messages) = Hash(concat(messages)). */
export function transcriptHash(hash: Hash, messages: Uint8Array[]): Uint8Array {
    return hash(concatBytes(...messages));
}

/**
 * Derive-Secret(Secret, Label, Messages) = HKDF-Expand-Label(Secret, Label,
 * Transcript-Hash(Messages), Hash.length). `transcript` is the raw concatenation of
 * handshake messages (empty for the "derived" steps).
 */
export function deriveSecret(hash: Hash, secret: Uint8Array, label: string, transcript: Uint8Array): Uint8Array {
    return hkdfExpandLabel(hash, secret, label, hash(transcript), hash.outputLen);
}

/** Per-record write key + IV from a traffic secret (RFC 8446 §7.3). */
export function trafficKeyIv(params: CipherParams, secret: Uint8Array): { key: Uint8Array; iv: Uint8Array } {
    return {
        key: hkdfExpandLabel(params.hash, secret, 'key', EMPTY, params.keyLen),
        iv: hkdfExpandLabel(params.hash, secret, 'iv', EMPTY, params.ivLen),
    };
}

/** The Finished MAC key derived from a traffic secret. */
export function finishedKey(hash: Hash, baseKey: Uint8Array): Uint8Array {
    return hkdfExpandLabel(hash, baseKey, 'finished', EMPTY, hash.outputLen);
}

/** verify_data = HMAC(finished_key, Transcript-Hash(handshake context)). */
export function finishedVerifyData(hash: Hash, baseKey: Uint8Array, transcript: Uint8Array): Uint8Array {
    return hmac(hash, finishedKey(hash, baseKey), hash(transcript));
}

/**
 * Stateful driver over the three-stage secret chain. Feed it the ECDHE shared secret and
 * the running transcript, and it hands back every traffic secret in order.
 */
export class KeySchedule {
    readonly params: CipherParams;
    private readonly hash: Hash;
    private readonly earlySecret: Uint8Array;
    private handshakeSecret: Uint8Array | undefined;
    private masterSecret: Uint8Array | undefined;

    constructor(suite: number, psk?: Uint8Array) {
        this.params = cipherParams(suite);
        this.hash = this.params.hash;
        const zeros = new Uint8Array(this.params.hashLen);
        this.earlySecret = hkdfExtract(this.hash, zeros, psk ?? zeros);
    }

    /** Extract the Handshake Secret from the ECDHE (or hybrid) shared secret. */
    deriveHandshakeSecret(sharedSecret: Uint8Array): Uint8Array {
        const derived = deriveSecret(this.hash, this.earlySecret, 'derived', EMPTY);
        this.handshakeSecret = hkdfExtract(this.hash, derived, sharedSecret);
        return this.handshakeSecret;
    }

    private requireHandshake(): Uint8Array {
        if (this.handshakeSecret === undefined) {
            throw new Error('deriveHandshakeSecret() must be called first');
        }
        return this.handshakeSecret;
    }

    private requireMaster(): Uint8Array {
        if (this.masterSecret === undefined) {
            throw new Error('deriveMasterSecret() must be called first');
        }
        return this.masterSecret;
    }

    clientHandshakeTrafficSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireHandshake(), 'c hs traffic', transcript);
    }

    serverHandshakeTrafficSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireHandshake(), 's hs traffic', transcript);
    }

    /** Extract the Master Secret (must follow deriveHandshakeSecret). */
    deriveMasterSecret(): Uint8Array {
        const derived = deriveSecret(this.hash, this.requireHandshake(), 'derived', EMPTY);
        this.masterSecret = hkdfExtract(this.hash, derived, new Uint8Array(this.params.hashLen));
        return this.masterSecret;
    }

    clientAppTrafficSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireMaster(), 'c ap traffic', transcript);
    }

    serverAppTrafficSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireMaster(), 's ap traffic', transcript);
    }

    exporterMasterSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireMaster(), 'exp master', transcript);
    }

    resumptionMasterSecret(transcript: Uint8Array): Uint8Array {
        return deriveSecret(this.hash, this.requireMaster(), 'res master', transcript);
    }
}
