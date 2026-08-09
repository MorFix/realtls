import { gcm } from '@noble/ciphers/aes.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes } from '../util/bytes.js';
import { nonNull } from '../util/assert.js';
import { ContentType, TLS_VERSION } from './constants.js';
import type { CipherParams } from './keyschedule.js';

/**
 * TLS 1.3 record layer (RFC 8446 §5).
 *
 * Plaintext records (used for the initial ClientHello and ChangeCipherSpec):
 *   struct { ContentType type; uint16 legacy_version; uint16 length; opaque fragment }
 *
 * Once handshake keys exist, everything is wrapped in an encrypted record whose outer
 * type is always application_data(23). The real content type is appended to the plaintext
 * *inside* the AEAD (TLSInnerPlaintext = content || type || zero-padding), so an observer
 * can't even tell handshake bytes from data. The AEAD is keyed by the traffic key, the
 * nonce is static_iv XOR sequence_number, and the AAD is the 5-byte outer record header.
 *
 * AEAD primitives come from @noble/ciphers — we only assemble the framing.
 */

const TAG_LEN = 16; // AES-GCM and ChaCha20-Poly1305 both use a 16-byte tag.

interface Aead {
    encrypt(plaintext: Uint8Array): Uint8Array;
    decrypt(ciphertext: Uint8Array): Uint8Array;
}

function makeAead(params: CipherParams, key: Uint8Array, nonce: Uint8Array, aad: Uint8Array): Aead {
    switch (params.aead) {
        case 'aes-128-gcm':
        case 'aes-256-gcm':
            return gcm(key, nonce, aad);
        case 'chacha20-poly1305':
            return chacha20poly1305(key, nonce, aad);
    }
}

function recordHeader(length: number): Uint8Array {
    return Uint8Array.of(
        ContentType.ApplicationData,
        (TLS_VERSION.TLS12 >> 8) & 0xff,
        TLS_VERSION.TLS12 & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
    );
}

/**
 * Encrypts/decrypts records under one traffic secret's key+iv, maintaining the per-record
 * sequence number. Create a fresh instance whenever keys change (handshake -> application),
 * because the sequence number resets to 0 with each new secret.
 */
export class RecordProtection {
    private seq = 0n;

    constructor(
        private readonly params: CipherParams,
        private readonly key: Uint8Array,
        private readonly iv: Uint8Array,
    ) {}

    /** static_iv XOR seq (seq is a 64-bit big-endian value in the low bytes of the iv). */
    private nextNonce(): Uint8Array {
        const nonce = this.iv.slice();
        let s = this.seq;
        for (let i = 0; i < 8; i++) {
            const idx = nonce.length - 1 - i;
            nonce[idx] = nonNull(nonce[idx]) ^ Number(s & 0xffn);
            s >>= 8n;
        }
        return nonce;
    }

    /** Wrap `plaintext` of the given inner content type into an encrypted record. */
    encryptRecord(contentType: number, plaintext: Uint8Array, padding = 0): Uint8Array {
        const inner = concatBytes(plaintext, Uint8Array.of(contentType), new Uint8Array(padding));
        const header = recordHeader(inner.length + TAG_LEN);
        const aead = makeAead(this.params, this.key, this.nextNonce(), header);
        const ciphertext = aead.encrypt(inner);
        this.seq++;
        return concatBytes(header, ciphertext);
    }

    /**
     * Decrypt one encrypted record (5-byte header + ciphertext) and recover the inner
     * content type. Throws on authentication failure (tampering / wrong key / wrong seq).
     */
    decryptRecord(record: Uint8Array): { type: number; data: Uint8Array } {
        const header = record.subarray(0, 5);
        const body = record.subarray(5);
        const aead = makeAead(this.params, this.key, this.nextNonce(), header);
        const inner = aead.decrypt(body);
        this.seq++;

        // Strip trailing zero padding; the last non-zero byte is the real content type.
        let i = inner.length - 1;
        while (i >= 0 && inner[i] === 0) i--;
        if (i < 0) throw new Error('bad record: TLSInnerPlaintext has no content type');
        return { type: nonNull(inner[i]), data: inner.subarray(0, i) };
    }
}

/** Frame a plaintext record (ClientHello / ChangeCipherSpec). */
export function plaintextRecord(type: number, fragment: Uint8Array, version: number = TLS_VERSION.TLS12): Uint8Array {
    const header = Uint8Array.of(
        type,
        (version >> 8) & 0xff,
        version & 0xff,
        (fragment.length >> 8) & 0xff,
        fragment.length & 0xff,
    );
    return concatBytes(header, fragment);
}

export interface RawRecord {
    type: number;
    version: number;
    fragment: Uint8Array;
    /** Offset in the buffer just past this record. */
    end: number;
}

/**
 * Read a single TLS record starting at `offset`. Returns null if the buffer does not yet
 * contain the full record (caller should read more from the socket and retry).
 */
export function readRecord(buf: Uint8Array, offset = 0): RawRecord | null {
    if (buf.length - offset < 5) return null;
    const type = nonNull(buf[offset]);
    const version = (nonNull(buf[offset + 1]) << 8) | nonNull(buf[offset + 2]);
    const length = (nonNull(buf[offset + 3]) << 8) | nonNull(buf[offset + 4]);
    const start = offset + 5;
    if (buf.length - start < length) return null;
    return { type, version, fragment: buf.subarray(start, start + length), end: start + length };
}
