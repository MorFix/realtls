/**
 * Runtime-checked replacement for the `!` non-null assertion operator, which is banned
 * project-wide (see eslint.config.mjs). Unlike `!`, this throws instead of silently
 * trusting the type, so a violated assumption fails loudly rather than corrupting bytes.
 */
export function nonNull<T>(v: T | undefined | null, message = 'unexpected nullish value'): T {
    if (v === undefined || v === null) {
        throw new Error(message);
    }
    return v;
}
