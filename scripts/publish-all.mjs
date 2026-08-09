#!/usr/bin/env node
/**
 * Publish every realtls package: @realtls/js, @realtls/native, and all the per-platform
 * @realtls/native-<platform> binary packages.
 *
 *   pnpm publish:all [--otp=123456]
 *
 * Builds, prepares + checksum-verifies the native binaries, then publishes. Versions
 * already on npm are skipped, so it is safe to re-run (e.g. if a 2FA OTP expires part way,
 * just re-run with a fresh --otp to publish the remainder).
 *
 * For routine releases prefer CI (bump the version, push — the release workflows publish via
 * OIDC with no OTP). This is the local/manual path.
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const otpArg = process.argv.find((a) => a.startsWith('--otp='));
const otp = otpArg ? otpArg.slice('--otp='.length) : process.env.NPM_OTP;

const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit' });

function isPublished(name, version) {
    try {
        execSync(`npm view ${name}@${version} version`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function publish(dir) {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (isPublished(pkg.name, pkg.version)) {
        console.log(`skip  ${pkg.name}@${pkg.version} (already published)`);
        return;
    }
    const args = ['publish', '--access', 'public'];
    if (otp) args.push(`--otp=${otp}`);
    console.log(`publish ${pkg.name}@${pkg.version}`);
    run('npm', args, dir);
}

console.log('Building all packages...');
run('pnpm', ['-r', 'run', 'build']);

console.log('Preparing native binaries (download + checksum verify)...');
run('node', ['packages/native/scripts/prepare-binaries.mjs']);

// Publish platform binary packages first so @realtls/native's optional deps already exist.
const prebuilt = join(root, 'packages/native/prebuilt');
if (existsSync(prebuilt)) {
    for (const key of readdirSync(prebuilt)) publish(join(prebuilt, key));
}
publish(join(root, 'packages/js'));
publish(join(root, 'packages/native'));

console.log('Done.');
