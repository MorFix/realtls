# Publishing

Packages (both public, both free under the `@realtls` org):

- **`@realtls/js`** — this repo (pure-TypeScript engine + fetch integration).
- **`@realtls/native`** — the optional uTLS backend (planned).

## One-time setup — npm Trusted Publishing (OIDC, no token)

We publish from CI via [npm Trusted Publishers](https://docs.npmjs.com/trusted-publishers):
npm trusts this GitHub Actions workflow directly through OIDC, so there is **no `NPM_TOKEN`**
to create, store, or rotate.

1. The `@realtls` npm org exists (owner: `morfix`).
2. On npmjs.com, open **`@realtls/js` → Settings → Trusted Publisher** and add:
   - Provider: **GitHub Actions**
   - Repository: **`MorFix/realtls`**
   - Workflow filename: **`release.yml`**

The very first publish of a brand-new package name is done manually (see below); trusted
publishing then handles every subsequent release. The workflow already declares
`permissions: id-token: write` and installs a recent npm (≥ 11.5.1) so the OIDC handshake
works. Provenance is attached automatically.

## Releasing (automated)

The [`Release`](../.github/workflows/release.yml) workflow publishes and tags automatically:

1. Bump the version in `package.json` (e.g. `npm version patch --no-git-tag-version`).
2. Commit and push to `main` (or run it manually via **Actions → Release → Run workflow**).
3. CI verifies (lint + typecheck + tests + build), runs `npm publish --access public`
   (authenticated via OIDC), then creates the `vX.Y.Z` git tag and a GitHub Release.

The workflow is idempotent: it only releases when `package.json`'s version has no matching
`vX.Y.Z` tag.

## Publishing manually (local)

```bash
npm run build
npm publish --access public          # prompts for your 2FA OTP
```

> A local interactive publish requires your 2FA one-time password. CI avoids that via
> Trusted Publishing (OIDC) instead of a stored token.
