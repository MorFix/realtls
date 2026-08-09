import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Live tests hit the network and are opt-in via REALTLS_LIVE=1.
    exclude: process.env.REALTLS_LIVE ? [] : ["tests/live/**"],
    testTimeout: 30_000,
  },
});
