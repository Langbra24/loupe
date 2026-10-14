// Canvas chrome check: the add-page buttons and the cover badge keep a usable
// size on screen at any zoom, and the one selection color reads on both the
// dark pasteboard and a white page (issue #55).
//
//   npm run verify:canvas-chrome     # builds first, with test hooks on
//
// Sizes and colors are measured from the canvas's own pixels. The exact zoom
// levels are set through `window.__sequenceCanvas`, which exists only in a build
// made with SEQUENCE_TEST_HOOKS=1 (the npm script does that); the zoom buttons
// step by 1.25x and can't land on 10% or 50%. With SEQUENCE_URL, the server must
// be such a build.
//
// The contract, with page 1 set as the cover and selected:
//   1. The selection outline drawn around the page is one color, with WCAG
//      contrast >= 3:1 against both the pasteboard (`--canvas`, as rendered)
//      and the page's white.
//   2. At 10%, 50% and 100% zoom the "add page" button measures >= 24x24px
//      on screen and the cover badge >= 16px tall.
//   3. After zooming out with the real Zoom out button, the button is still
//      >= 24x24px; at 10% hovering it changes its fill and clicking it adds a
//      page.
//   4. Frames, images and text (including while editing) all use that same
//      selection color, and so does the frame-drag insertion indicator.
//   5. No uncaught page errors.

import path from "node:path"

import {
  dismissIntroduction,
  firstPageCenter,
  importPhotos,
  openApp,
  placePhotoOnFirstPage,
  placeTextOnFirstPage,
  settle,
  setupBook,
} from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const PAGES = 8
const ADD_PAGE_FILL = [9, 9, 11] // #09090b
const ADD_PAGE_HOVER_FILL = [24, 24, 27] // #18181b
const BADGE_FILL = [228, 228, 231] // #e4e4e7
/** Where to look, around the anchor: the "add page before" button sits left
 *  of the page's left edge; the badge sits above its top-left corner. */
const BUTTON_AREA = { x: [-80, 0], y: [-40, 40], tolerance: 3 }
// Exact fill only, so the badge's height here is what's solidly drawn: the
// bookmark's V-notched bottom tapers to points that antialias away.
const BADGE_AREA = { x: [-4, 40], y: [-100, 0], tolerance: 3 }

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** WCAG 2 relative luminance of an sRGB triple (0–255). */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

/** Pins scene point (x, y) to the middle of the canvas at `zoom`. */
const zoomAround = (point, zoom) =>
  page.evaluate(
    ({ point, zoom }) =>
      new Promise((resolve) => {
        const canvas = window.__sequenceCanvas
        canvas.setViewportTransform([
          zoom,
          0,
          0,
          zoom,
          canvas.getWidth() / 2 - zoom * point.x,
          canvas.getHeight() / 2 - zoom * point.y,
        ])
        canvas.requestRenderAll()
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      }),
    { point, zoom },
  )

/** The selected frame's left edge midpoint and its top-left bleed corner, in scene units. */
const selectedFrameAnchors = () =>
  page.evaluate(() => {
    const frame = window.__sequenceCanvas.getActiveObject()
    if (!frame?.frameId || frame.elementId) return null
    const left = frame.left - frame.width / 2
    const top = frame.top - frame.height / 2
    return { frameId: frame.frameId, leftMid: { x: left, y: frame.top }, topLeft: { x: left, y: top } }
  })

/**
 * Bounding box, in screen pixels, of the lower-canvas pixels matching `rgb`
 * (within `area.tolerance` per channel) inside `area`'s `x: [from, to]` and
 * `y: [from, to]` — screen pixels relative to the canvas middle, where
 * `zoomAround` pins the anchor being measured.
 */
const measure = (rgb, area) =>
  page.evaluate(
    ({ rgb, area }) => {
      const canvas = document.querySelector("canvas.lower-canvas")
      const scale = canvas.getBoundingClientRect().width / canvas.width
      const cx = Math.round(canvas.width / 2)
      const cy = Math.round(canvas.height / 2)
      const x0 = cx + area.x[0]
      const y0 = cy + area.y[0]
      const w = area.x[1] - area.x[0]
      const h = area.y[1] - area.y[0]
      const data = canvas.getContext("2d").getImageData(x0, y0, w, h).data
      let box = null
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          if (data[i + 3] !== 255) continue
          if ([0, 1, 2].some((c) => Math.abs(data[i + c] - rgb[c]) > area.tolerance)) continue
          const sx = x0 + x
          box = box
            ? { minX: Math.min(box.minX, sx), maxX: Math.max(box.maxX, sx), minY: Math.min(box.minY, y0 + y), maxY: Math.max(box.maxY, y0 + y) }
            : { minX: sx, maxX: sx, minY: y0 + y, maxY: y0 + y }
        }
      }
      if (!box) return null
      const rect = canvas.getBoundingClientRect()
      return {
        width: (box.maxX - box.minX + 1) * scale,
        height: (box.maxY - box.minY + 1) * scale,
        // A point inside the shape, off its center (where the plus sign is).
        inside: { x: rect.left + (box.minX + 3) * scale, y: rect.top + (box.minY + 3) * scale },
        center: { x: rect.left + ((box.minX + box.maxX) / 2) * scale, y: rect.top + ((box.minY + box.maxY) / 2) * scale },
      }
    },
    { rgb, area },
  )

/** The lower-canvas pixel under a screen point. */
const pixelAt = (point) =>
  page.evaluate((point) => {
    const canvas = document.querySelector("canvas.lower-canvas")
    const rect = canvas.getBoundingClientRect()
    const scale = canvas.width / rect.width
    const d = canvas
      .getContext("2d")
      .getImageData(Math.round((point.x - rect.left) * scale), Math.round((point.y - rect.top) * scale), 1, 1).data
    return [d[0], d[1], d[2]]
  }, point)

/**
 * The lower-canvas pixels in a 24×9 patch straddling the scene point's
 * position on screen — where a frame's left edge is, for reading its
 * selection outline. Fabric draws the active object's border on this canvas.
 */
const patchAt = (point) =>
  page.evaluate((point) => {
    const canvas = window.__sequenceCanvas
    const v = canvas.viewportTransform
    const x = Math.round(v[0] * point.x + v[4]) - 12
    const y = Math.round(v[3] * point.y + v[5]) - 4
    const data = canvas.lowerCanvasEl.getContext("2d").getImageData(x, y, 24, 9).data
    return Array.from(data)
  }, point)

/**
 * The selection outline's color: the most common color among the pixels at
 * the frame's edge that change when it's selected. The 2px border always
 * covers at least one pixel fully, so its exact color is among them.
 */
const outlineColor = (unselected, selected) => {
  const counts = new Map()
  for (let i = 0; i < selected.length; i += 4) {
    if (selected[i + 3] !== 255) continue
    if ([0, 1, 2].every((c) => selected[i + c] === unselected[i + c])) continue
    const key = `${selected[i]},${selected[i + 1]},${selected[i + 2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1])
  return top ? { rgb: top[0].split(",").map(Number), pixels: top[1] } : null
}

const clickEmptyCanvas = async () => {
  const box = await page.locator("canvas.upper-canvas").first().boundingBox()
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2)
  await page.waitForTimeout(200)
}

/** `--canvas` as the browser renders it behind the canvas. */
const pasteboardColor = () =>
  page.evaluate(() => {
    const css = getComputedStyle(document.querySelector(".canvas-dot-grid")).backgroundColor
    const probe = document.createElement("canvas").getContext("2d")
    probe.fillStyle = css
    probe.fillRect(0, 0, 1, 1)
    const d = probe.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2]]
  })

const frameCount = () =>
  page.evaluate(
    () => window.__sequenceCanvas.getObjects().filter((o) => o.frameId && !o.elementId && o.type === "rect").length,
  )

try {
  await dismissIntroduction(page)
  if (!(await page.evaluate(() => Boolean(window.__sequenceCanvas)))) {
    throw new Error(
      "window.__sequenceCanvas is missing: this build has no test hooks. Run `npm run verify:canvas-chrome`, " +
        "or build with SEQUENCE_TEST_HOOKS=1 before pointing SEQUENCE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await settle(page)

  // Page 1 becomes the cover through the real context menu, then gets selected.
  const spot = await firstPageCenter(page)
  await page.mouse.click(spot.x, spot.y, { button: "right" })
  await page.getByRole("button", { name: "Set as cover" }).click()
  await page.mouse.click(spot.x, spot.y)
  await page.waitForTimeout(300)
  const anchors = await selectedFrameAnchors()
  if (!anchors) throw new Error("Clicking page 1 didn't select its frame.")

  // 1. Selection outline contrast, from what's drawn.
  const selectedPatch = await patchAt(anchors.leftMid)
  await clickEmptyCanvas()
  const unselectedPatch = await patchAt(anchors.leftMid)
  await page.mouse.click(spot.x, spot.y)
  await page.waitForTimeout(300)
  const outline = outlineColor(unselectedPatch, selectedPatch)
  const pasteboard = await pasteboardColor()
  const white = await pixelAt(spot)
  const vsPasteboard = outline ? contrast(outline.rgb, pasteboard) : 0
  const vsWhite = outline ? contrast(outline.rgb, white) : 0
  check(
    outline && vsPasteboard >= 3,
    `1. selection outline ${outline ? hex(outline.rgb) : "(none drawn)"} vs pasteboard ${hex(pasteboard)}: ${vsPasteboard.toFixed(2)}:1 (>= 3)`,
  )
  check(outline && vsWhite >= 3, `1. selection outline vs page ${hex(white)}: ${vsWhite.toFixed(2)}:1 (>= 3)`)

  // 2. Screen size of the add-page button and cover badge at each zoom.
  for (const zoom of [0.1, 0.5, 1]) {
    await zoomAround(anchors.leftMid, zoom)
    const button = await measure(ADD_PAGE_FILL, BUTTON_AREA)
    check(
      button && button.width >= 24 && button.height >= 24,
      `2. at ${zoom * 100}% the add-page button is ${button ? `${button.width}×${button.height}px` : "not drawn"} (>= 24×24)`,
    )
    await zoomAround(anchors.topLeft, zoom)
    const badge = await measure(BADGE_FILL, BADGE_AREA)
    check(
      badge && badge.height >= 16,
      `2. at ${zoom * 100}% the cover badge is ${badge ? `${badge.width}×${badge.height}px` : "not drawn"} (>= 16px tall)`,
    )
  }

  // 3. The real zoom path, then hover and click at 10%.
  await zoomAround(anchors.leftMid, 0.5)
  await page.getByRole("button", { name: "Zoom out" }).click()
  await page.waitForTimeout(200)
  const readout = await page.getByRole("button", { name: /^Zoom \d+%/ }).textContent()
  const afterZoomOut = await measure(ADD_PAGE_FILL, BUTTON_AREA)
  check(
    readout === "40%" && afterZoomOut && afterZoomOut.width >= 24 && afterZoomOut.height >= 24,
    `3. after the Zoom out button (${readout}) the add-page button is ${afterZoomOut ? `${afterZoomOut.width}×${afterZoomOut.height}px` : "not drawn"}`,
  )

  await zoomAround(anchors.leftMid, 0.1)
  const button = await measure(ADD_PAGE_FILL, BUTTON_AREA)
  if (!button) throw new Error("No add-page button at 10%.")
  const pagesBefore = await frameCount()
  await page.mouse.move(button.center.x, button.center.y)
  await page.waitForTimeout(150)
  const hovered = await pixelAt(button.inside)
  check(
    hovered.every((v, i) => Math.abs(v - ADD_PAGE_HOVER_FILL[i]) <= 3),
    `3. hovering the button at 10% shows the hover fill (${hex(hovered)})`,
  )
  await page.mouse.click(button.center.x, button.center.y)
  await page.waitForTimeout(500)
  const pagesAfter = await frameCount()
  check(pagesAfter === pagesBefore + 1, `3. clicking it at 10% adds a page (${pagesBefore} → ${pagesAfter})`)
  await page.mouse.move(5, 5)

  // 4. Same selection color everywhere.
  await page.getByRole("button", { name: "Fit to view" }).click()
  await settle(page)
  const frameColors = await page.evaluate(() => {
    const canvas = window.__sequenceCanvas
    const frame = canvas.getObjects().find((o) => o.frameId && !o.elementId && o.type === "rect")
    return { borderColor: frame.borderColor, borderScaleFactor: frame.borderScaleFactor }
  })
  await placeTextOnFirstPage(page)
  const text = await page.evaluate(() => {
    const object = window.__sequenceCanvas.getActiveObject()
    return {
      kind: object?.elementKind,
      borderColor: object?.borderColor,
      editingBorderColor: object?.editingBorderColor,
      cornerColor: object?.cornerColor,
    }
  })
  await page.keyboard.press("Escape")
  await placePhotoOnFirstPage(page)
  const image = await page.evaluate(() => {
    const object = window.__sequenceCanvas.getActiveObject()
    return { kind: object?.elementKind, borderColor: object?.borderColor, cornerColor: object?.cornerColor }
  })
  const reference = outline ? hex(outline.rgb) : null
  const same = (value) => typeof value === "string" && value.toLowerCase() === reference
  check(
    same(frameColors.borderColor) && frameColors.borderScaleFactor >= 2,
    `4. frames: ${JSON.stringify(frameColors)} matches the drawn outline ${reference}`,
  )
  check(
    text.kind === "text" && same(text.borderColor) && same(text.editingBorderColor) && same(text.cornerColor),
    `4. text: ${JSON.stringify(text)}`,
  )
  check(image.kind === "image" && same(image.borderColor) && same(image.cornerColor), `4. images: ${JSON.stringify(image)}`)

  // The insertion indicator only exists mid-drag: drag page 2 over page 3 and read it.
  const indicator = await page.evaluate(() => {
    const canvas = window.__sequenceCanvas
    const frames = canvas.getObjects().filter((o) => o.frameId && !o.elementId && o.type === "rect")
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    const toScreen = (o) => ({ x: rect.left + v[0] * o.left + v[4], y: rect.top + v[3] * o.top + v[5] })
    return { from: toScreen(frames[1]), to: toScreen(frames[2]) }
  })
  await page.mouse.click(5, 5)
  await page.mouse.move(indicator.from.x, indicator.from.y)
  await page.mouse.down()
  await page.mouse.move((indicator.from.x + indicator.to.x) / 2, indicator.from.y, { steps: 6 })
  await page.mouse.move(indicator.to.x, indicator.to.y, { steps: 6 })
  const indicatorStroke = await page.evaluate(() =>
    window.__sequenceCanvas
      .getObjects()
      .filter((o) => o.type === "rect" && o.strokeDashArray && !o.evented && o.stroke && !o.frameId)
      .map((o) => o.stroke)
      .find((stroke) => stroke.toLowerCase() !== "#ff3b30" && stroke.toLowerCase() !== "#18a0fb"),
  )
  await page.mouse.up()
  check(same(indicatorStroke), `4. the frame-drag insertion indicator is ${indicatorStroke ?? "(not shown)"}`)

  check(errors.length === 0, `5. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "canvas-chrome-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nCanvas chrome: PASS" : `\nCanvas chrome: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
