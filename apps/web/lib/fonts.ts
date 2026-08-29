import {
  Archivo,
  EB_Garamond,
  Geist,
  Libre_Baskerville,
  Lora,
  Playfair_Display,
  Work_Sans,
} from "next/font/google"

/**
 * Every font this app loads, in one place — `layout.tsx` applies the
 * `.variable` CSS custom properties to `<html>`, and the text tool's font
 * picker (`inspector-panel.tsx`'s `TextElementSettings`) reads `TEXT_FONTS`
 * below to both populate its `Select` and resolve a `TextElement.fontFamily`
 * key into an actual `font-family` string for Fabric's canvas rendering.
 *
 * All Google Fonts, all OFL-licensed (CLAUDE.md's hard rule — fonts get
 * embedded in exported PDFs, and commercial/desktop-only licenses often
 * forbid that).
 *
 * Fabric draws text on a `<canvas>` 2D context, which can't resolve CSS
 * custom properties (`var(--font-lora)`) the way DOM elements can — it needs
 * the literal font-family string the browser actually has a loaded
 * `@font-face` for. `next/font/google`'s `.style.fontFamily` is exactly
 * that (a scoped, hashed name matching the stylesheet Next.js injects), so
 * `TEXT_FONTS` below carries both forms: `variable` for DOM/CSS use,
 * `cssFontFamily` for the canvas.
 */
const lora = Lora({ subsets: ["latin"], variable: "--font-heading" })
const geist = Geist({ subsets: ["latin"], variable: "--font-sans" })
const playfairDisplay = Playfair_Display({ subsets: ["latin"], variable: "--font-playfair-display" })
const ebGaramond = EB_Garamond({ subsets: ["latin"], variable: "--font-eb-garamond" })
const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-libre-baskerville",
})
const workSans = Work_Sans({ subsets: ["latin"], variable: "--font-work-sans" })
const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo" })

/** Every loaded font's `.variable`, applied to `<html>` in `layout.tsx` so
 *  every font's CSS custom property is available app-wide. */
export const FONT_VARIABLES = [
  lora.variable,
  geist.variable,
  playfairDisplay.variable,
  ebGaramond.variable,
  libreBaskerville.variable,
  workSans.variable,
  archivo.variable,
].join(" ")

export interface TextFontOption {
  /** Stored on `TextElement.fontFamily` (core/src/types.ts). */
  value: string
  label: string
  category: "serif" | "sans"
  /** The literal font-family string Fabric's Textbox needs — see the module
   *  doc comment above for why this can't just be the CSS variable. */
  cssFontFamily: string
}

/**
 * Curated for photobooks/zines specifically, not a general type-scale — a
 * short, opinionated list rather than the full Google Fonts catalog. Serif
 * first because that's the default (see `DEFAULT_TEXT_FONT`): most photobook
 * body/caption text leans serif, sans is the secondary/contrast choice.
 */
export const TEXT_FONTS: readonly TextFontOption[] = [
  { value: "lora", label: "Lora", category: "serif", cssFontFamily: lora.style.fontFamily },
  {
    value: "playfair-display",
    label: "Playfair Display",
    category: "serif",
    cssFontFamily: playfairDisplay.style.fontFamily,
  },
  {
    value: "eb-garamond",
    label: "EB Garamond",
    category: "serif",
    cssFontFamily: ebGaramond.style.fontFamily,
  },
  {
    value: "libre-baskerville",
    label: "Libre Baskerville",
    category: "serif",
    cssFontFamily: libreBaskerville.style.fontFamily,
  },
  { value: "geist", label: "Geist", category: "sans", cssFontFamily: geist.style.fontFamily },
  { value: "work-sans", label: "Work Sans", category: "sans", cssFontFamily: workSans.style.fontFamily },
  { value: "archivo", label: "Archivo", category: "sans", cssFontFamily: archivo.style.fontFamily },
]

/** New text elements default to a serif — "most photobooks use a serif
 *  font" (user-directed). Lora specifically since it was already this
 *  project's one loaded serif before tonight. */
export const DEFAULT_TEXT_FONT = "lora"

const FONT_BY_VALUE = new Map(TEXT_FONTS.map((font) => [font.value, font]))

/** Resolves a `TextElement.fontFamily` value to the literal font-family
 *  string Fabric needs, falling back to the default serif for an unset or
 *  unrecognized value (e.g. an older project's text element predating this
 *  field). */
export function resolveTextFontFamily(value: string | undefined): string {
  const font = FONT_BY_VALUE.get(value ?? DEFAULT_TEXT_FONT) ?? FONT_BY_VALUE.get(DEFAULT_TEXT_FONT)
  return font?.cssFontFamily ?? "serif"
}
