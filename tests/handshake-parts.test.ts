import { describe, it, expect } from 'vitest';
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { fromHex, hex } from '../src/index.js';
import { parseServerHello } from '../src/tls/serverhello.js';
import { generateKeyShare, x25519SharedSecret } from '../src/tls/keyexchange.js';

// RFC 8448 §3 ServerHello (90 octets), plus the client's ephemeral x25519 private key and
// the resulting ECDHE shared secret from the same trace.
const SERVER_HELLO = fromHex(`
  02 00 00 56 03 03 a6 af 06 a4 12 18 60 dc 5e 6e 60 24 9c d3 4c 95 93 0c 8a c5 cb 14
  34 da c1 55 77 2e d3 e2 69 28 00 13 01 00 00 2e 00 33 00 24 00 1d 00 20 c9 82 88 76
  11 20 95 fe 66 76 2b db f7 c6 72 e1 56 d6 cc 25 3b 83 3d f1 dd 69 b1 b0 4e 75 1f 0f
  00 2b 00 02 03 04`);
const SERVER_KEY_SHARE = 'c9828876112095fe66762bdbf7c672e156d6cc253b833df1dd69b1b04e751f0f';
const CLIENT_X25519_PRIV = '49af42ba7f7994852d713ef2784bcbcaa7911de26adc5642cb634540e7ea5005';
const ECDHE_SHARED = '8bd4054fb55b9d63fdfbacf9f04b9f0d35e6d63f537563efd46272900f89492d';

describe('ServerHello parser (RFC 8448 §3)', () => {
    it('extracts cipher suite, negotiated version and key_share', () => {
        const sh = parseServerHello(SERVER_HELLO);
        expect(sh.isHelloRetryRequest).toBe(false);
        expect(sh.cipherSuite).toBe(0x1301);
        expect(sh.selectedVersion).toBe(0x0304);
        expect(sh.keyShare?.group).toBe(0x001d); // X25519
        expect(hex(sh.keyShare?.keyExchange ?? new Uint8Array())).toBe(SERVER_KEY_SHARE);
    });
});

describe('key exchange', () => {
    it('X25519 shared secret matches the RFC 8448 vector', () => {
        const shared = x25519SharedSecret(fromHex(CLIENT_X25519_PRIV), fromHex(SERVER_KEY_SHARE));
        expect(hex(shared)).toBe(ECDHE_SHARED);
    });

    it('X25519 key share is 32 bytes and completes a round-trip with a peer', () => {
        const client = generateKeyShare(0x001d);
        expect(client.publicKey.length).toBe(32);
        const peerSecret = x25519.utils.randomSecretKey();
        const peerPublic = x25519.getPublicKey(peerSecret);
        expect(hex(client.computeSharedSecret(peerPublic))).toBe(hex(x25519SharedSecret(peerSecret, client.publicKey)));
    });

    it('X25519MLKEM768 hybrid: client key share is 1216B and both sides agree', () => {
        const client = generateKeyShare(0x11ec);
        expect(client.publicKey.length).toBe(1216); // 1184 ML-KEM ek + 32 X25519

        // Simulate the server: split client share, encapsulate to the ML-KEM ek, do X25519.
        const clientEk = client.publicKey.subarray(0, 1184);
        const clientX = client.publicKey.subarray(1184);
        const { cipherText, sharedSecret: serverKemSs } = ml_kem768.encapsulate(clientEk);
        const serverX25519Secret = x25519.utils.randomSecretKey();
        const serverX25519Public = x25519.getPublicKey(serverX25519Secret);
        const serverXShared = x25519SharedSecret(serverX25519Secret, clientX);

        // Server key_share = ML-KEM ciphertext || X25519 public; secret = kemSs || xShared.
        const serverShare = new Uint8Array([...cipherText, ...serverX25519Public]);
        const expected = new Uint8Array([...serverKemSs, ...serverXShared]);

        expect(hex(client.computeSharedSecret(serverShare))).toBe(hex(expected));
    });
});
