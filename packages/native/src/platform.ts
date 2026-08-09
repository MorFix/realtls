import { existsSync } from 'node:fs';

/**
 * Resolve the current platform to a `@realtls/native-<key>` sub-package key. Keys match
 * binaries.json. On Linux x64 we distinguish glibc vs musl (Alpine) because the shared
 * library differs.
 */
export function platformKey(): string {
    const os = process.platform;
    const arch = process.arch;
    if (os === 'linux' && arch === 'x64') {
        return isMusl() ? 'linux-x64-musl' : 'linux-x64-glibc';
    }
    return `${os}-${arch}`;
}

function isMusl(): boolean {
    try {
        const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
        if (report?.header && 'glibcVersionRuntime' in report.header) {
            return report.header.glibcVersionRuntime === undefined;
        }
    } catch {
        // fall through to filesystem heuristic
    }
    return existsSync('/etc/alpine-release');
}

/** The npm package name that carries the prebuilt binary for this platform. */
export function nativePackageName(key = platformKey()): string {
    return `@realtls/native-${key}`;
}
