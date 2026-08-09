import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { connect, h2Request, chrome151 } from '../../src/index.js';

// Opt-in live network tests. Run with: REALTLS_LIVE=1 npm run test:live
const HOSTS = ['tls.peet.ws', 'www.cloudflare.com'];

const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/chrome151-fingerprint.json', import.meta.url), 'utf8'),
) as { tls: { ja4: string } };

describe('live TLS 1.3 handshake + HTTP/2', () => {
    for (const host of HOSTS) {
        it(`completes a real handshake to ${host} and negotiates h2`, async () => {
            const conn = await connect({ host, profile: chrome151 });
            expect(conn.alpn).toBe('h2');
            conn.destroy();
        });
    }

    it("presents Chrome's exact JA4 to a live TLS-fingerprinting service", async () => {
        // tls.peet.ws echoes back the JA3/JA4 it observed. A server that fingerprints TLS
        // therefore cannot distinguish us from a real Chrome.
        const conn = await connect({ host: 'tls.peet.ws', profile: chrome151 });
        const res = await h2Request(conn, {
            authority: 'tls.peet.ws',
            path: '/api/all',
            profile: chrome151.h2,
            headers: { ...chrome151.defaultHeaders },
        });
        expect(res.status).toBe(200);
        const observed = JSON.parse(res.body.toString('utf8')) as { tls: { ja4: string } };
        expect(observed.tls.ja4).toBe(fixture.tls.ja4);
        conn.destroy();
    });
});
