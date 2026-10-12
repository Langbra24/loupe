import { defineConfig } from "vitest/config"

/**
 * Scoped to plain TypeScript logic: pure function composition over mockable
 * dependencies, with no DOM, no React rendering, and no Fabric.js. Everything
 * else in this app is UI and has no test runner configured — see CLAUDE.md on
 * why `core/` is where the real engine tests live. This config exists to make
 * things like the migration-on-load wiring in `lib/storage/project.ts`, the
 * grid-position math in `components/sequence/frame-grid.ts`, the
 * frame-keyboard decision logic in `components/sequence/use-canvas-shortcuts.ts`,
 * and the GitHub-issue URL composition in `lib/feedback-url.ts` verifiable
 * without a browser.
 */
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@": import.meta.dirname,
      // `next/font/google`'s real exports only work under Next's own build
      // (a bundler loader rewrites the call at build time) — see
      // test/mocks/next-font-google.ts for why this needs a stand-in here.
      "next/font/google": `${import.meta.dirname}/test/mocks/next-font-google.ts`,
    },
  },
})
