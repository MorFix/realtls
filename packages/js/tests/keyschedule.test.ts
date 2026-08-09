import { describe, it, expect } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, hex, concatBytes } from '../src/index.js';
import {
    KeySchedule,
    cipherParams,
    hkdfExtract,
    deriveSecret,
    transcriptHash,
    trafficKeyIv,
} from '../src/tls/keyschedule.js';

// All vectors below are the "Simple 1-RTT Handshake" trace from RFC 8448 §3,
// cipher suite TLS_AES_128_GCM_SHA256 (SHA-256). Whitespace stripped by fromHex.
const CLIENT_HELLO = fromHex(`
  01 00 00 c0 03 03 cb 34 ec b1 e7 81 63 ba 1c 38 c6 da cb 19 6a 6d ff a2 1a 8d 99 12
  ec 18 a2 ef 62 83 02 4d ec e7 00 00 06 13 01 13 03 13 02 01 00 00 91 00 00 00 0b 00
  09 00 00 06 73 65 72 76 65 72 ff 01 00 01 00 00 0a 00 14 00 12 00 1d 00 17 00 18 00
  19 01 00 01 01 01 02 01 03 01 04 00 23 00 00 00 33 00 26 00 24 00 1d 00 20 99 38 1d
  e5 60 e4 bd 43 d2 3d 8e 43 5a 7d ba fe b3 c0 6e 51 c1 3c ae 4d 54 13 69 1e 52 9a af
  2c 00 2b 00 03 02 03 04 00 0d 00 20 00 1e 04 03 05 03 06 03 02 03 08 04 08 05 08 06
  04 01 05 01 06 01 02 01 04 02 05 02 06 02 02 02 00 2d 00 02 01 01 00 1c 00 02 40 01`);

const SERVER_HELLO = fromHex(`
  02 00 00 56 03 03 a6 af 06 a4 12 18 60 dc 5e 6e 60 24 9c d3 4c 95 93 0c 8a c5 cb 14
  34 da c1 55 77 2e d3 e2 69 28 00 13 01 00 00 2e 00 33 00 24 00 1d 00 20 c9 82 88 76
  11 20 95 fe 66 76 2b db f7 c6 72 e1 56 d6 cc 25 3b 83 3d f1 dd 69 b1 b0 4e 75 1f 0f
  00 2b 00 02 03 04`);

const ECDHE = '8bd4054fb55b9d63fdfbacf9f04b9f0d35e6d63f537563efd46272900f89492d';
const EARLY_SECRET = '33ad0a1c607ec03b09e6cd9893680ce210adf300aa1f2660e1b22e10f170f92a';
const EARLY_DERIVED = '6f2615a108c702c5678f54fc9dbab69716c076189c48250cebeac3576c3611ba';
const HANDSHAKE_SECRET = '1dc826e93606aa6fdc0aadc12f741b01046aa6b99f691ed221a9f0ca043fbeac';
const TRANSCRIPT_CH_SH = '860c06edc07858ee8e78f0e7428c58edd6b43f2ca3e6e95f02ed063cf0e1cad8';
const C_HS_TRAFFIC = 'b3eddb126e067f35a780b3abf45e2d8f3b1a950738f52e9600746a0e27a55a21';
const S_HS_TRAFFIC = 'b67b7d690cc16c4e75e54213cb2d37b4e9c912bcded9105d42befd59d391ad38';
const MASTER_SECRET = '18df06843d13a08bf2a449844c5f8a478001bc4d4c627984d5a41da8d0402919';
const S_HS_WRITE_KEY = '3fce516009c21727d0f2e4e86ee403bc';
const S_HS_WRITE_IV = '5d313eb2671276ee13000b30';

describe('TLS 1.3 key schedule vs RFC 8448 §3', () => {
    const params = cipherParams(0x1301);

    it('Early Secret = HKDF-Extract(0, 0)', () => {
        const early = hkdfExtract(sha256, new Uint8Array(32), new Uint8Array(32));
        expect(hex(early)).toBe(EARLY_SECRET);
    });

    it('Derive-Secret(Early, "derived", "") with empty transcript', () => {
        const derived = deriveSecret(sha256, fromHex(EARLY_SECRET), 'derived', new Uint8Array(0));
        expect(hex(derived)).toBe(EARLY_DERIVED);
    });

    it('Transcript-Hash(ClientHello || ServerHello)', () => {
        expect(hex(transcriptHash(sha256, [CLIENT_HELLO, SERVER_HELLO]))).toBe(TRANSCRIPT_CH_SH);
    });

    it('derives the full secret chain and handshake traffic secrets', () => {
        const ks = new KeySchedule(0x1301);
        expect(hex(ks.deriveHandshakeSecret(fromHex(ECDHE)))).toBe(HANDSHAKE_SECRET);

        const transcript = concatBytes(CLIENT_HELLO, SERVER_HELLO);
        expect(hex(ks.clientHandshakeTrafficSecret(transcript))).toBe(C_HS_TRAFFIC);
        expect(hex(ks.serverHandshakeTrafficSecret(transcript))).toBe(S_HS_TRAFFIC);

        expect(hex(ks.deriveMasterSecret())).toBe(MASTER_SECRET);
    });

    it('derives per-record write key + IV from a traffic secret', () => {
        const { key, iv } = trafficKeyIv(params, fromHex(S_HS_TRAFFIC));
        expect(hex(key)).toBe(S_HS_WRITE_KEY);
        expect(hex(iv)).toBe(S_HS_WRITE_IV);
    });
});
