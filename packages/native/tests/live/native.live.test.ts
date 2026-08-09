import { describe, it, expect } from 'vitest';
import { nativeFetch, isNativeAvailable } from '../../src/index.js';

// Opt-in live network tests. Run with: REALTLS_LIVE=1 pnpm test:live
// Requires a uTLS shared library: either an installed @realtls/native-<platform> package,
// or REALTLS_NATIVE_LIB pointing at a tls-client build.

describe('native uTLS backend (live)', () => {
    it('presents a Chrome JA4 to a live TLS-fingerprint service', async (ctx) => {
        if (!(await isNativeAvailable())) {
            ctx.skip(); // no shared library available on this machine
            return;
        }
        const res = await nativeFetch('https://tls.peet.ws/api/all');
        expect(res.status).toBe(200);
        const observed = (await res.json()) as { tls: { ja4: string } };
        // uTLS ships Chrome fingerprints; JA4 must classify as Chrome/TLS1.3/h2.
        expect(observed.tls.ja4).toMatch(/^t13d1516h2_/);
    });
});
