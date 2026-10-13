// Color picker focus check: every keyboard-focusable part of the text Color
// popover shows a visible focus ring (issue #15).
//
//   npm run verify:picker-focus      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/color-picker-focus.mjs
//
// The contract: Tab into each RGB channel field, then each CMYK one, and the
// focused field's wrapper shows a ring, meaning a visible outline (the shared
// focus ring, #53), a non-`none` box-shadow, or a border color that differs
// from an unfocused sibling's. The hex field and,
// reached with Shift+Tab, the hue slider and saturation/value square do too,
// and Tab moves on from a focused slider instead of being swallowed.

import path from "node:path"

import { openApp, openColorPicker } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** Ring evidence on `element` (or its wrapper), against an unfocused reference. */
const ringOn = (page, { wrapper }) =>
  page.evaluate((wrapper) => {
    const focused = document.activeElement
    const box = wrapper ? focused.parentElement : focused
    const style = getComputedStyle(box)
    const sibling = wrapper
      ? [...box.parentElement.children].find((child) => child !== box && !child.contains(document.activeElement))
      : null
    const borderChanged = sibling ? style.borderColor !== getComputedStyle(sibling).borderColor : false
    // Tailwind stacks transparent, zero-size shadow layers, so "not none"
    // alone proves nothing: a ring is a layer with a visible color and spread.
    const ringLayers = style.boxShadow
      .split(/,(?![^(]*\))/)
      .map((layer) => layer.trim())
      .filter((layer) => {
        const transparent = /^rgba\(0, 0, 0, 0\)/.test(layer)
        const spread = Number(layer.match(/(-?[\d.]+)px\s*$/)?.[1] ?? 0)
        return !transparent && spread > 0
      })
    // The shared focus ring (#53) is an outline.
    const outline =
      style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
        ? `outline ${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`
        : null
    return {
      name: focused.getAttribute("aria-label") ?? box.textContent.trim().slice(0, 1),
      ring: ringLayers.length > 0 || borderChanged || Boolean(outline),
      boxShadow: outline ?? (ringLayers.join(", ") || "no visible ring layer"),
    }
  }, wrapper)

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  const popover = await openColorPicker(page)
  const hex = popover.getByRole("textbox", { name: "Hex color" })

  for (const [mode, channels] of [
    ["RGB", ["R", "G", "B"]],
    ["CMYK", ["C", "M", "Y", "K"]],
  ]) {
    await popover.getByRole("tab", { name: mode }).click()
    await hex.focus()
    const hexRing = await ringOn(page, { wrapper: false })
    if (mode === "RGB") check(hexRing.ring, `hex field shows a focus ring (${hexRing.boxShadow})`)
    for (const channel of channels) {
      await page.keyboard.press("Tab")
      const result = await ringOn(page, { wrapper: true })
      check(
        result.name === channel && result.ring,
        `${mode} ${channel}: Tab focuses it and its wrapper shows a ring (focused "${result.name}", box-shadow ${result.boxShadow})`,
      )
    }
  }

  // Back up from the hex field: the hue slider, then the square.
  await hex.focus()
  for (const name of ["Hue", "Saturation and value"]) {
    await page.keyboard.press("Shift+Tab")
    const result = await ringOn(page, { wrapper: false })
    check(
      result.name === name && result.ring,
      `${name} slider: Shift+Tab focuses it and it shows a ring (focused "${result.name}", ${result.boxShadow})`,
    )
  }

  // And forward again: Tab from a focused slider moves focus, it isn't
  // swallowed by the canvas's frame Tab-cycling.
  await popover.getByRole("slider", { name: "Saturation and value" }).focus()
  await page.keyboard.press("Tab")
  const forward = await ringOn(page, { wrapper: false })
  check(forward.name === "Hue", `Tab from the square moves on to the hue slider (focused "${forward.name}")`)

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "color-picker-focus-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nColor picker focus: PASS" : `\nColor picker focus: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
