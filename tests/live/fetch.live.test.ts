import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { realFetch, install, uninstall } from '../../src/index.js';

// Opt-in live network tests. Run with: REALTLS_LIVE=1 npm run test:live

const fixture = JSON.parse(
    readFileSync(new URL('../fixtures/chrome151-fingerprint.json', import.meta.url), 'utf8'),
) as { tls: { ja4: string } };

describe('drop-in fetch integration', () => {
    afterEach(() => uninstall());

    it("realFetch() presents Chrome's JA4 and auto-decompresses the response", async () => {
        const res = await realFetch('https://tls.peet.ws/api/all');
        expect(res.status).toBe(200);
        const observed = (await res.json()) as { tls: { ja4: string } };
        expect(observed.tls.ja4).toBe(fixture.tls.ja4); // undici transparently decompresses zstd/br
    });

    it('install() makes the global fetch talk like Chrome', async () => {
        install();
        const res = await fetch('https://tls.peet.ws/api/all');
        const observed = (await res.json()) as { tls: { ja4: string } };
        expect(observed.tls.ja4).toBe(fixture.tls.ja4);
    });
});
