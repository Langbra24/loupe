import { defineConfig } from "vitest/config"

/**
 * Scoped to `lib/storage`: the only part of `apps/web` that is pure async
 * function composition over mockable dependencies (no DOM, no React, no
 * Fabric.js). Everything else in this app is UI and has no test runner
 * configured — see CLAUDE.md on why `core/` is where the real engine tests
 * live. This config exists to make the migration-on-load wiring in
 * `lib/storage/project.ts` verifiable without a browser.
 */
export default defineConfig({
  test: {
    include: ["lib/storage/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
})
