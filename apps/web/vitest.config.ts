import { defineConfig } from "vitest/config"

/**
 * Scoped to the parts of `apps/web` that are pure function composition over
 * mockable dependencies (no DOM, no React, no Fabric.js) — `lib/storage` and,
 * as of U4, `components/sequence/frame-grid.ts`'s grid-position math. Most of
 * this app is UI and has no test runner configured — see CLAUDE.md on why
 * `core/` is where the real engine tests live. This config exists to make
 * that DOM-free logic verifiable without a browser.
 */
export default defineConfig({
  test: {
    include: ["lib/storage/**/*.test.ts", "components/sequence/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
    },
  },
})
