# Packaging & cross-platform install strategy

A **pnpm monorepo** publishing under the free `@realtls` org:

- **`@realtls/js`** — the pure-TypeScript engine + fetch integration. Zero native deps;
  `npm install @realtls/js` just works everywhere with no build step.
- **`@realtls/native`** — the optional uTLS backend wrapper (koffi FFI). No binary of its own.
- **`@realtls/native-<platform>`** — per-platform packages, each carrying **one** prebuilt
  uTLS shared library and declaring `os`/`cpu`/`libc`.

## Tier 1 — `@realtls/js`: pure JavaScript, zero native

The engine and its deps (`@noble/*`, `undici`) are pure JS: **no native code, no postinstall,
no node-gyp**. Friction-free on macOS / Linux / Windows, any CPU arch, and Deno/Bun/bundlers.
This is the core decision: **fidelity via bytes we control, not a native library the user compiles.**

## Tier 2 — `@realtls/native`: prebuilt binaries, no runtime download

`@realtls/native` wraps uTLS (`bogdanfinn/tls-client`) — a `cffi` shared library exposing
`request(json) -> json`, called via **`koffi`**. It ships the browser fingerprint database
and HTTP/2, giving exact header order + SETTINGS.

The ~11 MB per-platform shared library is delivered with the **platform-specific optional
packages** pattern (esbuild / `@napi-rs` / swc):

1. Each platform's library is published as its own package, e.g. `@realtls/native-darwin-arm64`,
   `-linux-x64-gnu`, `-win32-x64`, declaring `os`/`cpu`/`libc`.
2. `@realtls/native` lists all of them under `optionalDependencies`; **npm/pnpm install only
   the one matching the host** and skip the rest.
3. At runtime `@realtls/native` `import`s the matching sub-package to get the library path —
   **nothing is downloaded and nothing is written at runtime**, so it works in read-only and
   air-gapped environments (Lambda, distroless, Alpine). `REALTLS_NATIVE_LIB` overrides the
   path (custom builds / tests).

Why this over the alternatives:

- **vs. runtime download**: no filesystem write, no cold-start network, works read-only.
- **vs. bundling all binaries in one package**: installs pull only ~11 MB, not ~66 MB.
- **vs. postinstall compile**: no Go toolchain / node-gyp on user machines.

### Building & bumping the binaries

- `binaries.json` pins the uTLS release and every per-platform **sha256**.
- `pnpm --filter @realtls/native run bump:binaries [version]` refreshes `binaries.json`
  (downloads each asset, recomputes checksums) — see `scripts/bump-binaries.mjs`.
- `scripts/prepare-binaries.mjs <key>` generates `prebuilt/<key>/` (package.json + index.js +
  the checksum-verified binary). CI runs it per platform in a matrix and publishes each
  sub-package, then `@realtls/native` (see `.github/workflows/release-native.yml`).

## Runtime capability check

```ts
import { isNativeAvailable } from '@realtls/native';
await isNativeAvailable(); // false if no prebuilt for this platform and no REALTLS_NATIVE_LIB
```

Pin `@realtls/js` for reproducible, dependency-light deploys; add `@realtls/native` only where
the higher-fidelity HTTP/2 fingerprint is needed and a prebuilt exists.
