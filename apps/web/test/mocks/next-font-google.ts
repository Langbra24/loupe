/**
 * Vitest-only stand-in for `next/font/google`.
 *
 * `next/font/google`'s real exports (`Lora`, `Geist`, `Playfair_Display`, …)
 * only work under Next's own build (a Turbopack/webpack loader rewrites the
 * call at build time); called directly under Vitest's plain Node runtime,
 * each one throws `TypeError: Lora is not a function`. Aliased in via
 * `vitest.config.ts`'s `resolve.alias` so `apps/web/lib/fonts.ts` (the only
 * file that calls a font loader) gets a harmless fake instead — this
 * project's Vitest suite is scoped to pure logic (see that config's own doc
 * comment), so no test actually asserts on font-loading behavior; they just
 * need the module to not explode when imported transitively.
 *
 * Named exports, one per font `lib/fonts.ts` actually loads — not a Proxy
 * standing in for the whole module: `import { X } from` needs a statically
 * resolvable named export to work reliably under Vite/Vitest's ESM handling,
 * which a runtime Proxy on a default export can't reliably provide. Add a
 * line here if `lib/fonts.ts` starts loading another font.
 */
function createFontLoaderMock(name: string) {
  return () => ({
    className: `mock-font-${name}`,
    variable: `--font-mock-${name}`,
    style: { fontFamily: `"Mock ${name}", sans-serif` },
  })
}

export const Lora = createFontLoaderMock("lora")
export const Geist = createFontLoaderMock("geist")
export const Playfair_Display = createFontLoaderMock("playfair-display")
export const EB_Garamond = createFontLoaderMock("eb-garamond")
export const Libre_Baskerville = createFontLoaderMock("libre-baskerville")
export const Work_Sans = createFontLoaderMock("work-sans")
export const Archivo = createFontLoaderMock("archivo")
