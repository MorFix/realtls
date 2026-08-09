import { describe, it, expect } from 'vitest';
import { platformKey, nativePackageName, resolveLibraryPath } from '../src/index.js';

describe('native backend platform resolution', () => {
    it('derives a platform key and package name', () => {
        expect(platformKey()).toMatch(/^(darwin|linux|win32)-/);
        expect(nativePackageName()).toBe(`@realtls/native-${platformKey()}`);
    });

    it('rejects a REALTLS_NATIVE_LIB path that does not exist', async () => {
        const prev = process.env.REALTLS_NATIVE_LIB;
        process.env.REALTLS_NATIVE_LIB = '/nonexistent/does-not-exist.dylib';
        await expect(resolveLibraryPath()).rejects.toThrow(/does not exist/);
        if (prev === undefined) delete process.env.REALTLS_NATIVE_LIB;
        else process.env.REALTLS_NATIVE_LIB = prev;
    });
});
