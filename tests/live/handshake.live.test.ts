import { describe, it, expect } from 'vitest';
import { connect, h2Request, chrome151 } from '../../src/index.js';

// Opt-in live network tests. Run with: REALTLS_LIVE=1 npm run test:live
const HOSTS = ['tls.peet.ws', 'www.metacareers.com'];

// Chrome's default navigation request headers (values that pair with the profile).
const CHROME_NAV_HEADERS: Record<string, string> = {
    'sec-ch-ua': '"Chromium";v="151", "Not.A/Brand";v="24", "Google Chrome";v="151"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'upgrade-insecure-requests': '1',
    'user-agent': chrome151.userAgent,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'sec-fetch-site': 'none',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-user': '?1',
    'sec-fetch-dest': 'document',
    'accept-encoding': 'gzip, deflate, br, zstd',
    'accept-language': 'en-US,en;q=0.9',
    priority: 'u=0, i',
};

describe('live TLS 1.3 handshake + HTTP/2', () => {
    for (const host of HOSTS) {
        it(`completes a real handshake to ${host} and negotiates h2`, async () => {
            const conn = await connect({ host, profile: chrome151 });
            expect(conn.alpn).toBe('h2');
            conn.destroy();
        });
    }

    it('fetches metacareers over HTTP/2 and is NOT blocked (200, where curl gets 401)', async () => {
        const conn = await connect({ host: 'www.metacareers.com', profile: chrome151 });
        const res = await h2Request(conn, {
            authority: 'www.metacareers.com',
            path: '/jobsearch/',
            profile: chrome151.h2,
            headers: CHROME_NAV_HEADERS,
        });
        expect(res.status).toBe(200);
    });
});
