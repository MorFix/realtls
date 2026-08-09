import { existsSync } from 'node:fs';

/**
 * Loads the uTLS (`bogdanfinn/tls-client`) shared library via koffi (FFI). The library
 * exposes a simple `request(json) -> json` C ABI plus `freeMemory(id)`. Because the
 * library is a large per-platform binary, it is NOT bundled in the npm package — see
 * docs/PACKAGING.md. For now it is located via the REALTLS_NATIVE_LIB env var; lazy
 * download from the GitHub Release is a documented TODO.
 */

interface KoffiLib {
    func(signature: string): (...args: unknown[]) => unknown;
}
interface Koffi {
    load(path: string): KoffiLib;
}

export interface TlsClientLib {
    request(payload: string): string;
    freeMemory(id: string): void;
}

let cached: TlsClientLib | null = null;

/** Resolve the shared-library path, or null if unavailable on this machine. */
export function resolveLibraryPath(): string | null {
    const fromEnv = process.env.REALTLS_NATIVE_LIB;
    if (fromEnv && existsSync(fromEnv)) return fromEnv;
    // TODO: check OS cache dir, then lazy-download the matching GitHub Release asset
    // (with checksum verification) as described in docs/PACKAGING.md.
    return null;
}

/** Load (and cache) the native tls-client library. Throws with guidance if unavailable. */
export async function loadTlsClient(): Promise<TlsClientLib> {
    if (cached) return cached;

    const libPath = resolveLibraryPath();
    if (!libPath) {
        throw new Error(
            'realtls native backend: uTLS shared library not found. Set REALTLS_NATIVE_LIB to the ' +
                'tls-client shared library path (see docs/PACKAGING.md).',
        );
    }

    let imported: unknown;
    try {
        imported = await import('koffi');
    } catch {
        throw new Error("realtls native backend requires the optional 'koffi' dependency (npm i koffi).");
    }
    const koffi = (imported as { default?: Koffi }).default ?? (imported as Koffi);
    const lib = koffi.load(libPath);
    const request = lib.func('str request(str)');
    const freeMemory = lib.func('void freeMemory(str)');

    cached = {
        request: (payload) => String(request(payload)),
        freeMemory: (id) => {
            freeMemory(id);
        },
    };
    return cached;
}

/** True if the native backend can be loaded on this machine (no throw). */
export async function isNativeAvailable(): Promise<boolean> {
    if (!resolveLibraryPath()) return false;
    try {
        await loadTlsClient();
        return true;
    } catch {
        return false;
    }
}
