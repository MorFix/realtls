import { describe, it, expect } from 'vitest';
import { ByteWriter, ByteReader, hex, fromHex, concatBytes } from '../src/index.js';

describe('ByteWriter / ByteReader', () => {
    it('round-trips big-endian integers', () => {
        const w = new ByteWriter().u8(0x12).u16(0x3456).u24(0x789abc).u32(0xdeadbeef);
        const r = new ByteReader(w.result());
        expect(r.u8()).toBe(0x12);
        expect(r.u16()).toBe(0x3456);
        expect(r.u24()).toBe(0x789abc);
        expect(r.u32()).toBe(0xdeadbeef);
        expect(r.remaining).toBe(0);
    });

    it('encodes length-prefixed vectors', () => {
        const w = new ByteWriter().u16Vec((v) => v.bytes([1, 2, 3]));
        expect(hex(w.result())).toBe('0003010203');
    });

    it('nests vectors correctly', () => {
        const w = new ByteWriter().u24Vec((outer) => {
            outer.u16Vec((inner) => inner.bytes([0xaa, 0xbb]));
        });
        // u24 length = 4, then u16 length = 2, then payload
        expect(hex(w.result())).toBe('0000040002aabb');
    });

    it('hex/fromHex round-trip and throws on overread', () => {
        expect(hex(fromHex('deadBEEF'))).toBe('deadbeef');
        expect(hex(concatBytes(fromHex('00'), fromHex('ff')))).toBe('00ff');
        const r = new ByteReader(fromHex('0102'));
        r.u16();
        expect(() => r.u8()).toThrow(RangeError);
    });
});
