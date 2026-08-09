# @realtls/js

Perform **TLS 1.3 + HTTP/2 exactly like a real Chrome browser** from Node/TypeScript, so
that `fetch()` can reach servers that classify clients by their TLS/HTTP fingerprint
(JA3 / JA4 / Akamai HTTP-2) and reject non-browser stacks.

Many production sites fingerprint the TLS handshake (JA3/JA4) and the HTTP/2 layer and
reject anything that isn't a real browser — `curl` and Node's default `fetch` (OpenSSL
fingerprint) get `401`/`403` where Chrome gets `200`. `realtls` makes Node send the same
bytes Chrome does. You can verify it against a TLS-fingerprint echo such as
`https://tls.peet.ws/api/all`, which reports the JA3/JA4 it observed.

## Why this is hard (and why "just set the cipher list" fails)

Node's `fetch` uses OpenSSL, which **cannot** reproduce Chrome's ClientHello:

- Chrome **shuffles its extension order** every connection (BoringSSL
  `ssl_setup_extension_permutation`) — so we target **JA4**, which is order-invariant.
- Chrome injects **GREASE** (RFC 8701) into ciphers, groups, versions, sig-algs, key_share,
  and as leading/trailing extensions.
- Chrome 151 offers **post-quantum `X25519MLKEM768`** as its first key share (1216 bytes),
  ahead of X25519.
- Anti-bot systems also fingerprint **HTTP/2** (SETTINGS, WINDOW_UPDATE, header order).

`realtls` reproduces all of the above. Ground truth is captured from a real Chrome via
`chrome-devtools` **and** raw `tcpdump`, then cross-checked against BoringSSL source. See
[`AGENTS.md`](./AGENTS.md) for the full methodology.

## Design

- **Two engines behind one interface**, pure-TypeScript is the default:
  - `pure` — a from-scratch TLS 1.3 stack over a raw socket; crypto primitives come from
    audited `@noble/*` libraries (X25519, ML-KEM-768, HKDF/SHA-2, AES-GCM/ChaCha20).
  - `native` — opt-in backend wrapping uTLS (`bogdanfinn/tls-client`) for maximum fidelity.
- **Pluggable into `fetch`**, not a replacement — the primary surface is a custom
  undici `Dispatcher`.

## Install

```bash
npm install @realtls/js
```

## Usage

```ts
import { realFetch, install } from '@realtls/js';

// 1. Drop-in fetch that talks like Chrome (auto Chrome headers + TLS + response decompress):
const res = await realFetch('https://tls.peet.ws/api/all');
console.log((await res.json()).tls.ja4); // t13d1516h2_8daaf6152771_806a8c22fdea (a real Chrome)

// 2. Or make the GLOBAL fetch talk like Chrome, then use fetch normally:
install();
await fetch('https://a-site-that-fingerprints-tls.example'); // now looks like Chrome

// 3. Or use the undici Dispatcher directly (with undici's fetch):
import { fetch } from 'undici';
import { chromeDispatcher } from '@realtls/js';
await fetch(url, { dispatcher: chromeDispatcher() });
```

> Note: the `dispatcher` option must be used with **undici's** `fetch` (or via `install()`),
> not Node's built-in global `fetch` — Node bundles a different undici build whose handler
> interface is incompatible with an external dispatcher. `realFetch`/`install` handle this.

## Low-level fingerprint API

```ts
import { buildClientHello, parseClientHello, ja4, chrome151 } from '@realtls/js';

// Build a byte-exact Chrome ClientHello and confirm its JA4:
const parsed = parseClientHello(/* your captured or built ClientHello bytes */);
console.log(ja4(parsed)); // t13d1516h2_8daaf6152771_806a8c22fdea
```

## Development

```bash
pnpm install
pnpm run check      # lint (bans `!`) + typecheck + tests
pnpm test
pnpm test:live      # opt-in network tests (REALTLS_LIVE=1)
```

### House rules

- The `!` non-null assertion operator is **banned** and fails lint/CI. Use the checked
  `nonNull()` helper instead.
- Crypto is only ever used from `@noble/*`; we do not hand-roll cryptographic primitives.
- Never commit packet captures (`*.pcap`) or key logs.

## License

MIT
