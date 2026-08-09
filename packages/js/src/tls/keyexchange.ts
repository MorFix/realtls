import { x25519 } from '@noble/curves/ed25519.js';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { concatBytes } from '../util/bytes.js';
import { NamedGroup } from './constants.js';

/**
 * (EC)DHE / hybrid-KEM key agreement for TLS 1.3 key_share.
 *
 * All arithmetic comes from @noble (X25519 from @noble/curves, ML-KEM-768 from
 * @noble/post-quantum). We only wire the pieces together and concatenate per the TLS
 * hybrid draft.
 *
 * For the hybrid group X25519MLKEM768 (0x11EC) the client key_share is
 *   ML-KEM-768 encapsulation key (1184) || X25519 public key (32)   = 1216 bytes
 * the server responds with
 *   ML-KEM-768 ciphertext (1088) || X25519 public key (32)          = 1120 bytes
 * and the shared secret is  ML-KEM shared secret (32) || X25519 shared secret (32).
 */

const MLKEM768_CIPHERTEXT_LEN = 1088;

export interface KeyShare {
    group: number;
    /** Public bytes to place in the ClientHello key_share entry. */
    publicKey: Uint8Array;
    /** Derive the shared secret from the server's key_share for this group. */
    computeSharedSecret(serverKeyExchange: Uint8Array): Uint8Array;
}

/** Low-level X25519 ECDHE (exposed so it can be checked against known test vectors). */
export function x25519SharedSecret(secretKey: Uint8Array, serverPublic: Uint8Array): Uint8Array {
    return x25519.getSharedSecret(secretKey, serverPublic);
}

function x25519KeyShare(): KeyShare {
    const secretKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(secretKey);
    return {
        group: NamedGroup.X25519,
        publicKey,
        computeSharedSecret: (serverPublic) => x25519SharedSecret(secretKey, serverPublic),
    };
}

function x25519MlKem768KeyShare(): KeyShare {
    const kem = ml_kem768.keygen();
    const x25519Secret = x25519.utils.randomSecretKey();
    const x25519Public = x25519.getPublicKey(x25519Secret);
    const publicKey = concatBytes(kem.publicKey, x25519Public);

    return {
        group: NamedGroup.X25519MLKEM768,
        publicKey,
        computeSharedSecret: (serverKeyExchange) => {
            const ciphertext = serverKeyExchange.subarray(0, MLKEM768_CIPHERTEXT_LEN);
            const serverX25519 = serverKeyExchange.subarray(MLKEM768_CIPHERTEXT_LEN);
            const kemShared = ml_kem768.decapsulate(ciphertext, kem.secretKey);
            const x25519Shared = x25519SharedSecret(x25519Secret, serverX25519);
            return concatBytes(kemShared, x25519Shared);
        },
    };
}

/** Generate a fresh key_share for a named group. */
export function generateKeyShare(group: number): KeyShare {
    switch (group) {
        case NamedGroup.X25519:
            return x25519KeyShare();
        case NamedGroup.X25519MLKEM768:
            return x25519MlKem768KeyShare();
        default:
            throw new Error(`unsupported key_share group 0x${group.toString(16)}`);
    }
}

/** Generate all key_shares a profile offers, in order. */
export function generateKeyShares(groups: number[]): KeyShare[] {
    return groups.map(generateKeyShare);
}
