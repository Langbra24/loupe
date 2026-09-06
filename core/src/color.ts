/**
 * RGB / CMYK / hex conversions for the text sidebar's color picker (R:
 * photographers and print professionals think in RGB or CMYK, not hex —
 * see `apps/web/components/shell/inspector-panel.tsx`'s `ColorField`).
 * Pure arithmetic on plain numbers, no DOM — this is `core/`.
 *
 * These are the standard uncalibrated RGB<->CMYK formulas every lightweight
 * (non-color-managed) tool uses to let someone *choose* a color in either
 * space. They are not a substitute for a real ICC profile conversion — there
 * is no rendering intent, no profile, no gamut mapping here — so the CMYK
 * values this produces are a close, useful approximation for picking a
 * color, not a press-accurate proof. `TextElement.color` itself always
 * stores the resulting hex; CMYK/RGB are just two ways of arriving at it.
 */

export interface RgbColor {
  r: number
  g: number
  b: number
}

export interface CmykColor {
  c: number
  m: number
  y: number
  k: number
}

export function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

export function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Accepts `#rgb`, `#rrggbb`, or the same without the leading `#`. */
export function isValidHex(value: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
}

/** Invalid input falls back to black rather than throwing — callers (the
 *  sidebar's hex text field, mid-keystroke) need a value on every render,
 *  not an exception on every incomplete edit. */
export function hexToRgb(hex: string): RgbColor {
  const stripped = hex.replace('#', '')
  const full = stripped.length === 3 ? stripped.replace(/./g, (ch) => ch + ch) : stripped
  const int = Number.parseInt(full.padEnd(6, '0').slice(0, 6), 16)
  if (Number.isNaN(int)) return { r: 0, g: 0, b: 0 }
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 }
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  const byteHex = (n: number) => clampByte(n).toString(16).padStart(2, '0')
  return `#${byteHex(r)}${byteHex(g)}${byteHex(b)}`
}

export function rgbToCmyk({ r, g, b }: RgbColor): CmykColor {
  const rf = clampByte(r) / 255
  const gf = clampByte(g) / 255
  const bf = clampByte(b) / 255
  const k = 1 - Math.max(rf, gf, bf)
  // Pure black: c/m/y are undefined (0/0) in the usual formula — define them
  // as 0 rather than NaN.
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: clampPercent(((1 - rf - k) / (1 - k)) * 100),
    m: clampPercent(((1 - gf - k) / (1 - k)) * 100),
    y: clampPercent(((1 - bf - k) / (1 - k)) * 100),
    k: clampPercent(k * 100),
  }
}

export function cmykToRgb({ c, m, y, k }: CmykColor): RgbColor {
  const cf = clampPercent(c) / 100
  const mf = clampPercent(m) / 100
  const yf = clampPercent(y) / 100
  const kf = clampPercent(k) / 100
  return {
    r: clampByte(255 * (1 - cf) * (1 - kf)),
    g: clampByte(255 * (1 - mf) * (1 - kf)),
    b: clampByte(255 * (1 - yf) * (1 - kf)),
  }
}

export function hexToCmyk(hex: string): CmykColor {
  return rgbToCmyk(hexToRgb(hex))
}

export function cmykToHex(cmyk: CmykColor): string {
  return rgbToHex(cmykToRgb(cmyk))
}
