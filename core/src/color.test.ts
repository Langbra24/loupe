import { describe, expect, it } from 'vitest'

import { cmykToHex, cmykToRgb, hexToCmyk, hexToRgb, isValidHex, rgbToCmyk, rgbToHex } from './color'

describe('hexToRgb / rgbToHex', () => {
  it('round-trips a 6-digit hex', () => {
    expect(hexToRgb('#18181b')).toEqual({ r: 24, g: 24, b: 27 })
    expect(rgbToHex({ r: 24, g: 24, b: 27 })).toBe('#18181b')
  })

  it('expands a 3-digit shorthand hex', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('accepts hex without a leading #', () => {
    expect(hexToRgb('000000')).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('falls back to black for invalid input rather than throwing', () => {
    expect(() => hexToRgb('#zzzzzz')).not.toThrow()
    expect(hexToRgb('#zzzzzz')).toEqual({ r: 0, g: 0, b: 0 })
  })
})

describe('isValidHex', () => {
  it('accepts 3- and 6-digit hex, with or without #', () => {
    expect(isValidHex('#fff')).toBe(true)
    expect(isValidHex('fff')).toBe(true)
    expect(isValidHex('#18181b')).toBe(true)
    expect(isValidHex('18181b')).toBe(true)
  })

  it('rejects malformed input', () => {
    expect(isValidHex('#1818')).toBe(false)
    expect(isValidHex('not-a-color')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('rgbToCmyk / cmykToRgb', () => {
  it('converts pure white to 0/0/0/0', () => {
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({ c: 0, m: 0, y: 0, k: 0 })
  })

  it('converts pure black to 0/0/0/100, not NaN', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 })
  })

  it('round-trips pure red', () => {
    const cmyk = rgbToCmyk({ r: 255, g: 0, b: 0 })
    expect(cmyk).toEqual({ c: 0, m: 100, y: 100, k: 0 })
    expect(cmykToRgb(cmyk)).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('clamps out-of-range CMYK input instead of producing invalid RGB', () => {
    expect(cmykToRgb({ c: 150, m: -20, y: 50, k: 0 })).toEqual({ r: 0, g: 255, b: 128 })
  })
})

describe('hexToCmyk / cmykToHex', () => {
  it('round-trips the default frame text fill to within rounding error', () => {
    // Two lossy percent-rounding steps (RGB->CMYK, then CMYK->RGB) mean this
    // is never byte-exact — that's expected for an uncalibrated conversion,
    // not a bug. Each channel should land within a couple of levels of the
    // original, not merely "some color came out."
    const roundTripped = hexToRgb(cmykToHex(hexToCmyk('#18181b')))
    const original = { r: 24, g: 24, b: 27 }
    for (const channel of ['r', 'g', 'b'] as const) {
      expect(Math.abs(roundTripped[channel] - original[channel])).toBeLessThanOrEqual(2)
    }
  })
})
