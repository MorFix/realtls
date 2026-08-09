# Publishing

Packages (both public, both free under the `@realtls` org):

- **`@realtls/js`** — this repo (pure-TypeScript engine + fetch integration).
- **`@realtls/native`** — the optional uTLS backend (planned).

## One-time setup

1. **Create the npm org** `realtls` (free, unlimited public packages):
   https://www.npmjs.com/org/create → name `realtls` → Free plan.
   (The `@realtls` scope does not exist until this org is created.)

2. **Create an npm Automation token** (Access Tokens → Generate → **Automation**).
   Automation tokens bypass 2FA/OTP, which is required for CI publishing.

3. **Add it as a GitHub Actions secret** named `NPM_TOKEN`
   (repo → Settings → Secrets and variables → Actions → New repository secret).

## Releasing (automated)

The [`Release`](../.github/workflows/release.yml) workflow publishes and tags automatically:

1. Bump the version in `package.json` (e.g. `npm version patch --no-git-tag-version`).
2. Commit and push to `main`.
3. CI verifies (lint + typecheck + tests + build), runs `npm publish --access public
--provenance`, then creates the `vX.Y.Z` git tag and a GitHub Release.

The workflow is idempotent: it only releases when `package.json`'s version has no matching
`vX.Y.Z` tag, and it safely no-ops until `NPM_TOKEN` is set.

## Publishing manually (first release or local)

```bash
npm run build
npm publish --access public          # prompts for your 2FA OTP
# or, with an automation token in ~/.npmrc, no OTP needed.
```

> Note: a normal interactive publish requires your 2FA one-time password. CI uses an
> Automation token specifically to avoid that.
