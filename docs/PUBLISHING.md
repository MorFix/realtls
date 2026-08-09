# Publishing

pnpm monorepo; packages published under the free `@realtls` org:

- **`@realtls/js`** — pure-TypeScript engine (packages/js).
- **`@realtls/native`** — uTLS backend wrapper (packages/native).
- **`@realtls/native-<platform>`** — per-platform prebuilt binaries (generated in CI).

Auth uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC): npm
trusts the GitHub Actions workflows directly, so there is **no `NPM_TOKEN`** to store.

## One-time setup

For each package name, on npmjs.com → package **Settings → Trusted Publisher**, add the
GitHub repo `MorFix/realtls` and the publishing workflow:

| Package                           | Workflow file        |
| --------------------------------- | -------------------- |
| `@realtls/js`                     | `release-js.yml`     |
| `@realtls/native`                 | `release-native.yml` |
| each `@realtls/native-<platform>` | `release-native.yml` |

A brand-new package name must be published once manually (see below) before its trusted
publisher can be configured; thereafter releases are automatic.

## Releasing

Each package releases independently when its `package.json` version changes on `main`
(workflows also support **Actions → Run workflow**). Bump with pnpm:

```bash
pnpm --filter @realtls/js version patch        # or minor / major
git commit -am "release @realtls/js" && git push
```

- `release-js.yml`: verify (lint + typecheck + tests + build) → `npm publish` (OIDC) →
  tag `js-vX.Y.Z` + GitHub Release. Idempotent (skips if the tag exists).
- `release-native.yml`: a matrix builds + publishes each `@realtls/native-<platform>`
  (checksum-verified against `binaries.json`), then publishes `@realtls/native` and tags
  `native-vX.Y.Z`. Each publish skips if that version already exists.

To ship a new uTLS version: `pnpm --filter @realtls/native run bump:binaries`, bump
`packages/native/package.json`, commit, push.

## Convenience scripts

```bash
pnpm bump <patch|minor|major|X.Y.Z> [js|native]   # bump versions (both packages by default)
pnpm publish:all [--otp=123456]                    # build + publish EVERY package locally
```

`pnpm bump` only edits `package.json` versions (no commit/tag) — commit + push to release via
CI, or run `pnpm publish:all`. The per-platform `@realtls/native-<platform>` packages inherit
`@realtls/native`'s version, so bumping `native` cascades to them.

`pnpm publish:all` builds, prepares + checksum-verifies the native binaries, then publishes
every package, **skipping versions already on npm** — safe to re-run if a 2FA OTP expires
part way (re-run with a fresh `--otp`).

## Publishing manually (first release of a new name / local)

```bash
pnpm --filter @realtls/js run build
cd packages/js && npm publish --access public   # prompts for your 2FA OTP
```

> A local interactive publish requires your 2FA one-time password. CI avoids that via
> Trusted Publishing (OIDC).
