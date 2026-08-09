#!/usr/bin/env node
/**
 * Generate the per-platform @realtls/native-<key> sub-packages from binaries.json:
 * for each platform, write packages/<key>/{package.json,index.js} and download + verify
 * the uTLS shared library into it. These packages are published so npm installs only the
 * one matching the host (via os/cpu/libc) — no runtime download.
 *
 *   node scripts/prepare-binaries.mjs            # all platforms
 *   node scripts/prepare-binaries.mjs darwin-arm64   # just one (e.g. a CI matrix job)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const manifest = JSON.parse(readFileSync(join(root, 'binaries.json'), 'utf8'));
const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

async function download(url, expectedSha) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download ${url} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const sha = createHash('sha256').update(buf).digest('hex');
    if (sha !== expectedSha) throw new Error(`checksum mismatch for ${url}: got ${sha}, expected ${expectedSha}`);
    return buf;
}

async function prepare(key, asset) {
    const dir = join(root, 'prebuilt', key);
    mkdirSync(dir, { recursive: true });

    const pkg = {
        name: `@realtls/native-${key}`,
        version: pkgVersion,
        description: `Prebuilt uTLS shared library for @realtls/native (${key}).`,
        license: 'MIT',
        type: 'module',
        os: [asset.os],
        cpu: [asset.cpu],
        ...(asset.libc ? { libc: [asset.libc] } : {}),
        exports: { '.': './index.js' },
        main: 'index.js',
        files: ['index.js', asset.file],
        publishConfig: { access: 'public' },
        repository: {
            type: 'git',
            url: 'git+https://github.com/MorFix/realtls.git',
            directory: `packages/native/prebuilt/${key}`,
        },
    };
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

    const index = `import { fileURLToPath } from 'node:url';\nexport const libraryPath = fileURLToPath(new URL('./${asset.file}', import.meta.url));\n`;
    writeFileSync(join(dir, 'index.js'), index);

    const buf = await download(`${manifest.releaseBase}/${asset.file}`, asset.sha256);
    writeFileSync(join(dir, asset.file), buf);
    console.log(`  ${key.padEnd(16)} -> prebuilt/${key}/ (${(buf.length / 1e6).toFixed(1)} MB, verified)`);
}

const only = process.argv[2];
const keys = only ? [only] : Object.keys(manifest.assets);
console.log(`Preparing @realtls/native-* binaries (uTLS v${manifest.version})`);
for (const key of keys) {
    const asset = manifest.assets[key];
    if (!asset) throw new Error(`unknown platform key: ${key}`);
    await prepare(key, asset);
}
