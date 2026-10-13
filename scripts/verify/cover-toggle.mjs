// Cover toggle check: "Set as cover" and "Add new page", until now only in
// the canvas's right-click menus, can be done from the sidebar by keyboard
// (issue #51).
//
//   npm run verify:cover-toggle      # builds first, with test hooks on
//
// Reads the cover badge from `window.__loupeCanvas`, which exists only in a
// build made with LOUPE_TEST_HOOKS=1 (the npm script does that). With
// LOUPE_URL, the server must be such a build.
//
// The contract, on an 8-page book:
//   1. Page 3 can be selected with the keyboard alone: Tab to the left
//      panel's tabs, arrow to Book, Enter, Tab to the "Page 3" row, Enter.
//   2. The page inspector has a checkbox named "Cover"; Tab reaches it and
//      Space checks it.
//   3. That does what the right-click "Set as cover" does (`setFrameCover`):
//      the page moves to the front, so it's page 1 in the stored order
//      (which is the export's order — `padForSaddleStitch` sorts by
//      position and never moves a front cover), the inspector's Position
//      reads "Page 1", and the canvas draws one cover badge, on that page.
//   4. Cmd/Ctrl+Z, pressed with focus on a non-text control, undoes it in
//      one step: unchecked, the original order back exactly, no badge.
//   5. With nothing selected, the book settings' "Add page" button is
//      reached by Tab and Enter adds a page at the end (8 → 9); Ctrl+Z
//      removes it again.
//   6. No uncaught page errors.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const PAGES = 8

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)
const inspector = page.getByRole("complementary").last()
const pagesList = page.getByRole("complementary").first()

/** Page ids in reading order, and which ones are covers, from IndexedDB. */
const storedBook = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("loupe")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            const frames = [...(get.result[0]?.frames ?? [])].sort((a, b) => a.position - b.position)
            resolve({ ids: frames.map((f) => f.id), covers: frames.filter((f) => f.isCover).map((f) => f.id) })
          }
        }
      }),
  )

/** Polls the stored book until `predicate` holds (saves are debounced). */
async function storedBookWhere(predicate, timeout = 3_000) {
  const deadline = Date.now() + timeout
  let book = await storedBook()
  while (!predicate(book) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    book = await storedBook()
  }
  return book
}

/** Presses Tab until `locator` has focus; false if it never does. */
async function tabTo(locator, max = 80) {
  if ((await locator.count()) === 0) return false
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return true
  }
  return false
}

/** Cover badges on the canvas: the bookmark paths, with the frame each sits on. */
const badges = () =>
  page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const objects = canvas.getObjects()
    const frames = objects.filter((o) => o.frameId && !o.elementId && o.type === "rect")
    return objects
      .filter((o) => o.type === "path" && o.fill === "#e4e4e7" && o.screenAnchor)
      .map((badge) => {
        // The badge is anchored to its frame's top-left corner (above the bleed).
        const frame = frames.find((f) => {
          const center = f.getCenterPoint()
          const left = center.x - (f.width * f.scaleX) / 2
          const top = center.y - (f.height * f.scaleY) / 2
          return Math.abs(left - badge.screenAnchor.x) < 2 && badge.screenAnchor.y <= top + 1
        })
        return frame?.frameId ?? null
      })
  })

const coverBox = inspector.getByRole("checkbox", { name: "Cover", exact: true })
const positionText = () => inspector.getByRole("combobox", { name: "Position" }).textContent()

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await settle(page)
  // Saves are debounced: wait for the set-up book to be stored before taking it as the baseline.
  const original = await storedBookWhere((book) => book.ids.length === PAGES)

  // 1. Page 3 by keyboard: focus starts on the page itself, not a control.
  await page.evaluate(() => document.activeElement?.blur())
  const canvasTab = page.getByRole("tab", { name: "Canvas" })
  const reachedTabs = await tabTo(canvasTab)
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Enter")
  const page3Row = pagesList.getByRole("button", { name: "Page 3", exact: true })
  await page3Row.waitFor()
  const reachedRow = await tabTo(page3Row)
  await page.keyboard.press("Enter")
  await page.waitForTimeout(400)
  const page3Id = original.ids[2]
  check(
    reachedTabs && reachedRow && (await page3Row.getAttribute("aria-current")) === "true",
    `1. page 3 selected by keyboard (Tab to tabs: ${reachedTabs}, Tab to row: ${reachedRow})`,
  )

  // 2. The Cover checkbox, reached by Tab and checked by Space.
  check((await coverBox.count()) === 1, `2. the page inspector has a checkbox named "Cover"`)
  const reachedCover = await tabTo(coverBox)
  check(reachedCover, "2. Tab reaches the Cover checkbox")
  check((await positionText())?.includes("Page 3"), `2. before: Position reads "${await positionText()}"`)
  await page.keyboard.press("Space")
  await page.waitForTimeout(300)
  check(await coverBox.isChecked(), "2. Space checks it")

  // 3. Same as the menu's "Set as cover": moved to the front, badge drawn.
  const covered = await storedBookWhere((book) => book.ids[0] === page3Id)
  check(
    covered.ids[0] === page3Id && JSON.stringify(covered.covers) === JSON.stringify([page3Id]),
    `3. stored order: page 3 is now page 1 and the only cover (${covered.ids.indexOf(page3Id) + 1}, covers ${covered.covers.length})`,
  )
  check(
    JSON.stringify(covered.ids.slice(1)) === JSON.stringify(original.ids.filter((id) => id !== page3Id)),
    "3. the rest of the book keeps its order behind it",
  )
  check((await positionText())?.includes("Page 1"), `3. Position now reads "${await positionText()}"`)
  check(
    (await pagesList.getByRole("button", { name: "Page 1", exact: true }).getAttribute("aria-current")) === "true",
    "3. the Book list shows the selected page as Page 1",
  )
  await canvasTab.click()
  await settle(page)
  const drawn = await badges()
  check(
    drawn.length === 1 && drawn[0] === page3Id,
    `3. the canvas draws one cover badge, on that page (${JSON.stringify(drawn.map((id) => (id === page3Id ? "page 3" : id)))})`,
  )

  // 4. Undo from a non-text control: Shift+Tab off the checkbox (an
  //    <input>, which the undo shortcut leaves to the browser) onto Position.
  await coverBox.focus()
  await page.keyboard.press("Shift+Tab")
  const onPosition = await inspector
    .getByRole("combobox", { name: "Position" })
    .evaluate((el) => el === document.activeElement)
  await page.keyboard.press("Control+z")
  await page.waitForTimeout(300)
  const undone = await storedBookWhere((book) => book.ids[0] !== page3Id)
  check(onPosition, "4. Shift+Tab from Cover lands on Position (a button, not a text field)")
  check(!(await coverBox.isChecked()), "4. Ctrl+Z unchecks Cover")
  check(
    JSON.stringify(undone.ids) === JSON.stringify(original.ids) && undone.covers.length === 0,
    "4. Ctrl+Z restores the original order exactly, with no cover",
  )
  check((await positionText())?.includes("Page 3"), `4. Position reads "${await positionText()}" again`)
  await settle(page)
  check((await badges()).length === 0, "4. the cover badge is gone")

  // 5. Add page from the book settings. Nothing is selected after a reload.
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Loupe").waitFor()
  await settle(page)
  const addPage = inspector.getByRole("button", { name: "Add page", exact: true })
  const reachedAdd = await tabTo(addPage)
  check(reachedAdd, `5. Tab reaches the book settings' "Add page" button`)
  await page.keyboard.press("Enter")
  const added = await storedBookWhere((book) => book.ids.length === PAGES + 1)
  check(added.ids.length === PAGES + 1, `5. Enter adds a page (${PAGES} → ${added.ids.length})`)
  check(
    JSON.stringify(added.ids.slice(0, PAGES)) === JSON.stringify(original.ids),
    "5. the new page goes at the end of the book",
  )
  const pagesRow = inspector.getByText("Pages", { exact: true }).locator("xpath=following-sibling::*[1]")
  check((await pagesRow.textContent()) === String(PAGES + 1), `5. the Pages row reads ${await pagesRow.textContent()}`)
  await page.keyboard.press("Control+z")
  const removed = await storedBookWhere((book) => book.ids.length === PAGES)
  check(removed.ids.length === PAGES, `5. Ctrl+Z removes it again (${removed.ids.length})`)

  check(errors.length === 0, `6. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "cover-toggle-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nCover toggle: PASS" : `\nCover toggle: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
