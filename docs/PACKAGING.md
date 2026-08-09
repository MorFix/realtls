# Packaging & cross-platform install strategy

Two published packages under the free `@realtls` org, named to distinguish the
implementations:

- **`@realtls/js`** — the pure-TypeScript engine + fetch integration (this repo). Zero
  native deps; `npm install @realtls/js` just works everywhere with no build step.
- **`@realtls/native`** — the optional uTLS backend (the shared library + its loader),
  installed only when maximum fidelity is wanted.

> On npm plans: npm _workspaces_ and _public_ scoped packages are free — only _private_
> packages/org seats cost money. So `@realtls/js` and `@realtls/native` are both free to publish.

## Tier 1 — `@realtls/js`: pure JavaScript, zero native

The default `pure` engine and all its dependencies (`@noble/*`, `undici`) are pure JS with
**no native code, no postinstall, no node-gyp**. So the default install is friction-free on
macOS / Linux / Windows, any CPU arch, and on Deno/Bun/bundlers. This is the single most
important decision: **fidelity via bytes we control, not a native library the user compiles.**

What ships in `@realtls/js`:

- ESM + `.d.ts` (already configured). Node ≥ 20.
- No `postinstall`. No compiled dependencies in `dependencies`.
- `undici` as a normal dependency (used for the Dispatcher, pooling, decompression).
- A lean `files` allowlist (`dist`, `README.md`, `AGENTS.md`).

This tier is the whole current product and is what we publish first as `@realtls/js@0.x`.

## Tier 2 — `@realtls/native`: the optional uTLS backend

`engine: 'native'` wraps **uTLS** (`bogdanfinn/tls-client`), which ships as a single
`cffi` **shared library** exposing a `request(json) -> json` C ABI (it already includes the
browser fingerprint database and HTTP/2, giving exact header order + SETTINGS). We call it
via **`koffi`** (FFI), an `optionalDependency` that ships its own prebuilt binaries.

To keep `@realtls/native` a single package while supporting many platforms, we do **not**
bundle or sub-package the ~5–10 MB shared libraries. Instead:

1. The `.so`/`.dylib`/`.dll` for each platform is published as a **GitHub Release asset**
   (free hosting), one per `os-arch`, with a SHA-256 checksum committed in the repo.
2. On first use of `engine: 'native'`, `realtls` resolves the library in this order:
   - `REALTLS_NATIVE_LIB` env var (explicit path — used in tests/air-gapped installs),
   - a previously cached download under the OS cache dir,
   - otherwise **lazy-download** the matching asset from the pinned GitHub Release,
     verify its checksum, and cache it.
3. If `koffi` is absent, the platform is unsupported, or the download fails, `engine:
'native'` throws a clear, actionable error — and callers can fall back to `pure`.

Why lazy-download over the alternatives:

- **vs. bundling all binaries in the package**: keeps the default install tiny; native
  users pay the download once instead of everyone shipping 30–60 MB.
- **vs. one npm package per platform** (esbuild model): no multi-package publish workflow;
  the pure engine never depends on any of them.
- **vs. postinstall compile**: no Go toolchain / node-gyp on user machines.

Trade-off: the first `engine: 'native'` call needs network (once). This is acceptable
because `native` is opt-in; the zero-network default (`pure`) already handles the common case.

## Runtime capability check

```ts
import { engines } from '@realtls/js';
engines.available(); // -> ['pure']  or  ['pure', 'native']
```

Consumers can pin `pure` for reproducible, dependency-light deploys (Lambda, Alpine) and
opt into `native` only where the shared library is available.

## Checklist

- [ ] `dependencies` contains only pure-JS packages; no `postinstall`.
- [ ] `koffi` is an `optionalDependency` (native backend only).
- [ ] `engine: 'native'` resolves the lib via env → cache → GitHub Release, with checksum.
- [ ] `engine: 'native'` throws a clear error (or falls back to `pure`) when unavailable.
- [ ] CI cross-compiles the uTLS shared libraries and attaches them to the GitHub Release.
- [ ] `files` allowlist keeps the published tarball lean (`dist`, `README`, `AGENTS.md`).
