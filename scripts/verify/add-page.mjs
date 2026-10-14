// Add-page check: the canvas "+" buttons sit outside a spread, never in its
// gutter, and inserting between a spread's two pages is the sidebar's
// explicit "Add page before/after" instead (issue #72).
//
//   npm run verify:add-page          # builds first, with test hooks on
//
// Positions and page order are read from `window.__loupeCanvas`, which exists
// only in a build made with LOUPE_TEST_HOOKS=1 (the npm script does that).
// With LOUPE_URL, the server must be such a build. Page identity is each
// frame's id, so the checks can tell which page is the new one.
//
// The contract, on an 8-page A5 book with page 1 set as the cover (rows:
// 1 | 2–3 | 4–5 | 6–7 | 8):
//   1. Selecting page 2 or page 3 shows the same pair of buttons, both
//      outside the spread's bounding box, neither over the gutter, and both
//      vertically centred on the spread.
//   2. Page 1 (a solo row) gets its buttons on its own edges.
//   3. The right button on spread 2–3 adds a new page 4; the old page 4
//      becomes page 5. One Cmd/Ctrl+Z restores the previous order exactly.
//   4. The left button on spread 2–3 adds a new page 2. One undo restores.
//   5. The sidebar's "Add page after" on page 2 adds a new page 3, between
//      the spread's pages. One undo restores.
//   6. No uncaught page errors.

import path from "node:path"

import { dismissIntroduction, firstPageCenter, importPhotos, openApp, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const PAGES = 8

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

/** Frame ids in reading order, plus each frame's scene bounds. */
const frames = () =>
  page.evaluate(() =>
    window.__loupeCanvas
      .getObjects()
      .filter((o) => o.frameId && !o.elementId && o.type === "rect")
      .map((o) => ({
        id: o.frameId,
        minX: o.left - o.width / 2,
        maxX: o.left + o.width / 2,
        minY: o.top - o.height / 2,
        maxY: o.top + o.height / 2,
      }))
      .sort((a, b) => Math.round(a.minY) - Math.round(b.minY) || a.minX - b.minX),
  )
const order = async () => (await frames()).map((f) => f.id)

/** The add-page buttons: target frame, side, scene extent and screen center. */
const buttons = () =>
  page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return canvas
      .getObjects()
      .filter((o) => o.isAddPageButton)
      .map((o) => {
        const halfW = (o.width * o.scaleX) / 2
        const halfH = (o.height * o.scaleY) / 2
        return {
          frameId: o.frameId,
          side: o.side,
          minX: o.left - halfW,
          maxX: o.left + halfW,
          minY: o.top - halfH,
          maxY: o.top + halfH,
          centerY: o.top,
          screen: { x: rect.left + v[0] * o.left + v[4], y: rect.top + v[3] * o.top + v[5] },
        }
      })
      .sort((a, b) => a.minX - b.minX)
  })

/** Clicks the middle of a frame on screen, selecting it. */
const selectFrame = async (id) => {
  const point = await page.evaluate((id) => {
    const canvas = window.__loupeCanvas
    const frame = canvas.getObjects().find((o) => o.frameId === id && !o.elementId && o.type === "rect")
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.left + v[0] * frame.left + v[4], y: rect.top + v[3] * frame.top + v[5] }
  }, id)
  await page.mouse.click(point.x, point.y)
  await page.waitForTimeout(300)
  const active = await page.evaluate(() => window.__loupeCanvas.getActiveObject()?.frameId ?? null)
  if (active !== id) throw new Error(`Clicking frame ${id} selected ${active} instead.`)
}

const fitToView = async () => {
  await page.getByRole("button", { name: "Fit to view" }).click()
  await page.waitForTimeout(500)
}

const undo = async () => {
  await page.keyboard.press("ControlOrMeta+z")
  await page.waitForTimeout(600)
}

const pageOf = (ids, id) => ids.indexOf(id) + 1
const near = (a, b) => Math.abs(a - b) < 1

/** Checks the inserted page's number and that everything else kept its order. */
const checkInsert = (label, before, after, expectedPage) => {
  const added = after.filter((id) => !before.includes(id))
  const rest = after.filter((id) => before.includes(id))
  check(
    added.length === 1 && pageOf(after, added[0]) === expectedPage && rest.join() === before.join(),
    `${label}: one new page, at page ${added.length === 1 ? pageOf(after, added[0]) : "?"} (want ${expectedPage}); ` +
      `the old page ${expectedPage} is now page ${pageOf(after, before[expectedPage - 1])}`,
  )
}

try {
  await dismissIntroduction(page)
  if (!(await page.evaluate(() => Boolean(window.__loupeCanvas)))) {
    throw new Error(
      "window.__loupeCanvas is missing: this build has no test hooks. Run `npm run verify:add-page`, " +
        "or build with LOUPE_TEST_HOOKS=1 before pointing LOUPE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await settle(page)

  // Page 1 becomes the cover, so pages 2–3 form the first spread.
  const spot = await firstPageCenter(page)
  await page.mouse.click(spot.x, spot.y, { button: "right" })
  await page.getByRole("button", { name: "Set as cover" }).click()
  await fitToView()

  const initial = await frames()
  if (initial.length !== PAGES) throw new Error(`Expected ${PAGES} pages, found ${initial.length}.`)
  const [cover, p2, p3] = initial

  // 1. Either page of spread 2–3 gives the same pair, outside the spread.
  const spread = { minX: p2.minX, maxX: p3.maxX, centerY: (p2.minY + p2.maxY) / 2 }
  const gutterX = p2.maxX
  const pairs = []
  for (const frame of [p2, p3]) {
    await selectFrame(frame.id)
    const pair = await buttons()
    pairs.push(pair)
    const [left, right] = pair
    const label = `1. page ${pageOf(initial.map((f) => f.id), frame.id)} selected`
    check(pair.length === 2, `${label}: two add-page buttons (found ${pair.length})`)
    if (pair.length !== 2) continue
    check(
      left.maxX <= spread.minX && right.minX >= spread.maxX,
      `${label}: buttons outside the spread (left ends at ${left.maxX.toFixed(0)} <= ${spread.minX.toFixed(0)}, ` +
        `right starts at ${right.minX.toFixed(0)} >= ${spread.maxX.toFixed(0)})`,
    )
    // At low zoom a gutter button's screen-sized gap carries it over the
    // facing page, so "in the gutter" means anywhere across the spread.
    const inside = pair.filter((b) => b.maxX > spread.minX && b.minX < spread.maxX)
    check(
      inside.length === 0,
      `${label}: no button in the gutter (x=${gutterX.toFixed(0)}) or anywhere across the spread` +
        (inside.length ? `; found ${inside.map((b) => `${b.side} at ${b.minX.toFixed(0)}–${b.maxX.toFixed(0)}`).join(", ")}` : ""),
    )
    check(
      near(left.centerY, spread.centerY) && near(right.centerY, spread.centerY),
      `${label}: both vertically centred on the spread (${left.centerY.toFixed(0)}, ${right.centerY.toFixed(0)} vs ${spread.centerY.toFixed(0)})`,
    )
    check(
      left.frameId === p2.id && left.side === "before" && right.frameId === p3.id && right.side === "after",
      `${label}: left adds before page 2, right adds after page 3 (${left.side} ${left.frameId}, ${right.side} ${right.frameId})`,
    )
  }
  const strip = (pair) => JSON.stringify(pair.map(({ screen, ...rest }) => rest))
  check(pairs.length === 2 && strip(pairs[0]) === strip(pairs[1]), "1. pages 2 and 3 show the same pair of buttons")

  // 2. The cover row keeps buttons on its own edges.
  await selectFrame(cover.id)
  const coverPair = await buttons()
  const [coverLeft, coverRight] = coverPair
  check(
    coverPair.length === 2 &&
      coverLeft.maxX <= cover.minX &&
      coverRight.minX >= cover.maxX &&
      coverRight.minX < p3.maxX &&
      coverLeft.frameId === cover.id &&
      coverRight.frameId === cover.id,
    `2. page 1 (solo) has its buttons on its own edges ` +
      `(${coverLeft?.maxX.toFixed(0)} <= ${cover.minX.toFixed(0)}, ${coverRight?.minX.toFixed(0)} >= ${cover.maxX.toFixed(0)})`,
  )

  // 3. Right button on spread 2–3: new page 4.
  const base = await order()
  await selectFrame(p2.id)
  const [, right] = await buttons()
  await page.mouse.click(right.screen.x, right.screen.y)
  await page.waitForTimeout(600)
  checkInsert("3. right button on spread 2–3", base, await order(), 4)
  await undo()
  check((await order()).join() === base.join(), "3. one undo restores the previous order exactly")

  // 4. Left button on spread 2–3: new page 2.
  await fitToView()
  await selectFrame(p3.id)
  const [left] = await buttons()
  await page.mouse.click(left.screen.x, left.screen.y)
  await page.waitForTimeout(600)
  checkInsert("4. left button on spread 2–3", base, await order(), 2)
  await undo()
  check((await order()).join() === base.join(), "4. one undo restores the previous order exactly")

  // 5. Sidebar "Add page after" on page 2: new page 3, inside the spread.
  await fitToView()
  await selectFrame(p2.id)
  const inspector = page.getByRole("complementary").last()
  await inspector.getByRole("button", { name: "Add page after", exact: true }).click()
  await page.waitForTimeout(600)
  checkInsert('5. sidebar "Add page after" on page 2', base, await order(), 3)
  await undo()
  check((await order()).join() === base.join(), "5. one undo restores the previous order exactly")

  check(errors.length === 0, `6. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "add-page-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nAdd page: PASS" : `\nAdd page: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
