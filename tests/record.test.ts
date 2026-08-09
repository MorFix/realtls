import { describe, it, expect } from 'vitest';
import { fromHex, hex } from '../src/index.js';
import { cipherParams, trafficKeyIv } from '../src/tls/keyschedule.js';
import { RecordProtection, plaintextRecord, readRecord } from '../src/tls/record.js';

// RFC 8448 §3: the client's handshake traffic secret, its Finished handshake message, and
// the exact encrypted record on the wire. We DERIVE the write key/iv from the traffic
// secret (tying the record layer to the key schedule), then must reproduce the record byte
// for byte — proof of correct AEAD, nonce, AAD and inner-plaintext construction.
const C_HS_TRAFFIC = 'b3eddb126e067f35a780b3abf45e2d8f3b1a950738f52e9600746a0e27a55a21';
const CLIENT_FINISHED = fromHex(`
  14 00 00 20 a8 ec 43 6d 67 76 34 ae 52 5a c1 fc eb e1 1a 03 9e c1 76 94 fa c6 e9 85
  27 b6 42 f2 ed d5 ce 61`);
const CLIENT_FINISHED_RECORD = fromHex(`
  17 03 03 00 35 75 ec 4d c2 38 cc e6 0b 29 80 44 a7 1e 21 9c 56 cc 77 b0 51 7f e9 b9
  3c 7a 4b fc 44 d8 7f 38 f8 03 38 ac 98 fc 46 de b3 84 bd 1c ae ac ab 68 67 d7 26 c4
  05 46`);

const HANDSHAKE = 22; // ContentType.handshake

describe('TLS 1.3 record layer vs RFC 8448 §3', () => {
    const params = cipherParams(0x1301);
    const { key, iv } = trafficKeyIv(params, fromHex(C_HS_TRAFFIC));

    it('encrypts the client Finished to the exact on-the-wire record', () => {
        const prot = new RecordProtection(params, key, iv);
        expect(hex(prot.encryptRecord(HANDSHAKE, CLIENT_FINISHED))).toBe(hex(CLIENT_FINISHED_RECORD));
    });

    it('decrypts the record back to the Finished and recovers the inner content type', () => {
        const prot = new RecordProtection(params, key, iv);
        const { type, data } = prot.decryptRecord(CLIENT_FINISHED_RECORD);
        expect(type).toBe(HANDSHAKE);
        expect(hex(data)).toBe(hex(CLIENT_FINISHED));
    });

    it('advances the sequence number so identical plaintext yields different records', () => {
        const prot = new RecordProtection(params, key, iv);
        const a = prot.encryptRecord(23, Uint8Array.of(1, 2, 3));
        const b = prot.encryptRecord(23, Uint8Array.of(1, 2, 3));
        expect(hex(a)).not.toBe(hex(b));
    });

    it('rejects a tampered record (AEAD authentication failure)', () => {
        const tampered = CLIENT_FINISHED_RECORD.slice();
        tampered[12] ^= 0x01;
        const prot = new RecordProtection(params, key, iv);
        expect(() => prot.decryptRecord(tampered)).toThrow();
    });
});

describe('plaintext record framing', () => {
    it('frames and re-reads a plaintext record', () => {
        const rec = plaintextRecord(HANDSHAKE, Uint8Array.of(0xde, 0xad), 0x0301);
        expect(hex(rec)).toBe('160301' + '0002' + 'dead');
        const parsed = readRecord(rec);
        expect(parsed?.type).toBe(HANDSHAKE);
        expect(parsed?.version).toBe(0x0301);
        expect(hex(parsed?.fragment ?? new Uint8Array())).toBe('dead');
        expect(parsed?.end).toBe(rec.length);
    });

    it('returns null when the record is incomplete', () => {
        const rec = plaintextRecord(HANDSHAKE, Uint8Array.of(0xde, 0xad));
        expect(readRecord(rec.subarray(0, 4))).toBeNull(); // header truncated
        expect(readRecord(rec.subarray(0, 6))).toBeNull(); // body truncated
    });
});
