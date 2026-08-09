import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildClientHello,
    parseClientHello,
    ja4,
    ja4Raw,
    ja3,
    chrome151,
    isGrease,
    type KeyShareEntry,
} from '../src/index.js';
import type { GreaseValues } from '../src/tls/grease.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/chrome151-fingerprint.json', import.meta.url), 'utf8')) as {
    tls: {
        ja4: string;
        ja4_r: string;
        ja3_hash: string;
        cipher_suites_no_grease: number[];
        supported_groups_no_grease: number[];
    };
};

const capturedBytes = new Uint8Array(readFileSync(new URL('./fixtures/chrome151-clienthello.bin', import.meta.url)));

/** Deterministic inputs so the builder's output is reproducible in tests. */
const grease: GreaseValues = {
    cipher: 0x0a0a,
    group: 0x1a1a,
    extensionFirst: 0x2a2a,
    extensionLast: 0x3a3a,
    version: 0x4a4a,
};
const keyShares: KeyShareEntry[] = [
    { group: 0x11ec, keyExchange: new Uint8Array(1216) }, // X25519MLKEM768
    { group: 0x001d, keyExchange: new Uint8Array(32) }, // X25519
];
const baseParams = {
    profile: chrome151,
    serverName: 'tls.peet.ws',
    clientRandom: new Uint8Array(32),
    sessionId: new Uint8Array(32),
    keyShares,
    grease,
    echGreasePayload: new Uint8Array(230),
};

describe('captured Chrome 151 ground truth', () => {
    it('parser + JA4 reproduce Chrome from the raw captured ClientHello', () => {
        const parsed = parseClientHello(capturedBytes);
        expect(parsed.serverName).toBe('tls.peet.ws');
        expect(ja4(parsed)).toBe(fixture.tls.ja4);
        expect(ja4Raw(parsed)).toBe(fixture.tls.ja4_r);
    });
});

describe('our ClientHello builder matches Chrome', () => {
    it("produces Chrome's JA4 regardless of extension shuffle", () => {
        // Identity order, a reversed-middle order, and a random order must all give the
        // same JA4 — JA4 is order-invariant, which is the whole point.
        const orders = [
            undefined,
            [...Array(16).keys()].reverse(),
            [7, 4, 9, 6, 2, 11, 3, 5, 0, 12, 1, 10, 14, 8, 13, 15],
        ];
        for (const permutation of orders) {
            const msg = buildClientHello({ ...baseParams, permutation });
            expect(ja4(parseClientHello(msg))).toBe(fixture.tls.ja4);
        }
    });

    it("reproduces Chrome's exact JA3 hash when extensions are ordered like the reference capture", () => {
        // JA3 is order-dependent; with the reference capture's extension order we must
        // land on the exact same MD5 as Chrome produced.
        const permutation = [7, 4, 9, 6, 2, 11, 3, 5, 0, 12, 1, 10, 14, 8, 13, 15];
        const msg = buildClientHello({ ...baseParams, permutation });
        expect(ja3(parseClientHello(msg)).hash).toBe(fixture.tls.ja3_hash);
    });

    it('matches the captured cipher suites, groups, sigalgs and ALPN (ignoring GREASE)', () => {
        const ours = parseClientHello(buildClientHello(baseParams));
        const captured = parseClientHello(capturedBytes);

        const noGrease = (xs: number[]) => xs.filter((x) => !isGrease(x));
        expect(noGrease(ours.cipherSuites)).toEqual(fixture.tls.cipher_suites_no_grease);
        expect(noGrease(ours.cipherSuites)).toEqual(noGrease(captured.cipherSuites));
        expect(noGrease(ours.supportedGroups)).toEqual(fixture.tls.supported_groups_no_grease);
        expect(noGrease(ours.supportedGroups)).toEqual(noGrease(captured.supportedGroups));
        expect(ours.signatureAlgorithms).toEqual(captured.signatureAlgorithms);
        expect(ours.alpn).toEqual(captured.alpn);

        const typeSet = (ch: ReturnType<typeof parseClientHello>) =>
            ch.extensions
                .map((e) => e.type)
                .filter((t) => !isGrease(t))
                .sort((a, b) => a - b);
        expect(typeSet(ours)).toEqual(typeSet(captured));
    });
});
