// Focus ring check: one keyboard-focus treatment app-wide, at least 3:1
// against the surface it is drawn on (issue #53).
//
//   npm run verify:focus-ring      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/focus-ring.mjs
//
// Every control below is reached with the keyboard (Tab, then Shift+Tab back,
// or the reverse), so `:focus-visible` applies the way it does for a user.
//
// The contract:
//   1. Each control shows a ring: an outline (on the control, or for a field
//      inside a wrapper, on the nearest ancestor drawing one), or failing
//      that a visible box-shadow ring layer, which is reported but can't
//      match an outline.
//   2. Every ring is the same: kind, style, color, width and offset.
//   3. Each ring has >= 3:1 WCAG contrast against the background under it:
//      the first opaque background-color walking up from the ring's host
//      (from its parent when the ring is drawn outside the host's box), with
//      translucent layers on the way blended in. A translucent ring color
//      is blended over that background too.
//   4. A selected Book preview, focused, shows its selection ring and the
//      focus ring as two different colors.
//   5. No uncaught page errors.
//
// Surfaces: top nav (Export); layers panel (rename button, the Book tab, a
// page row in Book view); inspector (a select trigger, a NumberField);
// color popover (hex field, the R channel field); Export dialog (a format
// card); book setup (a page-size preset, fresh project); Book view preview.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, placeTextOnFirstPage, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** Focuses `locator`, then presses `keys` (a step away and back) so focus
 *  lands on it by keyboard. Returns whether it ended up there, :focus-visible. */
async function keyboardFocus(page, locator, keys = ["Tab", "Shift+Tab"]) {
  await locator.focus()
  for (const key of keys) await page.keyboard.press(key)
  await page.waitForTimeout(250)
  return locator.evaluate((element) => element === document.activeElement && element.matches(":focus-visible"))
}

/** The ring on the focused element, and the contrast against what's under it. */
const measureRing = (page) =>
  page.evaluate(() => {
    const ctx = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", {
      willReadFrequently: true,
    })
    /** Any CSS color (oklch included) → [r, g, b, a] in 0..1 sRGB. */
    const rgba = (color) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = "#000"
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return [r / 255, g / 255, b / 255, a / 255]
    }
    const over = (top, bottom) => top.slice(0, 3).map((v, i) => v * top[3] + bottom[i] * (1 - top[3])).concat(1)
    const luminance = ([r, g, b]) => {
      const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    }
    const ratio = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    const describe = (e) =>
      `${e.tagName.toLowerCase()}${e.getAttribute("aria-label") ? ` "${e.getAttribute("aria-label")}"` : ""}`
    const hex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`

    const focused = document.activeElement
    let host = null
    let kind = "none"
    // The focused element, or for a field wrapped by a box that draws its
    // ring (NumberField, channel fields, export cards), the nearest ancestor.
    for (let e = focused, depth = 0; e && depth < 4; e = e.parentElement, depth++) {
      const s = getComputedStyle(e)
      const { width, height } = e.getBoundingClientRect()
      // An sr-only input (the export cards' radios) can carry an outline
      // nobody sees; its card is what draws the ring.
      if (width <= 1 || height <= 1) continue
      if (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) {
        host = e
        kind = "outline"
        break
      }
    }
    let ring
    if (host) {
      const s = getComputedStyle(host)
      ring = { kind, style: s.outlineStyle, color: s.outlineColor, width: s.outlineWidth, offset: s.outlineOffset }
    } else {
      // No outline: look for a box-shadow ring layer instead, so the failure
      // says what is there.
      for (let e = focused, depth = 0; e && depth < 4; e = e.parentElement, depth++) {
        const layer = getComputedStyle(e)
          .boxShadow.split(/,(?![^(]*\))/)
          .map((l) => l.trim())
          .find((l) => !/^rgba\(0, 0, 0, 0\)/.test(l) && Number(l.match(/(-?[\d.]+)px\s*$/)?.[1] ?? 0) > 0)
        if (layer) {
          host = e
          const color = layer.match(/^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|#\w+)/)?.[1] ?? layer
          ring = { kind: "box-shadow", style: "shadow", color, width: `${layer.match(/(-?[\d.]+)px\s*$/)[1]}px`, offset: "0px" }
          break
        }
      }
    }
    if (!host) return { focused: describe(focused), ring: { kind: "none" }, contrast: 0 }

    // Under an outside ring is the host's parent; under an inset one, the host.
    let e = parseFloat(ring.offset) >= 0 || ring.kind === "box-shadow" ? host.parentElement : host
    const layers = []
    for (; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor)
      if (c[3] === 0) continue
      layers.push(c)
      if (c[3] === 1) break
    }
    if (layers.length === 0 || layers.at(-1)[3] < 1) layers.push(rgba(getComputedStyle(document.body).backgroundColor))
    const background = layers.reduceRight((under, layer) => over(layer, under), [0, 0, 0, 1])
    const ringColor = over(rgba(ring.color), background)
    return {
      focused: describe(focused),
      host: describe(host),
      ring,
      ringHex: hex(ringColor),
      backgroundHex: hex(background),
      contrast: ratio(ringColor, background),
      boxShadow: getComputedStyle(host).boxShadow,
    }
  })

const results = []
async function measure(page, label, locator, keys) {
  const visible = await keyboardFocus(page, locator, keys)
  const result = await measureRing(page)
  check(visible, `${label}: reached by keyboard with :focus-visible (focused ${result.focused})`)
  check(
    result.ring.kind !== "none",
    `${label}: shows a ring (${result.ring.kind} ${result.ring.style ?? ""} ${result.ring.width ?? ""} ${result.ring.color ?? ""}, offset ${result.ring.offset ?? "-"}, on ${result.host ?? "-"})`,
  )
  check(
    result.contrast >= 3,
    `${label}: ring ${result.ringHex ?? "-"} on ${result.backgroundHex ?? "-"} is ${result.contrast.toFixed(2)}:1 (needs 3:1)`,
  )
  results.push({ label, ...result })
  return result
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  await dismissIntroduction(page)

  // Book setup appears on the first import of a fresh project.
  await importPhotos(page)
  const setup = page.getByRole("dialog", { name: "Set up your book" })
  await setup.waitFor()
  await page.waitForTimeout(300)
  await measure(page, "book-setup preset", setup.getByRole("button", { name: "A5 Portrait", exact: true }))
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)

  const banner = page.getByRole("banner")
  const layers = page.getByRole("complementary").first()
  const inspector = page.getByRole("complementary").last()

  await measure(page, "top nav Export", banner.getByRole("button", { name: "Export" }), ["Shift+Tab", "Tab"])
  await measure(page, "layers rename button", layers.locator('button[title="Rename book"]'))

  // A text box gives the inspector a select trigger and a NumberField.
  await placeTextOnFirstPage(page)
  await measure(page, "inspector select trigger", inspector.getByRole("combobox").first())
  await measure(page, "inspector NumberField", inspector.getByRole("spinbutton").first(), ["Shift+Tab", "Tab"])

  await inspector.getByRole("button", { name: /^Color #[0-9a-f]{6}$/i }).click()
  const popover = page.getByRole("tablist", { name: "Color input mode" }).locator("xpath=ancestor::*[@data-open][1]")
  await popover.waitFor()
  await popover.getByRole("tab", { name: "RGB" }).click()
  const hex = popover.getByRole("textbox", { name: "Hex color" })
  await measure(page, "popover hex field", hex)
  await measure(page, "popover R channel", popover.getByRole("spinbutton").first(), ["Shift+Tab", "Tab"])
  await page.keyboard.press("Escape")
  await popover.waitFor({ state: "hidden" })

  await banner.getByRole("button", { name: "Export" }).click()
  const exportDialog = page.getByRole("dialog", { name: "Export book" })
  await exportDialog.waitFor()
  await page.waitForTimeout(500)
  await measure(page, "Export format card", exportDialog.locator("input[type=radio]:checked"))
  await page.keyboard.press("Escape")
  await exportDialog.waitFor({ state: "hidden" })

  // Book view: select page 1 from its row, so its preview is selected too.
  await layers.getByRole("tab", { name: "Book" }).click()
  await measure(page, "layers Book tab", layers.getByRole("tab", { name: "Book" }), ["Shift+Tab", "Tab"])
  const row = layers.getByRole("button", { name: "Page 1", exact: true })
  await row.click()
  await measure(page, "layers page row (Book view)", row)
  // The previews carry aria-label; the rows above are aria-labelledby.
  const preview = page.locator('button[aria-label="Page 1"]')
  const previewRing = await measure(page, "Book view preview (selected)", preview)

  // 2. One treatment.
  const signature = (r) => JSON.stringify([r.ring.kind, r.ring.style, r.ring.color, r.ring.width, r.ring.offset])
  const distinct = [...new Set(results.map(signature))]
  check(
    distinct.length === 1,
    `2. every ring is the same (${distinct.length} distinct: ${distinct.join(" | ")})` +
      (distinct.length === 1 ? "" : `\n    ${results.map((r) => `${r.label}: ${signature(r)}`).join("\n    ")}`),
  )

  // 4. Selection and focus stay apart on the selected preview.
  const selection = previewRing.boxShadow
    .split(/,(?![^(]*\))/)
    .map((l) => l.trim())
    .find((l) => !/^rgba\(0, 0, 0, 0\)/.test(l) && /\s0px 0px 0px 2px$/.test(l))
  const selectionColor = selection?.match(/^(\S+\([^)]*\)|#\w+)/)?.[1]
  check(
    Boolean(selection) && previewRing.ring.kind === "outline" && selectionColor !== previewRing.ring.color,
    `4. the focused selected preview shows a selection ring (${selection ?? "none"}) and a separate focus ${previewRing.ring.kind} (${previewRing.ring.color})`,
  )

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "focus-ring-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nFocus ring: PASS" : `\nFocus ring: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
