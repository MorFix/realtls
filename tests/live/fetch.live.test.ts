import { describe, it, expect, afterEach } from 'vitest';
import { realFetch, install, uninstall } from '../../src/index.js';

// Opt-in live network tests. Run with: REALTLS_LIVE=1 npm run test:live

describe('drop-in fetch integration', () => {
    afterEach(() => uninstall());

    it('realFetch() gets 200 from metacareers and auto-decompresses the body', async () => {
        const res = await realFetch('https://www.metacareers.com/jobsearch/');
        expect(res.status).toBe(200);
        const html = await res.text(); // undici transparently decompresses zstd/br
        expect(html.toLowerCase()).toContain('<!doctype html');
    });

    it('install() makes the global fetch talk like Chrome', async () => {
        install();
        const res = await fetch('https://www.metacareers.com/jobsearch/');
        expect(res.status).toBe(200);
    });
});
