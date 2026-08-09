/**
 * GREASE (RFC 8701) — Chrome/BoringSSL inject "fake" reserved values into cipher
 * suites, supported groups, supported versions, signature algorithms, key_share, and
 * as leading + trailing extensions, to keep the ecosystem tolerant of unknown values.
 *
 * The 16 valid GREASE codepoints all have the form 0x{n}a{n}a, i.e. both bytes equal
 * and low nibble 0xa. BoringSSL derives each slot's value from a per-connection random
 * byte: `value = (seedByte & 0xf0) | 0x0a; value |= value << 8`.
 */
import { nonNull } from '../util/assert.js';

export const GREASE_VALUES: readonly number[] = [
    0x0a0a, 0x1a1a, 0x2a2a, 0x3a3a, 0x4a4a, 0x5a5a, 0x6a6a, 0x7a7a, 0x8a8a, 0x9a9a, 0xaaaa, 0xbaba, 0xcaca, 0xdada,
    0xeaea, 0xfafa,
];

export function isGrease(v: number): boolean {
    return (v & 0x0f0f) === 0x0a0a && ((v >>> 8) & 0xff) === (v & 0xff);
}

/** Turn one random seed byte into a GREASE 16-bit value, the BoringSSL way. */
export function greaseFromSeed(seedByte: number): number {
    const b = (seedByte & 0xf0) | 0x0a;
    return (b << 8) | b;
}

/** The distinct GREASE slots Chrome populates in a single ClientHello. */
export interface GreaseValues {
    cipher: number;
    group: number; // also used for the 1-byte GREASE key_share
    extensionFirst: number;
    extensionLast: number;
    version: number;
}

/** Generate a fresh, per-connection set of GREASE values from a random source. */
export function generateGrease(randomBytes: (n: number) => Uint8Array): GreaseValues {
    const seed = randomBytes(5);
    return {
        cipher: greaseFromSeed(nonNull(seed[0])),
        group: greaseFromSeed(nonNull(seed[1])),
        extensionFirst: greaseFromSeed(nonNull(seed[2])),
        extensionLast: greaseFromSeed(nonNull(seed[3])),
        version: greaseFromSeed(nonNull(seed[4])),
    };
}
