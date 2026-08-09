# realtls — Agent & Contributor Guide

> **What this is.** `realtls` performs TLS 1.3 + HTTP/2 from Node/TypeScript so that the
> bytes on the wire are indistinguishable from a real Chrome browser. This lets `fetch()`
> reach servers that classify clients by TLS/HTTP fingerprint (JA3/JA4, Akamai H2) and
> reject non-browser stacks — e.g. `https://www.metacareers.com/jobsearch/`, which returns
> `401` to `curl` and to Node's default `fetch` but `200` to Chrome.

This document records **how the project stays faithful to a real browser** and the
**key engineering decisions** behind it. `CLAUDE.md` is a symlink to this file.

---

## Faithfulness methodology (why this library can be trusted to match Chrome)

We do **not** guess at Chrome's TLS behavior. Every fingerprint-bearing byte is derived
from two independent, cross-checked sources of ground truth:

### 1. Live capture from a real Chrome, two ways (`chrome-devtools` + raw packet capture)

- **`chrome-devtools` (MCP):** we drive the actual installed Chrome to
  `https://www.metacareers.com/jobsearch/` (confirming the browser succeeds where
  `curl`/`fetch` get `401`) and to a TLS/HTTP2 reflection endpoint
  (`https://tls.peet.ws/api/all`) using Chrome's own network stack. This yields Chrome's
  **parsed** ClientHello: ordered cipher suites, ordered extensions, supported groups,
  signature algorithms, ALPN/ALPS, key-share groups, plus the **HTTP/2 fingerprint**
  (SETTINGS, WINDOW_UPDATE, pseudo-header order, header order) and the computed
  **JA3 / JA4 / Akamai** hashes.
- **Raw TCP capture (`tcpdump`):** in parallel we packet-capture the _actual_ TLS
  handshake to `www.metacareers.com` and extract the **raw ClientHello bytes** from the
  reassembled TCP stream. This is the byte-level source of truth and is what our unit
  tests assert against.

Both captures agreed. The distilled expected values live in
`tests/fixtures/chrome151-fingerprint.json`; the raw handshake bytes live in
`tests/fixtures/chrome151-clienthello-metacareers.{bin,hex}`.

> Captured profile: **Chrome 151, macOS**, 2026-08-09.
> `JA4 = t13d1516h2_8daaf6152771_806a8c22fdea`,
> `Akamai H2 = 1:65536;2:0;4:6291456;6:262144|15663105|0|m,a,s,p`.

**Reproducing a capture** (requires local sudo for packet capture):

```bash
# 1. start capture (Meta edge ranges, TCP 443)
sudo tcpdump -i en0 -s 0 -U -w cap.pcap \
  'tcp port 443 and (net 57.144.0.0/16 or net 31.13.0.0/16 or net 157.240.0.0/16)'
# 2. drive Chrome to the target + the echo endpoint (chrome-devtools MCP, or manually)
#    https://www.metacareers.com/jobsearch/  and  https://tls.peet.ws/api/all
# 3. extract + decode the ClientHello  (scripts kept under scripts/)
```

Captures (`*.pcap`) are **git-ignored** — never commit raw traffic.

### 2. Source-code inspection of the browser's real TLS stack (BoringSSL)

Empirical capture tells us _what_ Chrome sends; reading Chrome's TLS engine tells us
_why_ and — crucially — which fields are **randomized per-connection** so we replicate the
_behavior_, not just one frozen sample. Chrome uses **BoringSSL** (its fork of OpenSSL).
Relevant, verified mechanisms:

- **Extension order is permuted per connection.** BoringSSL computes a random permutation
  of the extension table (`ssl_setup_extension_permutation`, `extension_permutation`,
  toggled by `SSL_CTX_set_permute_extensions` / `SSL_set_permute_extensions`) so JA3's
  extension-order field is _unstable by design_. **Consequence:** we target **JA4**
  (order-invariant: it sorts extensions before hashing), and we likewise shuffle our
  extension order each handshake. `pre_shared_key` and `padding` are pinned last.
- **GREASE (RFC 8701 / draft-davidben-tls-grease).** BoringSSL injects fake values via
  `ssl_get_grease_value` into cipher suites, supported groups + a 1-byte GREASE key_share,
  supported_versions, signature algorithms, and as a leading + a trailing fake extension.
  We reproduce every GREASE slot; GREASE codepoints are `0x0a0a, 0x1a1a, … 0xfafa`.
- **Post-quantum key exchange.** Chrome 151 offers **`X25519MLKEM768` (0x11EC / 4588)**
  as its _first_ key_share (a 1216-byte hybrid = ML-KEM-768 encaps key ‖ X25519 pubkey),
  ahead of `X25519 (0x001D)`. BoringSSL filters PQ groups out of TLS ≤1.2. **Consequence:**
  to be byte-faithful we must send the MLKEM768 share, and if a server selects it we must
  perform ML-KEM-768 — WebCrypto has no ML-KEM, so we use `@noble/post-quantum`.
- **ECH GREASE.** When no real ECH config is available, BoringSSL sends a _GREASE_ ECH
  extension (65037) with a realistic random payload, computed outside the extension
  callbacks. We generate an equivalent GREASE ECH.

Sources:

- BoringSSL `ssl/extensions.cc`, `ssl/handshake_client.cc` (GREASE, permutation, key_share, ECH).
- Chromium "Intent to Ship: TLS ClientHello extension permutation".
- Fastly, "A first look at Chrome's TLS ClientHello permutation in the wild".

---

## Key engineering decisions

### D1 — Two engines behind one interface; **pure-TypeScript is the default**

A single `TlsEngine` interface has two implementations:

- **`pure` (default):** a from-scratch TLS 1.3 record + handshake state machine in
  TypeScript over a raw `net.Socket`, emitting a byte-for-byte Chrome ClientHello. We do
  **not** hand-roll cryptography — primitives come from audited libraries
  (`@noble/curves` X25519, `@noble/post-quantum` ML-KEM-768, `@noble/hashes` HKDF/SHA-2,
  `@noble/ciphers` AES-GCM / ChaCha20-Poly1305). Self-contained, no native build, portable.
- **`boringssl` (opt-in):** binds to a BoringSSL/curl-impersonate-style backend for
  maximum fidelity with the least reverse-engineering, at the cost of native binaries.
  Same public API; selectable via `engine: "boringssl"`.

_Rationale:_ the default must be pure-TS and dependency-light so it "just works" via npm;
BoringSSL is the escape hatch when a future Chrome detail outpaces our pure stack.

### D2 — Match the fingerprint at **both** layers: TLS **and** HTTP/2

Modern anti-bot systems fingerprint the TLS ClientHello (JA3/JA4) **and** the HTTP/2
layer (SETTINGS frame, WINDOW_UPDATE, header/pseudo-header order — the "Akamai"
fingerprint). v1 targets both. Our H2 client reproduces Chrome's exact SETTINGS
(`65536/0/6291456/262144`), initial `WINDOW_UPDATE` (`15663105`), pseudo-header order
(`m,a,s,p`) and default header order.

### D3 — Integrate _into_ `fetch`, don't replace it

The design goal is to be pluggable, not to force users off the `fetch` API. Primary
surface is a custom **undici `Dispatcher`** so existing code works unchanged:

```ts
import { chromeDispatcher } from 'realtls';
const res = await fetch('https://www.metacareers.com/jobsearch/', { dispatcher: chromeDispatcher() });
```

A convenience `realFetch(url, init)` wrapper and an `install()` that swaps the global
dispatcher are also provided for the least-invasive drop-in.

### D4 — TDD against captured ground truth

The fingerprint core is verified **offline** against the real capture: the ClientHello
builder must reproduce Chrome's cipher list, extension set, groups, sigalgs and ALPN, and
its computed **JA4 must equal the captured `t13d1516h2_8daaf6152771_806a8c22fdea`**. Key
schedule is checked against RFC 8448 vectors. Live network tests are opt-in
(`REALTLS_LIVE=1`) and include a real `200` from `www.metacareers.com`.

---

## Repository layout

```
src/
  profiles/   Browser profiles (Chrome 151): ciphers, extensions, groups, sigalgs, H2 settings
  tls/        Record layer, handshake state machine, key schedule, AEAD, ClientHello builder
    pure/       pure-TS engine
    boringssl/  native backend (opt-in)
  http2/      HTTP/2 framing, HPACK, Chrome SETTINGS + header ordering
  fetch/      undici Dispatcher / connector + realFetch wrapper
  util/       ByteWriter/Reader and helpers
tests/
  fixtures/   Captured Chrome ground truth (JSON + raw ClientHello bytes)
  live/       Opt-in network tests (REALTLS_LIVE=1)
scripts/      Capture/decode helpers (pcap → ClientHello)
```

## Conventions

- TypeScript ESM, Node ≥ 20, `strict` on. Crypto only via the `@noble/*` libraries.
- Never commit captures, key logs, or secrets. `*.pcap` is git-ignored.
- When updating the captured profile, refresh **both** the fixtures and the
  "Captured profile" line above, and re-run the JA4 assertion.
