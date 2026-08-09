/**
 * Minimal big-endian byte writer/reader for TLS wire encoding.
 * TLS uses big-endian integers and length-prefixed vectors everywhere,
 * so the length-prefix helpers keep ClientHello construction readable.
 *
 * The reader is DataView-based on purpose: DataView accessors return `number`
 * (never `number | undefined`), which lets us satisfy `noUncheckedIndexedAccess`
 * without the banned `!` operator.
 */

export class ByteWriter {
    private chunks: number[] = [];

    u8(v: number): this {
        this.chunks.push(v & 0xff);
        return this;
    }

    u16(v: number): this {
        this.chunks.push((v >>> 8) & 0xff, v & 0xff);
        return this;
    }

    u24(v: number): this {
        this.chunks.push((v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
        return this;
    }

    u32(v: number): this {
        this.chunks.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
        return this;
    }

    bytes(b: Uint8Array | number[]): this {
        for (const x of b) {
            this.chunks.push(x & 0xff);
        }
        return this;
    }

    /** Write `cb`'s output prefixed by a u8 length. */
    u8Vec(cb: (w: ByteWriter) => void): this {
        return this.vec(1, cb);
    }

    /** Write `cb`'s output prefixed by a u16 length. */
    u16Vec(cb: (w: ByteWriter) => void): this {
        return this.vec(2, cb);
    }

    /** Write `cb`'s output prefixed by a u24 length. */
    u24Vec(cb: (w: ByteWriter) => void): this {
        return this.vec(3, cb);
    }

    private vec(lenBytes: number, cb: (w: ByteWriter) => void): this {
        const inner = new ByteWriter();
        cb(inner);
        const body = inner.result();
        if (lenBytes === 1) {
            this.u8(body.length);
        } else if (lenBytes === 2) {
            this.u16(body.length);
        } else {
            this.u24(body.length);
        }
        return this.bytes(body);
    }

    result(): Uint8Array {
        return Uint8Array.from(this.chunks);
    }

    get length(): number {
        return this.chunks.length;
    }
}

export class ByteReader {
    private off = 0;
    private readonly view: DataView;

    constructor(private readonly buf: Uint8Array) {
        this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    }

    get offset(): number {
        return this.off;
    }

    get remaining(): number {
        return this.buf.length - this.off;
    }

    u8(): number {
        this.require(1);
        const v = this.view.getUint8(this.off);
        this.off += 1;
        return v;
    }

    u16(): number {
        this.require(2);
        const v = this.view.getUint16(this.off);
        this.off += 2;
        return v;
    }

    u24(): number {
        this.require(3);
        const v = (this.view.getUint8(this.off) << 16) | this.view.getUint16(this.off + 1);
        this.off += 3;
        return v;
    }

    u32(): number {
        this.require(4);
        const v = this.view.getUint32(this.off);
        this.off += 4;
        return v >>> 0;
    }

    bytes(n: number): Uint8Array {
        this.require(n);
        const out = this.buf.subarray(this.off, this.off + n);
        this.off += n;
        return out;
    }

    private require(n: number): void {
        if (this.off + n > this.buf.length) {
            throw new RangeError(`ByteReader: need ${n} bytes at ${this.off}, have ${this.remaining}`);
        }
    }
}

export function hex(b: Uint8Array): string {
    let s = '';
    for (const x of b) {
        s += x.toString(16).padStart(2, '0');
    }
    return s;
}

export function fromHex(s: string): Uint8Array {
    const clean = s.replace(/\s+/g, '');
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const a of arrays) {
        total += a.length;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
        out.set(a, off);
        off += a.length;
    }
    return out;
}
