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
