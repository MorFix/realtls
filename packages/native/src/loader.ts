import { existsSync } from 'node:fs';
import { nativePackageName, platformKey } from './platform.js';

/**
 * Loads the uTLS (`bogdanfinn/tls-client`) shared library and exposes its `request(json) ->
 * json` C ABI via koffi (FFI). The binary is NOT downloaded at runtime — it ships in a
 * per-platform package (`@realtls/native-<platform>`) that npm installs only on a matching
 * host, so this works in read-only / air-gapped environments. `REALTLS_NATIVE_LIB` overrides
 * the path (useful for tests or supplying your own build).
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

/** Resolve the shared-library path from the env override or the per-platform package. */
export async function resolveLibraryPath(): Promise<string> {
    const override = process.env.REALTLS_NATIVE_LIB;
    if (override) {
        if (!existsSync(override)) throw new Error(`REALTLS_NATIVE_LIB does not exist: ${override}`);
        return override;
    }
    const pkg = nativePackageName();
    try {
        const mod = (await import(pkg)) as { libraryPath?: string };
        if (!mod.libraryPath || !existsSync(mod.libraryPath)) {
            throw new Error('missing libraryPath');
        }
        return mod.libraryPath;
    } catch {
        throw new Error(
            `@realtls/native: prebuilt uTLS library for '${platformKey()}' not found. Install the ` +
                `optional package '${pkg}', or set REALTLS_NATIVE_LIB to a tls-client shared library.`,
        );
    }
}

/** Load (and cache) the native tls-client library. */
export async function loadTlsClient(): Promise<TlsClientLib> {
    if (cached) return cached;

    const libPath = await resolveLibraryPath();
    let imported: unknown;
    try {
        imported = await import('koffi');
    } catch {
        throw new Error("@realtls/native requires the 'koffi' dependency to be installed.");
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
    try {
        await loadTlsClient();
        return true;
    } catch {
        return false;
    }
}
