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

import { DESKTOP_VIEWPORT, dismissIntroduction, importPhotos, openApp, settle, setupBook } from "./lib/app.mjs"
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

/**
 * Center of the book's first page, found from the canvas's own pixels: the
 * first run of page-white in reading order. Screenshot builds have no test
 * hooks, so this reads what is drawn rather than the Fabric objects.
 */
async function firstPageCenter(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas.lower-canvas")
    const { width, height } = canvas
    const data = canvas.getContext("2d").getImageData(0, 0, width, height).data
    const white = (x, y) => {
      const i = (y * width + x) * 4
      return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!white(x, y)) continue
        let right = x
        while (right + 1 < width && white(right + 1, y)) right++
        let bottom = y
        while (bottom + 1 < height && white(x, bottom + 1)) bottom++
        if (right - x < 20 || bottom - y < 20) continue
        // A spread is two pages flush together; take the left half.
        const rect = canvas.getBoundingClientRect()
        const scale = rect.width / width
        return { x: rect.left + (x + (right - x) / 4) * scale, y: rect.top + (y + (bottom - y) / 3) * scale }
      }
    }
    throw new Error("No book page found on the canvas.")
  })
}
