# @realtls/native

Highest-fidelity backend for [realtls](https://github.com/MorFix/realtls): HTTP requests via
the uTLS ([`bogdanfinn/tls-client`](https://github.com/bogdanfinn/tls-client)) shared library,
giving **exact browser TLS _and_ HTTP/2 fingerprints** (SETTINGS + header order).

The prebuilt binary ships in per-platform packages (`@realtls/native-<platform>`) selected by
npm at install time — **nothing is downloaded or written at runtime**, so it works in
read-only and air-gapped environments. `REALTLS_NATIVE_LIB` overrides the library path.

```ts
import { nativeFetch } from '@realtls/native';

const res = await nativeFetch('https://tls.peet.ws/api/all');
console.log((await res.json()).tls.ja4); // classified as Chrome
```

See the [monorepo README](https://github.com/MorFix/realtls) and `docs/PACKAGING.md` for the
packaging model and supported platforms.
