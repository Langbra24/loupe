// Right-sidebar separator check: every horizontal divider in the inspector
// runs the panel's full inner width, edge to edge (issue #25).
//
//   npm run verify:separators        # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/sidebar-separators.mjs
//
// The contract, in each inspector state (book settings, page, image, text):
// every horizontal separator's left edge is the panel's left edge after its
// border and its right edge is the panel's right edge, within 1px; and the
// panel never scrolls sideways.

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

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** Every horizontal separator in the inspector, against the panel's inner edges. */
const measure = (page) =>
  page.evaluate(() => {
    const panel = [...document.querySelectorAll("aside")].at(-1)
    const rect = panel.getBoundingClientRect()
    const inner = { left: rect.left + parseFloat(getComputedStyle(panel).borderLeftWidth), right: rect.right }
    const separators = [...panel.querySelectorAll('[data-slot="separator"][data-orientation="horizontal"]')].map(
      (separator) => {
        const box = separator.getBoundingClientRect()
        return { left: box.left, right: box.right }
      },
    )
    const scroller = panel.querySelector("[data-slot=scroll-area-viewport]") ?? panel
    return { inner, separators, sideScroll: scroller.scrollWidth > scroller.clientWidth }
  })

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

const verifyState = async (name, ready) => {
  await page.getByRole("heading", { name: ready, exact: true }).waitFor()
  await page.waitForTimeout(300) // the inspector cross-fades between states
  const { inner, separators, sideScroll } = await measure(page)
  const off = separators.filter((s) => Math.abs(s.left - inner.left) > 1 || Math.abs(s.right - inner.right) > 1)
  check(
    separators.length > 0 && off.length === 0,
    `${name}: ${separators.length} separator(s) span ${inner.left}–${inner.right}` +
      (off.length ? `; ${off.length} don't, first ${off[0].left}–${off[0].right}` : ""),
  )
  check(!sideScroll, `${name}: no horizontal scroll`)
}

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)
  await verifyState("nothing selected (book settings)", "Book")

  const spot = await firstPageCenter(page)
  await page.mouse.click(spot.x, spot.y)
  await verifyState("page selected", "Margins")

  await placePhotoOnFirstPage(page)
  await verifyState("image selected", "Image")

  await placeTextOnFirstPage(page)
  await verifyState("text selected", "Text")

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "sidebar-separators-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nSidebar separators: PASS" : `\nSidebar separators: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
