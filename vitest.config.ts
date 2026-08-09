import { defineConfig } from 'vitest/config';

const live = Boolean(process.env.REALTLS_LIVE);

export default defineConfig({
    test: {
        include: ['packages/*/tests/**/*.test.ts'],
        // Live tests hit the network and are opt-in via REALTLS_LIVE=1.
        exclude: live ? [] : ['packages/*/tests/live/**'],
        testTimeout: 30_000,
        // Run live test files serially so parallel files don't hammer (and get
        // rate-limited by) the same free fingerprint-echo service.
        fileParallelism: !live,
    },
});
