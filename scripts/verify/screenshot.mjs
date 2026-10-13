// Saves desktop screenshots of the app to screenshots/ at the repo root.
//
//   npm run screenshot              # every scene
//   npm run screenshot -- shell     # just the named scene(s)
//
// `npm run screenshot` builds first. To capture a server that is already
// running (e.g. `npm run dev`), skip the build and point at it:
//   LOUPE_URL=http://localhost:3000 node scripts/verify/screenshot.mjs
//
// Each scene starts from a fresh browser context, so an empty IndexedDB.

import { mkdir } from "node:fs/promises"
import path from "node:path"

import {
  DESKTOP_VIEWPORT,
  dismissIntroduction,
  firstPageCenter,
  importPhotos,
  openApp,
  openColorPicker,
  placePhotoOnFirstPage,
  settle,
  setupBook,
} from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const SCENES = {
  /** First run: the introduction overlay over the empty shell. */
  intro: async () => {},
  /** The empty app shell — top nav, both panels, empty canvas. */
  shell: async (page) => {
    await dismissIntroduction(page)
  },
  /** Fixture photos imported and a 12-page A5 book set up. */
  book: async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 12 })
  },
  /** Book setup with Custom chosen and an invalid size: the custom row, its
   *  error line and the field styling (#57). */
  "book-setup": async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    const dialog = page.getByRole("dialog", { name: "Set up your book" })
    await dialog.getByRole("button", { name: "Custom", exact: true }).click()
    await dialog.getByLabel("Width in millimetres").fill("0")
  },
  /** The text Color picker in the Paper reference's state (CMYK, #37bf7b),
   *  also saved alone (color-picker-popover.png) for comparing with
   *  docs/design/paper/colorpicker.png. */
  "color-picker": async (page) => {
    const popover = await openColorPicker(page)
    await popover.getByRole("textbox", { name: "Hex color" }).fill("#37bf7b")
    await popover.getByRole("tab", { name: "CMYK" }).click()
    await page.mouse.move(0, 0)
    await page.waitForTimeout(400)
    const box = await popover.boundingBox()
    await page.screenshot({
      path: path.join(repoRoot, "screenshots", "color-picker-popover.png"),
      clip: { x: box.x - 4, y: box.y - 4, width: box.width + 8, height: box.height + 8 },
      scale: "device",
    })
  },
  /** The text Color picker with the G channel field keyboard-focused (#15). */
  "color-picker-focus": async (page) => {
    const popover = await openColorPicker(page)
    await popover.getByRole("textbox", { name: "Hex color" }).focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Tab")
  },
  /** A placed text box after a single click: selected with handles, not
   *  editing, and the inspector showing its properties (issue #14). */
  "text-selected": async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await settle(page)
    const page1 = await firstPageCenter(page)
    await page.mouse.move(page1.x, page1.y)
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -560)
    await settle(page)
    const spot = await firstPageCenter(page)
    await page.keyboard.press("T")
    await page.mouse.click(spot.x, spot.y)
    await page.waitForTimeout(300)
    await page.keyboard.type("Morning light")
    await page.keyboard.press("Escape")
    await page.keyboard.press("Escape")
    // The box is centered where it was placed, so this lands on it.
    await page.mouse.click(spot.x, spot.y)
    await page.getByRole("tablist", { name: "Text alignment" }).waitFor()
  },
  /** A page selected: the inspector's page (margins) state. */
  "page-selected": async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await settle(page)
    const spot = await firstPageCenter(page)
    await page.mouse.click(spot.x, spot.y)
    await page.getByRole("heading", { name: "Margins", exact: true }).waitFor()
  },
  /** A photo dragged onto page 1 and selected: the inspector's image state. */
  "image-selected": async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
    await settle(page)
    await placePhotoOnFirstPage(page)
  },
  /** The Export dialog for a 10-page book: the "Adds 2 blank pages to reach
   *  12" line, with its explanation open from keyboard focus (#31). */
  "export-dialog": async (page) => {
    await dismissIntroduction(page)
    await importPhotos(page)
    await setupBook(page, { preset: "A5 Portrait", pageCount: 10 })
    await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
    const dialog = page.getByRole("dialog", { name: "Export book" })
    await dialog.waitFor()
    const info = dialog.getByRole("button", { name: "Why blank pages are added" })
    if (await info.count()) {
      // Shift+Tab from the first format radio is one keyboard step onto the
      // info control (see e2e-export.mjs for why cycling Tab was flaky).
      await dialog.getByRole("radio").first().focus()
      await page.keyboard.press("Shift+Tab")
      await page.getByText(/sheets folded in half/).waitFor()
    }
    await page.waitForTimeout(400)
  },
  /** The feedback popover, open and empty. */
  feedback: async (page) => {
    await dismissIntroduction(page)
    await page.getByRole("button", { name: "Provide feedback" }).click()
    await page.getByPlaceholder("What's wrong, missing, or confusing?").waitFor()
    await page.waitForTimeout(600) // the fields cascade in
  },
  /** A feedback submission the server can't file: the error toast over the
   *  popover with the draft kept. The route is stubbed in the browser so this
   *  can never file a real issue, even where a token is configured. */
  "feedback-error": async (page) => {
    await page.route("**/api/feedback", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: "Feedback isn't set up on this server yet, so it couldn't be sent. Your note is still here.",
        }),
      }),
    )
    await dismissIntroduction(page)
    await page.getByRole("button", { name: "Provide feedback" }).click()
    await page.getByPlaceholder("What's wrong, missing, or confusing?").fill("The export dialog should remember my last choice.")
    await page.getByRole("button", { name: "Submit feedback" }).click()
    await page.getByText("Couldn't send feedback").waitFor()
  },
}

const requested = process.argv.slice(2)
const unknown = requested.filter((name) => !(name in SCENES))
if (unknown.length > 0) {
  console.error(`Unknown scene(s): ${unknown.join(", ")}. Available: ${Object.keys(SCENES).join(", ")}`)
  process.exit(2)
}
const scenes = requested.length > 0 ? requested : Object.keys(SCENES)

const outDir = path.join(repoRoot, "screenshots")
await mkdir(outDir, { recursive: true })

const app = await startApp()
let failed = false
try {
  for (const name of scenes) {
    const { browser, page, errors } = await openApp(app.url)
    try {
      await SCENES[name](page)
      await settle(page)
      const file = path.join(outDir, `${name}-${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}.png`)
      await page.screenshot({ path: file })
      console.log(`✓ ${name} → ${path.relative(repoRoot, file)}`)
      if (errors.length > 0) {
        failed = true
        console.error(`  page errors during "${name}":\n    ${errors.join("\n    ")}`)
      }
    } catch (error) {
      failed = true
      console.error(`✗ ${name}: ${error.message}`)
    } finally {
      await browser.close()
    }
  }
} finally {
  await app.stop()
}
process.exit(failed ? 1 : 0)

