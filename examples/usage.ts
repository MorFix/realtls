/**
 * How realtls is meant to be used.
 *
 * Legend:
 *   ✅ WORKS TODAY  — the pure-TS engine + fetch integration are implemented and tested.
 *   🚧 TARGET API   — planned surface, not yet implemented.
 *
 * The examples hit https://tls.peet.ws/api/all — a TLS-fingerprint echo service that
 * reports the JA3/JA4 it observed, so you can verify the request looks like Chrome. Point
 * these at any host that fingerprints TLS to reject non-browser clients.
 *
 * This file is a design sketch and is intentionally excluded from the build/lint.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 1. The headline use case: a drop-in fetch that talks like Chrome.
// ─────────────────────────────────────────────────────────────────────────────
import { realFetch } from '@realtls/js';

const res = await realFetch('https://tls.peet.ws/api/all');
const info = await res.json(); // undici auto-decompresses gzip/br/zstd
console.log(info.tls.ja4); // t13d1516h2_8daaf6152771_806a8c22fdea  (a real Chrome 151)

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 2. Zero per-call change: install once, every global fetch() becomes browser-like.
// ─────────────────────────────────────────────────────────────────────────────
import { install } from '@realtls/js';

install(); // replaces globalThis.fetch
await fetch('https://tls.peet.ws/api/all'); // now indistinguishable from Chrome

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 3. The undici Dispatcher directly (use undici's fetch, not Node's global fetch).
// ─────────────────────────────────────────────────────────────────────────────
import { fetch as undiciFetch } from 'undici';
import { chromeDispatcher } from '@realtls/js';

const r = await undiciFetch('https://tls.peet.ws/api/all', {
    dispatcher: chromeDispatcher(),
});

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 4. Choosing a browser profile / engine explicitly.
// ─────────────────────────────────────────────────────────────────────────────
import { chrome151, nativeFetch } from '@realtls/js';

await realFetch('https://tls.peet.ws/api/all', { profile: chrome151 });
// Highest fidelity (exact HTTP/2 + header order) via the uTLS native backend:
await nativeFetch('https://tls.peet.ws/api/all', { profile: chrome151 });

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 5. What already works at the byte level: inspect/build the fingerprint itself.
// ─────────────────────────────────────────────────────────────────────────────
import { buildClientHello, parseClientHello, ja4, generateGrease, chrome151 as chrome } from '@realtls/js';
import { randomBytes } from 'node:crypto';

const clientHello = buildClientHello({
    profile: chrome,
    serverName: 'tls.peet.ws',
    clientRandom: randomBytes(32),
    sessionId: randomBytes(32),
    grease: generateGrease((n) => randomBytes(n)),
    keyShares: [
        { group: 0x11ec, keyExchange: randomBytes(1216) }, // X25519MLKEM768
        { group: 0x001d, keyExchange: randomBytes(32) }, // X25519
    ],
    echGreasePayload: randomBytes(230),
});
console.log(ja4(parseClientHello(clientHello))); // t13d1516h2_8daaf6152771_806a8c22fdea
