#!/usr/bin/env node
/**
 * Bump package versions across the monorepo.
 *
 *   pnpm bump <patch|minor|major|X.Y.Z> [js|native]
 *
 * With no package name, both @realtls/js and @realtls/native are bumped. The per-platform
 * @realtls/native-<platform> packages inherit @realtls/native's version at build time
 * (prepare-binaries.mjs), so bumping `native` cascades to them automatically.
 *
 * Does NOT commit or tag — commit and push to release via CI, or run `pnpm publish:all`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = {
    js: join(root, 'packages/js/package.json'),
    native: join(root, 'packages/native/package.json'),
};

const level = process.argv[2];
const only = process.argv[3];

if (!level) {
    console.error('usage: pnpm bump <patch|minor|major|X.Y.Z> [js|native]');
    process.exit(1);
}

function nextVersion(current) {
    if (/^\d+\.\d+\.\d+([-.].+)?$/.test(level)) return level; // explicit version
    const [major, minor, patch] = current.split('.').map(Number);
    if (level === 'major') return `${major + 1}.0.0`;
    if (level === 'minor') return `${major}.${minor + 1}.0`;
    if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
    throw new Error(`unknown bump level: ${level} (use patch|minor|major|X.Y.Z)`);
}

const targets = only ? [only] : ['js', 'native'];
for (const name of targets) {
    const path = PACKAGES[name];
    if (!path) throw new Error(`unknown package: ${name} (use js|native)`);
    const pkg = JSON.parse(readFileSync(path, 'utf8'));
    const from = pkg.version;
    pkg.version = nextVersion(from);
    writeFileSync(path, JSON.stringify(pkg, null, 4) + '\n');
    console.log(`${pkg.name}: ${from} -> ${pkg.version}`);
}

console.log('\nNext: commit + push (CI releases via OIDC), or run `pnpm publish:all` locally.');
