# Packaging & cross-platform install strategy

Goal: `npm install realtls` **just works on every platform with zero native build steps**,
while the optional BoringSSL backend never blocks or breaks that install.

## Principle: the default path is 100% pure JavaScript

The default `pure` engine and all its dependencies (`@noble/*`) are pure JS with **no
native code, no postinstall, no node-gyp**. So the default install is friction-free on
macOS / Linux / Windows, any CPU arch, and on Deno/Bun/bundlers. This is the single most
important packaging decision: **fidelity via bytes we control, not via a native library
the user must compile.**

Requirements for the core:

- Ship **ESM + `.d.ts`** (already configured). Node ≥ 20.
- No `postinstall` script. No compiled dependencies in `dependencies`.
- `undici` is an optional **peer** dependency (Node already bundles it for `fetch`; we only
  need the standalone package to subclass `Dispatcher`).

## The only native piece: the optional uTLS backend

Maximum-fidelity mode (`engine: 'native'`) needs native code. Our chosen backend is
**uTLS** (`bogdanfinn/tls-client`, Go) — it already implements the full TLS stack, the
browser-fingerprint database, and HTTP/2, so our wrapper is thin. We keep it **entirely
optional** and make installation smooth using the **platform-specific optional packages**
pattern (the approach esbuild, `@napi-rs`, and Rollup/swc use):

1. Publish one prebuilt package per platform-arch, e.g.
   `@realtls/native-darwin-arm64`, `-darwin-x64`, `-linux-x64-gnu`, `-linux-arm64-gnu`,
   `-linux-x64-musl`, `-win32-x64`, each embedding the uTLS shared library for that target.
2. The main `realtls` package lists **all** of them under `optionalDependencies`. npm
   installs only the one matching the host `os`/`cpu`/`libc` (declared via each sub-package's
   `os`/`cpu`/`libc` fields) and silently skips the rest.
3. At runtime, `engine: 'native'` `require`s the matching package; if it's absent it
   throws a clear, actionable error (or optionally falls back to `pure`).

Why this pattern over the alternatives:

- **No `node-gyp` / CMake / C++ toolchain on user machines** — compilation happens once in
  CI, not on `npm install`.
- **No `postinstall` download step** (unlike `prebuild-install`), which is often blocked by
  corporate proxies/air-gapped installs and is a common source of "works on my machine".
- `optionalDependencies` means a platform we haven't built for **degrades to pure-TS**
  instead of failing the whole install.

### Building the prebuilts

A GitHub Actions matrix (macos-14/arm64, macos-13/x64, ubuntu x64+arm64 for glibc & musl,
windows x64) cross-compiles the uTLS shared library and publishes the per-platform
packages. Integration options, in order of preference:

1. **uTLS shared library via FFI** (`bogdanfinn/tls-client`'s `cffi` build, loaded with
   `koffi`/`ffi-napi`) — reuses a battle-tested browser-faithful stack including HTTP/2;
   minimal code to maintain. **Chosen approach.**
2. **N-API addon wrapping BoringSSL** — a from-scratch binding; maximum control but we'd
   re-implement the fingerprint + H2 wiring ourselves. Kept only as a fallback option.

## Runtime capability check

```ts
import { engines } from 'realtls';
engines.available(); // -> ['pure']  or  ['pure', 'native']
```

Consumers can pick `pure` explicitly for reproducible, dependency-light deploys (e.g. Lambda
layers, Alpine containers) and only opt into `native` where the prebuilt exists.

## Checklist

- [ ] `dependencies` contains only pure-JS packages; no `postinstall`.
- [ ] `optionalDependencies` lists every `@realtls/native-*` prebuilt.
- [ ] Each prebuilt declares `os` / `cpu` / `libc`.
- [ ] `engine: 'native'` throws a clear error (or falls back) when no prebuilt is present.
- [ ] CI matrix builds + publishes all prebuilts on tag.
- [ ] `files` allowlist keeps the published tarball lean (`dist`, `README`, `AGENTS.md`).
