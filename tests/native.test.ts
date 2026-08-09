import { describe, it, expect } from 'vitest';
import { engines, resolveLibraryPath, nativeFetch } from '../src/index.js';

// These run without the uTLS shared library present, verifying graceful degradation.
describe('native backend availability (no library installed)', () => {
    it('resolveLibraryPath() returns null when REALTLS_NATIVE_LIB is unset', () => {
        const prev = process.env.REALTLS_NATIVE_LIB;
        delete process.env.REALTLS_NATIVE_LIB;
        expect(resolveLibraryPath()).toBeNull();
        if (prev !== undefined) process.env.REALTLS_NATIVE_LIB = prev;
    });

    it('engines.available() reports only pure when native is unavailable', async () => {
        const prev = process.env.REALTLS_NATIVE_LIB;
        delete process.env.REALTLS_NATIVE_LIB;
        expect(await engines.available()).toEqual(['pure']);
        if (prev !== undefined) process.env.REALTLS_NATIVE_LIB = prev;
    });

    it('nativeFetch() throws an actionable error when the library is missing', async () => {
        const prev = process.env.REALTLS_NATIVE_LIB;
        delete process.env.REALTLS_NATIVE_LIB;
        await expect(nativeFetch('https://example.com')).rejects.toThrow(/REALTLS_NATIVE_LIB|shared library/);
        if (prev !== undefined) process.env.REALTLS_NATIVE_LIB = prev;
    });
});
