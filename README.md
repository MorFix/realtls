# realtls

Perform **TLS 1.3 + HTTP/2 exactly like a real Chrome browser** from Node/TypeScript, so
that `fetch()` can reach servers that classify clients by their TLS/HTTP fingerprint
(JA3 / JA4 / Akamai HTTP-2) and reject non-browser stacks.

`curl` and Node's default `fetch` (OpenSSL fingerprint) get `401`/`403` where Chrome gets
`200`. `realtls` makes Node send the same bytes Chrome does. Verify it against a
TLS-fingerprint echo such as `https://tls.peet.ws/api/all`, which reports the JA3/JA4 it
observed.

## Monorepo (pnpm workspace)

| Package                                | What it is                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@realtls/js`](./packages/js)         | The pure-TypeScript engine: a from-scratch TLS 1.3 stack (byte-exact Chrome ClientHello, verified JA4) + HTTP/2 + an undici `fetch` integration. Zero native deps; installs everywhere.                                                   |
| [`@realtls/native`](./packages/native) | Optional highest-fidelity backend wrapping uTLS (`bogdanfinn/tls-client`) for exact TLS **and** HTTP/2 fingerprints. The prebuilt binary ships in per-platform packages (`@realtls/native-<platform>`); nothing is downloaded at runtime. |

```bash
npm install @realtls/js          # pure-TS engine (default)
npm install @realtls/native      # optional native backend
```

```ts
import { realFetch } from '@realtls/js';
const res = await realFetch('https://tls.peet.ws/api/all');
console.log((await res.json()).tls.ja4); // t13d1516h2_8daaf6152771_806a8c22fdea (a real Chrome)
```

See [`packages/js/README.md`](./packages/js/README.md) for the full API.

## Development

This repo uses **pnpm** workspaces.

```bash
pnpm install
pnpm run check        # lint (bans `!`) + typecheck + tests, across all packages
pnpm run build
pnpm test:live        # opt-in network tests (REALTLS_LIVE=1)
```

- Methodology & design decisions: [`AGENTS.md`](./AGENTS.md) (CLAUDE.md is a symlink).
- Packaging & cross-platform strategy: [`docs/PACKAGING.md`](./docs/PACKAGING.md).
- Publishing: [`docs/PUBLISHING.md`](./docs/PUBLISHING.md).

## House rules

- The `!` non-null assertion operator is **banned** and fails lint/CI. Use the checked
  `nonNull()` helper instead.
- Cryptography is only ever used from audited libraries (`@noble/*`); never hand-rolled.
- Never commit packet captures (`*.pcap`), key logs, or native binaries.

## License

MIT
