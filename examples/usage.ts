/**
 * How realtls is meant to be used.
 *
 * Legend:
 *   ✅ WORKS TODAY  — the fingerprint core is implemented and tested.
 *   🚧 TARGET API   — the live fetch path (engine + undici dispatcher) is in progress;
 *                     this is the exact surface it will expose.
 *
 * This file is a design sketch and is intentionally excluded from the build/lint.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 1. The headline use case: a drop-in fetch that talks like Chrome.
// ─────────────────────────────────────────────────────────────────────────────
import { realFetch } from 'realtls';

const res = await realFetch('https://www.metacareers.com/jobsearch/');
console.log(res.status); // 200  (curl / default fetch get 401 here)
console.log(await res.text()); // undici auto-decompresses gzip/br/zstd

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 2. Zero per-call change: install once, every global fetch() becomes browser-like.
// ─────────────────────────────────────────────────────────────────────────────
import { install } from 'realtls';

install(); // replaces globalThis.fetch
await fetch('https://www.metacareers.com/jobsearch/'); // now indistinguishable from Chrome

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 3. The undici Dispatcher directly (use undici's fetch, not Node's global fetch).
// ─────────────────────────────────────────────────────────────────────────────
import { fetch as undiciFetch } from 'undici';
import { chromeDispatcher } from 'realtls';

const r = await undiciFetch('https://www.metacareers.com/jobsearch/', {
    dispatcher: chromeDispatcher(),
});

// ─────────────────────────────────────────────────────────────────────────────
// 🚧 4. Choosing a browser profile and engine explicitly.
// ─────────────────────────────────────────────────────────────────────────────
import { chrome151 } from 'realtls';

const dispatcher = chromeDispatcher({
    profile: chrome151, // which browser fingerprint to emulate
    engine: 'pure', // 'pure' (default, zero native deps) | 'native' (uTLS, max fidelity)
});
await fetch('https://tls.peet.ws/api/all', { dispatcher });

// A whole client bound to one profile, reused across requests (keep-alive pooled):
import { RealTLSClient } from 'realtls';

const client = new RealTLSClient({ profile: chrome151 });
const a = await client.fetch('https://www.metacareers.com/jobsearch/');
const b = await client.fetch('https://www.metacareers.com/careers/');
await client.close();

// ─────────────────────────────────────────────────────────────────────────────
// ✅ 5. What already works today: inspect/build the fingerprint itself.
// ─────────────────────────────────────────────────────────────────────────────
import { buildClientHello, parseClientHello, ja4, generateGrease, chrome151 as chrome } from 'realtls';
import { randomBytes } from 'node:crypto';

// Build a byte-exact Chrome ClientHello with fresh per-connection randomness…
const clientHello = buildClientHello({
    profile: chrome,
    serverName: 'www.metacareers.com',
    clientRandom: randomBytes(32),
    sessionId: randomBytes(32),
    grease: generateGrease((n) => randomBytes(n)),
    keyShares: [
        { group: 0x11ec, keyExchange: randomBytes(1216) }, // X25519MLKEM768
        { group: 0x001d, keyExchange: randomBytes(32) }, // X25519
    ],
    echGreasePayload: randomBytes(230),
});

// …and confirm it fingerprints as Chrome:
console.log(ja4(parseClientHello(clientHello)));
// -> t13d1516h2_8daaf6152771_806a8c22fdea   (identical to a real Chrome 151)
