// Space keys check: Space activates a focused button, tab, Select trigger or
// checkbox reached by keyboard, and hold-Space-to-pan works from the canvas
// (issue #75) and from a control that holds focus from a mouse click
// (issue #85).
//
//   npm run verify:space-keys      # builds first, with test hooks on
//
// Reads the viewport transform and frame positions from
// `window.__sequenceCanvas`, which exists only in a build made with
// SEQUENCE_TEST_HOOKS=1 (the npm script does that). With SEQUENCE_URL, the server
// must be such a build.
//
// The contract, on an 8-page book. Every control is reached with Tab (so
// it's `:focus-visible`) and pressed with Space:
//   1. Export, in the top nav: the Export dialog opens. Escape closes it.
//   2. The left panel's tabs: Tab lands on Canvas, ArrowRight moves to Book,
//      Space selects Book. Space on the "Page 3" row selects that page.
//   3. The page inspector's "Add page after": the book gains a page.
//   4. The Position Select trigger: its listbox opens. Escape closes it.
//   5. The Cover checkbox: it becomes checked.
//   6. With focus on a button, a click on empty canvas moves focus off it to
//      the page (`document.body`); then holding Space and dragging from a
//      page pans the canvas (the viewport transform moves by the drag) and
//      leaves the page where it is.
//   7. Mouse-focused controls pan instead (#85). Each is clicked with the
//      mouse, so it holds focus without `:focus-visible`, then given a plain
//      Space press; clicked again, then given Space + drag, which pans the
//      canvas by the drag. Neither activates the control or leaves a focus
//      ring on it. Each click does activate it, which the checks allow for:
//      a. "Add page after", with a page selected on the canvas: each click
//         adds a page; Space adds none.
//      b. Export: the click opens the dialog, closed again with its Cancel
//         button (a mouse click, so focus returns to Export without
//         focus-visible); Space opens no dialog.
//      c. The Canvas tab, clicked while Canvas is showing: Book would swap the
//         canvas out, and the Book view has no pan to test. The tab stays
//         selected and the canvas stays mounted.
//      d. The Cover checkbox, with a page selected: the click toggles it;
//         Space doesn't toggle it back.
//   8. Text fields still type a space after a mouse click into them: the
//      inspector's Text textarea and the feedback textarea.
//   9. No uncaught page errors.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, placeTextOnFirstPage, settle, setupBook } from "./lib/app.mjs"
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

/** Presses Tab until `locator` has focus; false if it never does. */
async function tabTo(locator, max = 80) {
  if ((await locator.count()) === 0) return false
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    if (await locator.evaluate((el) => el === document.activeElement).catch(() => false)) return true
  }
  return false
}

const focusVisible = (locator) => locator.evaluate((el) => el.matches(":focus-visible")).catch(() => false)

/** Describes `document.activeElement` for the log. */
const activeElement = () =>
  page.evaluate(() => {
    const el = document.activeElement
    if (!el || el === document.body) return "body"
    return `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}"`
  })

/** Pages in the stored book. The Book tab replaces the canvas, so this
 *  reads IndexedDB rather than Fabric's objects. */
const storedPageCount = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("sequence")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => resolve(get.result[0]?.frames?.length ?? 0)
        }
      }),
  )

/** Polls the stored page count until it is `expected` (saves are debounced). */
async function pageCountReaching(expected, timeout = 3_000) {
  const deadline = Date.now() + timeout
  let count = await storedPageCount()
  while (count !== expected && Date.now() < deadline) {
    await page.waitForTimeout(100)
    count = await storedPageCount()
  }
  return count
}

const viewport = () => page.evaluate(() => [...window.__sequenceCanvas.viewportTransform])

/** The first frame's scene position, and its center on screen. */
const firstFrame = () =>
  page.evaluate(() => {
    const canvas = window.__sequenceCanvas
    const frame = canvas
      .getObjects()
      .filter((o) => o.frameId && !o.elementId && o.type === "rect")
      .sort((a, b) => Math.round(a.top) - Math.round(b.top) || a.left - b.left)[0]
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return {
      left: frame.left,
      top: frame.top,
      screen: { x: rect.left + v[0] * frame.left + v[4], y: rect.top + v[3] * frame.top + v[5] },
    }
  })

/** A screen point over the canvas with no object under it and no DOM
 *  control on top of it. */
const emptyCanvasPoint = () =>
  page.evaluate(() => {
    const canvas = window.__sequenceCanvas
    const upper = canvas.upperCanvasEl
    const rect = upper.getBoundingClientRect()
    for (let y = rect.bottom - 60; y > rect.top + 60; y -= 20) {
      for (let x = rect.left + 60; x < rect.right - 60; x += 20) {
        if (document.elementFromPoint(x, y) !== upper) continue
        const pointer = canvas.getScenePoint({ clientX: x, clientY: y })
        const hit = canvas.getObjects().some((o) => o.visible && o.containsPoint(pointer))
        if (!hit) return { x, y }
      }
    }
    throw new Error("No empty canvas point found.")
  })

const exportButton = page.getByRole("banner").getByRole("button", { name: "Export", exact: true })
const exportDialog = page.getByRole("dialog", { name: "Export book" })
const canvasTab = page.getByRole("tab", { name: "Canvas" })
const bookTab = page.getByRole("tab", { name: "Book" })
const page3Row = pagesList.getByRole("button", { name: "Page 3", exact: true })
const addAfter = inspector.getByRole("button", { name: "Add page after", exact: true })
const positionTrigger = inspector.getByRole("combobox", { name: "Position" })
const coverBox = inspector.getByRole("checkbox", { name: "Cover", exact: true })

const frameCount = () =>
  page.evaluate(
    () => window.__sequenceCanvas.getObjects().filter((o) => o.frameId && !o.elementId && o.type === "rect").length,
  )

/** Holds Space and drags from the first page; returns how far the viewport
 *  moved and whether that page stayed where it was. The drags alternate
 *  direction (step 6 went down-right) so the book stays on screen. */
let dragSign = -1
async function spaceDrag() {
  const delta = { x: 120 * dragSign, y: 80 * dragSign }
  dragSign = -dragSign
  const frame = await firstFrame()
  const v0 = await viewport()
  await page.keyboard.down("Space")
  await page.mouse.move(frame.screen.x, frame.screen.y)
  await page.mouse.down()
  await page.mouse.move(frame.screen.x + delta.x / 2, frame.screen.y + delta.y / 2, { steps: 6 })
  await page.mouse.move(frame.screen.x + delta.x, frame.screen.y + delta.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up("Space")
  await page.waitForTimeout(300)
  const v1 = await viewport()
  const moved = { x: v1[4] - v0[4], y: v1[5] - v0[5] }
  const frameAfter = await firstFrame()
  return {
    moved,
    panned: Math.abs(moved.x - delta.x) < 2 && Math.abs(moved.y - delta.y) < 2,
    pageStill: Math.abs(frameAfter.left - frame.left) < 0.5 && Math.abs(frameAfter.top - frame.top) < 0.5,
  }
}

const hasFocus = (locator) => locator.evaluate((el) => el === document.activeElement).catch(() => false)

/**
 * Runs both Space gestures on a mouse-focused control, each from a fresh
 * click: a plain press (down and up, no drag), then Space + drag. Before
 * each, `locator` must hold focus without `:focus-visible`; after, the
 * control mustn't have activated or be left showing a focus ring, and the
 * drag must have panned with the page left alone.
 *
 * `focusByMouse()` clicks so that `locator` has focus, and resolves to an
 * `unchanged()` that resolves to `[ok, detail]`: whether the effect the
 * control would have is still absent.
 */
async function checkMousePan(label, locator, focusByMouse) {
  for (const gesture of ["press", "drag"]) {
    const unchanged = await focusByMouse()
    const focused = await hasFocus(locator)
    const visible = await focusVisible(locator)
    check(
      focused && !visible,
      `${label}: a click leaves it focused without focus-visible (focused: ${focused}, focus-visible: ${visible})`,
    )
    if (gesture === "press") {
      await page.keyboard.press("Space")
      await page.waitForTimeout(300)
    } else {
      const { moved, panned, pageStill } = await spaceDrag()
      check(panned, `${label}: Space + drag pans the canvas by the drag (${Math.round(moved.x)}, ${Math.round(moved.y)})`)
      check(pageStill, `${label}: the page under the drag stays where it is`)
    }
    const [ok, detail] = await unchanged()
    const what = gesture === "press" ? "a Space press" : "Space + drag"
    check(ok, `${label}: ${what} doesn't activate it (${detail})`)
    const ring = (await hasFocus(locator)) && (await focusVisible(locator))
    check(!ring, `${label}: ${what} leaves no focus ring on it`)
  }
}

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })
  await settle(page)
  await page.evaluate(() => document.activeElement?.blur())

  // 1. A top-nav button.
  const reachedExport = await tabTo(exportButton)
  check(reachedExport && (await focusVisible(exportButton)), "1. Tab reaches Export, focus-visible")
  await page.keyboard.press("Space")
  const opened = await exportDialog.waitFor({ timeout: 1_500 }).then(
    () => true,
    () => false,
  )
  check(opened, "1. Space on Export opens the Export dialog")
  if (opened) {
    await page.keyboard.press("Escape")
    await exportDialog.waitFor({ state: "detached" })
  }

  // 2. The left panel's tabs, then a row in the Book list.
  await page.evaluate(() => document.activeElement?.blur())
  const reachedTabs = await tabTo(canvasTab)
  await page.keyboard.press("ArrowRight")
  const onBook = await bookTab.evaluate((el) => el === document.activeElement)
  check(reachedTabs && onBook && (await focusVisible(bookTab)), "2. Tab, then ArrowRight, focuses the Book tab")
  await page.keyboard.press("Space")
  await page.waitForTimeout(300)
  check((await bookTab.getAttribute("aria-selected")) === "true", "2. Space selects the Book tab")
  const reachedRow = await tabTo(page3Row)
  await page.keyboard.press("Space")
  await page.waitForTimeout(300)
  check(
    reachedRow && (await page3Row.getAttribute("aria-current")) === "true",
    `2. Space on the "Page 3" row selects page 3 (reached: ${reachedRow})`,
  )
  // Back to Canvas: the Book tab replaces the canvas, and with it the
  // canvas's window-level Space listener, so the rest runs with it mounted.
  const reachedBookTab = await tabTo(bookTab)
  await page.keyboard.press("ArrowLeft")
  await page.keyboard.press("Space")
  await page.waitForTimeout(300)
  check(
    reachedBookTab && (await canvasTab.getAttribute("aria-selected")) === "true",
    "2. ArrowLeft, then Space, selects the Canvas tab again",
  )
  await settle(page)
  check(
    (await positionTrigger.textContent())?.includes("Page 3"),
    `2. page 3 is still selected (Position reads "${await positionTrigger.textContent()}")`,
  )

  // 3. An inspector button.
  const before = await pageCountReaching(PAGES)
  const reachedAdd = await tabTo(addAfter)
  check(reachedAdd && (await focusVisible(addAfter)), `3. Tab reaches "Add page after", focus-visible`)
  await page.keyboard.press("Space")
  const after = await pageCountReaching(PAGES + 1)
  check(after === before + 1, `3. Space on "Add page after" adds a page (${before} → ${after})`)

  // 4. A Select trigger.
  await page.evaluate(() => document.activeElement?.blur())
  const reachedPosition = await tabTo(positionTrigger)
  check(reachedPosition, "4. Tab reaches the Position Select trigger")
  await page.keyboard.press("Space")
  const listbox = page.getByRole("listbox")
  const listOpen = await listbox.waitFor({ timeout: 1_500 }).then(
    () => true,
    () => false,
  )
  check(listOpen, "4. Space on the Position trigger opens its listbox")
  if (listOpen) {
    await page.keyboard.press("Escape")
    await listbox.waitFor({ state: "hidden" })
  }

  // 5. The Cover checkbox.
  const reachedCover = await tabTo(coverBox)
  check(reachedCover, "5. Tab reaches the Cover checkbox")
  await page.keyboard.press("Space")
  await page.waitForTimeout(300)
  check(await coverBox.isChecked(), "5. Space checks it")

  // 6. Hold-Space pan, from a click on empty canvas with a button focused.
  await page.evaluate(() => document.activeElement?.blur())
  await tabTo(exportButton)
  const empty = await emptyCanvasPoint()
  await page.mouse.click(empty.x, empty.y)
  await page.waitForTimeout(200)
  const focusAfterClick = await activeElement()
  check(focusAfterClick === "body", `6. a click on empty canvas leaves focus on the page (${focusAfterClick})`)

  const frame = await firstFrame()
  const v0 = await viewport()
  const delta = { x: 120, y: 80 }
  await page.keyboard.down("Space")
  await page.mouse.move(frame.screen.x, frame.screen.y)
  await page.mouse.down()
  await page.mouse.move(frame.screen.x + delta.x / 2, frame.screen.y + delta.y / 2, { steps: 6 })
  await page.mouse.move(frame.screen.x + delta.x, frame.screen.y + delta.y, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up("Space")
  await page.waitForTimeout(300)
  const v1 = await viewport()
  const moved = { x: v1[4] - v0[4], y: v1[5] - v0[5] }
  check(
    Math.abs(moved.x - delta.x) < 2 && Math.abs(moved.y - delta.y) < 2,
    `6. Space + drag pans the canvas by the drag (${Math.round(moved.x)}, ${Math.round(moved.y)})`,
  )
  const frameAfter = await firstFrame()
  check(
    Math.abs(frameAfter.left - frame.left) < 0.5 && Math.abs(frameAfter.top - frame.top) < 0.5,
    "6. the page under the drag stays where it is",
  )

  // 7a. "Add page after", after a mouse click, with a page selected on the canvas.
  await checkMousePan(`7a. "Add page after"`, addAfter, async () => {
    const frame = await firstFrame()
    await page.mouse.click(frame.screen.x + 10, frame.screen.y + 10)
    await addAfter.waitFor({ timeout: 2_000 })
    const before = await frameCount()
    await addAfter.click()
    await page.waitForTimeout(300)
    const added = await frameCount()
    check(added === before + 1, `7a. a click on "Add page after" adds a page (${before} → ${added})`)
    return async () => {
      const count = await frameCount()
      return [count === added, `pages ${added} → ${count}`]
    }
  })

  // 7b. Export, focused again by its dialog's mouse-clicked Cancel.
  await checkMousePan("7b. Export", exportButton, async () => {
    await exportButton.click()
    await exportDialog.waitFor({ timeout: 1_500 })
    await exportDialog.getByRole("button", { name: "Cancel" }).click()
    await exportDialog.waitFor({ state: "detached" })
    await page.waitForTimeout(200)
    return async () => {
      const dialogs = await page.getByRole("dialog").count()
      if (dialogs > 0) {
        await page.keyboard.press("Escape")
        await page.waitForTimeout(300)
      }
      return [dialogs === 0, `${dialogs} dialogs open`]
    }
  })

  // 7c. The Canvas tab, clicked while Canvas is showing.
  await checkMousePan("7c. Canvas tab", canvasTab, async () => {
    await canvasTab.click()
    await page.waitForTimeout(200)
    return async () => {
      const selected = (await canvasTab.getAttribute("aria-selected")) === "true"
      const mounted = await page.evaluate(() => window.__sequenceCanvas.upperCanvasEl.isConnected)
      return [selected && mounted, `Canvas selected: ${selected}, canvas mounted: ${mounted}`]
    }
  })

  // 7d. The Cover checkbox, with a page selected.
  await checkMousePan("7d. Cover", coverBox, async () => {
    const frame = await firstFrame()
    await page.mouse.click(frame.screen.x + 10, frame.screen.y + 10)
    await coverBox.waitFor({ timeout: 2_000 })
    const before = await coverBox.isChecked()
    await coverBox.click()
    await page.waitForTimeout(300)
    const clicked = await coverBox.isChecked()
    check(clicked !== before, `7d. a click toggles Cover (${before} → ${clicked})`)
    // Cover or not, the page stays page 1. The drag's press on the canvas
    // deselects it, so select it again to read its checkbox.
    return async () => {
      if ((await coverBox.count()) === 0) {
        const again = await firstFrame()
        await page.mouse.click(again.screen.x + 10, again.screen.y + 10)
        await coverBox.waitFor({ timeout: 2_000 }).catch(() => {})
      }
      const now = (await coverBox.count()) > 0 ? await coverBox.isChecked() : null
      return [now === clicked, `checked ${clicked} → ${now}`]
    }
  })

  // 8. Text fields still type a space.
  await placeTextOnFirstPage(page, "Ink")
  const textField = inspector.getByRole("textbox", { name: "Text", exact: true })
  await textField.click()
  await page.keyboard.press("End")
  await page.keyboard.press("Space")
  await page.keyboard.type("well")
  check(
    (await textField.inputValue()) === "Ink well",
    `8. Space types a space in the inspector's Text field ("${await textField.inputValue()}")`,
  )

  await page.getByRole("button", { name: "Provide feedback" }).click()
  const feedbackField = page.getByRole("dialog", { name: "Send feedback" }).getByRole("textbox", { name: "Feedback" })
  await feedbackField.click()
  await page.keyboard.type("a")
  await page.keyboard.press("Space")
  await page.keyboard.type("b")
  check(
    (await feedbackField.inputValue()) === "a b",
    `8. Space types a space in the feedback field ("${await feedbackField.inputValue()}")`,
  )
  await page.keyboard.press("Escape")

  check(errors.length === 0, `9. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "space-keys-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nSpace keys: PASS" : `\nSpace keys: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
