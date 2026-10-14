// Polish pass (#59: P1–P5 in todos/2026-10-13-emil-ui-polish.md).
//
//   npm run verify:polish        # builds first
//
// The contract:
//   1. Busy labels don't resize their buttons: Export → "Exporting…" and
//      "Import photos" → "Importing n of m…" keep one width from idle through
//      every progress tick. Both runs are CPU-throttled so the busy state
//      lasts long enough to sample on every animation frame.
//   2. Numbers that change are tabular: the zoom readout, the export and
//      import progress text, NumberField inputs, the colour channel fields
//      and the inspector's page count.
//   3. Small controls have hit areas of at least 24×24, measured with
//      elementFromPoint out from the control's centre (so a pseudo-element
//      counts and the visual box doesn't): the NumberField steppers, the
//      Export padding note's info button, the rename button, the canvas
//      toolbar buttons and the three dismiss buttons. A hovered field's
//      stepper targets stop short of the next field.
//   4. `font-synthesis` is `none` on body, and the intro's name isn't italic.
//   5. Reloading a project that has pages never paints the intro or the
//      empty-canvas copy, sampled on every animation frame from first paint,
//      and focus never lands on the intro's "Get started". A fresh context
//      (empty IndexedDB) still gets the intro.

import path from "node:path"
import { readFileSync } from "node:fs"

import {
  FIXTURE_PHOTOS,
  dismissIntroduction,
  importPhotos,
  openApp,
  openColorPicker,
  placePhotoOnFirstPage,
  settle,
  setupBook,
  firstPageCenter,
} from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const MIN_HIT = 24
const EMPTY_COPY = "Bring in your photographs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()

/** Runs one scenario in a fresh browser, screenshotting the page if it throws or fails. */
async function scenario(name, run, options) {
  const { browser, page, errors } = await openApp(app.url, options)
  const before = failures.length
  try {
    await run(page)
  } catch (error) {
    check(false, `${name}: ${error.message.split("\n")[0]}`)
  }
  if (errors.length) check(false, `${name}: page errors: ${errors.join("; ")}`)
  if (failures.length > before) {
    const shot = path.join(repoRoot, "screenshots", `polish-failure-${name.replace(/\W+/g, "-")}.png`)
    await page.screenshot({ path: shot }).catch(() => {})
    console.error(`  page at failure → ${path.relative(repoRoot, shot)}`)
  }
  await browser.close()
}

/**
 * The region around the control's centre where elementFromPoint lands on the
 * control (or something inside it), walked out a pixel at a time along both
 * axes. Returns its size and its box in viewport coordinates.
 */
async function hitArea(locator) {
  return locator.evaluate((target) => {
    const rect = target.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const hits = (x, y) => {
      const element = document.elementFromPoint(x, y)
      return !!element && (element === target || target.contains(element))
    }
    if (!hits(cx, cy)) return { width: 0, height: 0, top: cy, bottom: cy }
    const reach = (dx, dy) => {
      let n = 0
      while (n < 80 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++
      return n
    }
    const up = reach(0, -1)
    const down = reach(0, 1)
    return {
      width: reach(-1, 0) + reach(1, 0) + 1,
      height: up + down + 1,
      top: cy - up,
      bottom: cy + down,
    }
  })
}

async function checkHitArea(label, locator) {
  const area = await hitArea(locator)
  check(
    area.width >= MIN_HIT && area.height >= MIN_HIT,
    `${label}: hit area ${area.width}×${area.height} (at least ${MIN_HIT}×${MIN_HIT})`,
  )
  return area
}

const numericStyle = (locator) => locator.evaluate((node) => getComputedStyle(node).fontVariantNumeric)
async function checkTabular(label, locator) {
  const value = await numericStyle(locator)
  check(value.includes("tabular-nums"), `${label}: font-variant-numeric is "${value}"`)
}

/** Moves the pointer somewhere inert, so no tooltip covers what's measured. */
const parkPointer = (page) => page.mouse.move(720, 24)

/** Unique copies of the fixtures, so one import runs long enough to sample. */
function manyPhotos(count) {
  return Array.from({ length: count }, (_, index) => ({
    name: `copy-${index}.jpg`,
    mimeType: "image/jpeg",
    buffer: readFileSync(FIXTURE_PHOTOS[index % FIXTURE_PHOTOS.length]),
  }))
}

async function throttle(page, rate) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Emulation.setCPUThrottlingRate", { rate })
  return () => cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
}

/**
 * Samples a button's width and busy state (disabled) on every animation
 * frame until `stop()`, plus `font-variant-numeric` of whatever progress text
 * matches `progress` at the time.
 */
async function sampleButton(page, handle, progress) {
  await page.evaluate(
    ([button, source]) => {
      const pattern = new RegExp(source)
      window.__samples = []
      window.__sampling = true
      const tick = () => {
        if (!window.__sampling) return
        if (button.isConnected) {
          let numeric = null
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!pattern.test(node.textContent) || node.parentElement.closest("[aria-hidden]")) continue
            numeric = getComputedStyle(node.parentElement).fontVariantNumeric
            break
          }
          window.__samples.push({
            width: Math.round(button.getBoundingClientRect().width * 100) / 100,
            busy: button.disabled,
            numeric,
          })
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    },
    [handle, progress.source],
  )
  return async () =>
    page.evaluate(() => {
      window.__sampling = false
      return window.__samples
    })
}

function checkStableWidth(label, samples) {
  const idle = samples.filter((sample) => !sample.busy)
  const busy = samples.filter((sample) => sample.busy)
  const widths = [...new Set(samples.map((sample) => sample.width))]
  check(busy.length > 0, `${label}: busy state observed (${busy.length} of ${samples.length} frames)`)
  check(
    idle.length > 0 && widths.length === 1,
    `${label}: one width idle and busy (${widths.map((width) => `${width}px`).join(", ")})`,
  )
}

/** Reads the frame sampler's log, installed with `addInitScript` before load. */
const FRAME_SAMPLER = () => {
  window.__frames = []
  const seen = () => {
    const text = document.body?.innerText ?? ""
    window.__frames.push({
      t: Math.round(performance.now()),
      intro: !!document.querySelector('[aria-label="About Sequence"][role="dialog"]'),
      empty: text.includes("Bring in your photographs"),
      getStarted: document.activeElement?.textContent === "Get started",
      // The left panel's count line is the first sign of the real project.
      ready: /\d+ photographs? on the canvas\./.test(text),
    })
    if (performance.now() < 3000) requestAnimationFrame(seen)
  }
  requestAnimationFrame(seen)
}

try {
  await scenario("fresh context", async (page) => {
    // 4. No synthesized styles; the name is upright.
    const synthesis = await page.evaluate(() => getComputedStyle(document.body).fontSynthesis)
    check(synthesis === "none", `body font-synthesis is "${synthesis}"`)
    const intro = page.getByRole("dialog", { name: "About Sequence" })
    await intro.waitFor()
    const nameStyle = await intro.getByText("Brandon Lang").evaluate((node) => getComputedStyle(node).fontStyle)
    check(nameStyle === "normal", `the intro's "Brandon Lang" is font-style ${nameStyle}, not a faux italic`)
    check(true, "a fresh context (empty IndexedDB) shows the intro")

    await parkPointer(page)
    await checkHitArea("intro dismiss (X)", intro.getByRole("button", { name: "Dismiss introduction" }))
    await dismissIntroduction(page)

    await checkTabular("zoom readout", page.getByRole("button", { name: /^Zoom \d+%, reset to 100%$/ }))

    // 1. Import → Importing, on the empty state's centred button.
    const importButton = page.getByRole("button", { name: "Import photos", exact: true })
    await importButton.waitFor()
    const restore = await throttle(page, 8)
    const stop = await sampleButton(page, await importButton.elementHandle(), /Importing \d+ of \d+/)
    await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(manyPhotos(24))
    await page.getByText("24 photographs on the canvas.").waitFor({ timeout: 60_000 })
    await restore()
    const samples = await stop()
    checkStableWidth("Import photos → Importing", samples)
    const numerics = samples.filter((sample) => sample.busy && sample.numeric !== null).map((sample) => sample.numeric)
    check(
      numerics.length > 0 && numerics.every((value) => value.includes("tabular-nums")),
      `import progress text is tabular (${[...new Set(numerics)].join(", ") || "never seen"})`,
    )

    // The error banner, from a file that isn't an image.
    await page
      .locator('input[type="file"][accept="image/*"]')
      .first()
      .setInputFiles({ name: "not-a-photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not a jpeg") })
    const banner = page.getByRole("alert").filter({ hasText: "not-a-photo.jpg" })
    await banner.waitFor()
    await parkPointer(page)
    await checkHitArea("error banner dismiss", banner.getByRole("button", { name: "Dismiss" }))
  })

  await scenario("book chrome", async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 10 })
    await settle(page)
    await parkPointer(page)

    // Something to undo, then undone, so Undo and Redo are both live
    // (a disabled button has no hit area at all).
    await page.getByRole("button", { name: "Add page", exact: true }).click()
    await page.getByRole("button", { name: "Add page", exact: true }).click()
    await page.getByRole("button", { name: "Undo", exact: true }).click()
    await parkPointer(page)

    // The canvas toolbars, both one icon-button size.
    const toolbar = {}
    for (const name of ["Import photos", "Add text", "Undo", "Redo", "Zoom out"]) {
      const button = page.getByRole("button", { name, exact: true })
      toolbar[name] = await button.boundingBox()
      if (name !== "Zoom out") await checkHitArea(`toolbar ${name}`, button)
    }
    const sizes = new Set(Object.values(toolbar).map((box) => `${Math.round(box.width)}×${Math.round(box.height)}`))
    check(sizes.size === 1, `both canvas toolbars use one icon-button size (${[...sizes].join(", ")})`)

    await checkHitArea("rename button", page.getByTitle("Rename book"))

    // The inspector's book numbers.
    const inspector = page.locator("aside").last()
    await checkTabular(
      "inspector page count",
      inspector.getByText("Pages", { exact: true }).locator("xpath=following-sibling::span[1]"),
    )
    await checkTabular("inspector saddle-stitch line", inspector.getByText(/^11 pages\./))

    // Margin fields: tabular inputs, and steppers live while hovered.
    const spot = await firstPageCenter(page)
    await page.mouse.click(spot.x, spot.y)
    await page.getByRole("heading", { name: "Margins", exact: true }).waitFor()
    const top = page.getByRole("spinbutton", { name: "Top" })
    await checkTabular("NumberField input", top)
    await top.hover()
    const field = top.locator("..")
    await checkHitArea("NumberField Increase", field.locator('button[aria-label="Increase"]'))
    await checkHitArea("NumberField Decrease", field.locator('button[aria-label="Decrease"]'))
  })

  await scenario("image position steppers", async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await settle(page)
    await placePhotoOnFirstPage(page)
    // The closest stack of NumberFields: X directly above Y.
    const x = page.getByRole("spinbutton", { name: "X" })
    const y = page.getByRole("spinbutton", { name: "Y" })
    await x.hover()
    const xField = x.locator("..")
    const up = await checkHitArea("Position X Increase", xField.locator('button[aria-label="Increase"]'))
    const down = await checkHitArea("Position X Decrease", xField.locator('button[aria-label="Decrease"]'))
    const yTop = (await y.locator("..").boundingBox()).y
    check(
      up.bottom < down.top && down.bottom < yTop,
      `X's steppers don't overlap each other or the Y field (Decrease ends ${Math.round(down.bottom)}px, Y starts ${Math.round(yTop)}px)`,
    )
  })

  await scenario("colour channels", async (page) => {
    const popover = await openColorPicker(page)
    const channels = popover.getByRole("spinbutton")
    const count = await channels.count()
    check(count >= 3, `colour picker shows ${count} channel fields`)
    for (let index = 0; index < count; index++) {
      await checkTabular(`colour channel ${index + 1}`, channels.nth(index))
    }
  })

  await scenario(
    "export",
    async (page) => {
      await dismissIntroduction(page)
      await importPhotos(page)
      await setupBook(page, { preset: "A5 Portrait", pageCount: 10 })
      await settle(page)
      await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
      const dialog = page.getByRole("dialog", { name: "Export book" })
      await dialog.waitFor()
      await page.waitForTimeout(500) // the stagger
      await parkPointer(page)
      await checkHitArea("export info button", dialog.getByRole("button", { name: "Why blank pages are added" }))

      const exportButton = dialog.getByRole("button", { name: "Export", exact: true })
      const restore = await throttle(page, 4)
      const stop = await sampleButton(page, await exportButton.elementHandle(), /Rendering page \d+ of \d+/)
      const download = page.waitForEvent("download", { timeout: 180_000 })
      await exportButton.click()
      await download
      await restore()
      const samples = await stop()
      checkStableWidth("Export → Exporting", samples)
      const numerics = samples.filter((sample) => sample.numeric !== null).map((sample) => sample.numeric)
      check(
        numerics.length > 0 && numerics.every((value) => value.includes("tabular-nums")),
        `export progress text is tabular (${[...new Set(numerics)].join(", ") || "never seen"})`,
      )

      const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Export complete" })
      await toast.waitFor()
      // Hovering the toast holds its auto-dismiss timer.
      await toast.hover({ position: { x: 16, y: 16 } })
      await page.waitForTimeout(700) // the enter slide
      await checkHitArea("toast dismiss", toast.getByRole("button", { name: "Dismiss" }))
    },
    { acceptDownloads: true },
  )

  await scenario("reload flash", async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await settle(page)

    await page.addInitScript(FRAME_SAMPLER)
    await page.reload({ waitUntil: "networkidle" })
    await page.waitForFunction(() => performance.now() > 3000 || window.__frames?.some((frame) => frame.ready))
    await page.waitForTimeout(500)
    const frames = await page.evaluate(() => window.__frames)
    const hydratedAt = frames.findIndex((frame) => frame.ready)
    check(hydratedAt >= 0, `the project hydrated (frame ${hydratedAt} of ${frames.length})`)
    check(frames.length > 0 && frames[0].t < 1000, `sampling started at first paint (t = ${frames[0]?.t}ms)`)
    const intro = frames.filter((frame) => frame.intro)
    const empty = frames.filter((frame) => frame.empty)
    const focus = frames.filter((frame) => frame.getStarted)
    check(intro.length === 0, `no frame shows the intro (${intro.length} of ${frames.length}${intro.length ? `, first at ${intro[0].t}ms` : ""})`)
    check(empty.length === 0, `no frame shows the empty-canvas copy (${empty.length} of ${frames.length}${empty.length ? `, first at ${empty[0].t}ms` : ""})`)
    check(focus.length === 0, `focus never lands on "Get started" (${focus.length} frames)`)
  })

  await scenario("fresh context, sampled", async (page) => {
    // A brand-new bookmaker still gets the intro right after hydration.
    await page.addInitScript(FRAME_SAMPLER)
    await page.reload({ waitUntil: "networkidle" })
    const intro = await page
      .getByRole("dialog", { name: "About Sequence" })
      .waitFor({ timeout: 5_000 })
      .then(() => true, () => false)
    check(intro, "after a reload with empty IndexedDB, the intro shows")
    const focused = await page.evaluate(() => document.activeElement?.textContent)
    check(focused === "Get started", `focus starts on "Get started" (${JSON.stringify(focused)})`)
    check(await page.getByText(EMPTY_COPY).isVisible(), "the empty-canvas copy shows under it")
  })
} finally {
  await app.stop()
}

console.log(failures.length === 0 ? "\nPolish: PASS" : `\nPolish: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
