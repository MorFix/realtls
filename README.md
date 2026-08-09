# realtls

Perform **TLS 1.3 + HTTP/2 exactly like a real Chrome browser** from Node/TypeScript, so
that `fetch()` can reach servers that classify clients by their TLS/HTTP fingerprint
(JA3 / JA4 / Akamai HTTP-2) and reject non-browser stacks.

Motivating example: `https://www.metacareers.com/jobsearch/` returns **401** to `curl` and
to Node's default `fetch` (OpenSSL fingerprint), but **200** to Chrome. `realtls` makes
Node send the same bytes Chrome does.

> **Status:** the **fingerprint core is complete and tested** — a byte-exact Chrome-151
> ClientHello builder whose **JA4 matches a real Chrome** (`t13d1516h2_8daaf6152771_806a8c22fdea`)
> and whose **JA3 MD5 matches exactly** when ordered like the reference capture. The live
> handshake engine, HTTP/2 layer, and `fetch` integration are under active construction
> (see [Roadmap](#roadmap)). This is why the package is `0.x`.

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

## Usage

```ts
import { realFetch, install } from 'realtls';

// 1. Drop-in fetch that talks like Chrome (auto Chrome headers + TLS + response decompress):
const res = await realFetch('https://www.metacareers.com/jobsearch/');
console.log(res.status); // 200  (curl / default fetch get 401)

// 2. Or make the GLOBAL fetch talk like Chrome, then use fetch normally:
install();
await fetch('https://www.metacareers.com/jobsearch/'); // 200

// 3. Or use the undici Dispatcher directly (with undici's fetch):
import { fetch } from 'undici';
import { chromeDispatcher } from 'realtls';
await fetch(url, { dispatcher: chromeDispatcher() });
```

> Note: the `dispatcher` option must be used with **undici's** `fetch` (or via `install()`),
> not Node's built-in global `fetch` — Node bundles a different undici build whose handler
> interface is incompatible with an external dispatcher. `realFetch`/`install` handle this.

## Available today (fingerprint core)

```ts
import { buildClientHello, parseClientHello, ja4, chrome151 } from 'realtls';

// Build a byte-exact Chrome ClientHello and confirm its JA4:
const parsed = parseClientHello(/* your captured or built ClientHello bytes */);
console.log(ja4(parsed)); // t13d1516h2_8daaf6152771_806a8c22fdea
```

## Development

```bash
npm install
npm run check      # lint (bans `!`) + typecheck + tests
npm test
npm run test:live  # opt-in network tests (REALTLS_LIVE=1)
```

### House rules

- The `!` non-null assertion operator is **banned** and fails lint/CI. Use the checked
  `nonNull()` helper instead.
- Crypto is only ever used from `@noble/*`; we do not hand-roll cryptographic primitives.
- Never commit packet captures (`*.pcap`) or key logs.

## Roadmap

- [x] Chrome 151 profile + byte-exact ClientHello builder
- [x] JA3 / JA4 computation, validated against a real Chrome capture
- [x] TLS 1.3 record layer + key schedule (HKDF, validated vs RFC 8448)
- [x] Handshake state machine (X25519 + X25519MLKEM768, AEAD, cert + Finished verification)
- [x] Certificate compression (RFC 8879 brotli) — required by Meta
- [x] HTTP/2 via Node's built-in `http2` over our socket
- [x] **Live test: real `200` from `www.metacareers.com`** (curl/default-fetch get 401)
- [x] undici `Dispatcher` + `realFetch` / `install()` (auto Chrome headers, gzip/br/zstd decompression)
- [x] Native backend wrapping uTLS (`bogdanfinn/tls-client`) via FFI — code complete; needs the
      shared library present (`REALTLS_NATIVE_LIB`) to run. Gives exact HTTP/2 + header order.
- [ ] Auto-download the uTLS shared library from the GitHub Release (see `docs/PACKAGING.md`)
- [ ] HelloRetryRequest + session resumption/tickets

## License

MIT
