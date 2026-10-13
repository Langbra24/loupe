// Text-box click check: a single click selects a placed text box, a double
// click edits it with the caret where you clicked (issue #14).
//
//   npm run verify:text-selection    # builds first, with test hooks on
//
// Selection handles and the caret are pixels on the Fabric canvas, so this
// reads them off `window.__loupeCanvas`. That hook exists only in a build made
// with LOUPE_TEST_HOOKS=1 (the npm script does that); an ordinary
// build compiles it out. With LOUPE_URL, the server must be such a build.
//
// The contract, on a frame, after placing a box with `T`, typing "Hello" and
// pressing Escape:
//   1. A single click selects the box: handles showing, no caret, and typing
//      "x" leaves the text "Hello". A second single click doesn't edit either.
//   2. Dragging the box moves it.
//   3. A double click edits with a collapsed caret at the click point; "!"
//      inserts there ("He!llo") and replaces nothing.
//   4. Escape returns to selected-with-handles; a second Escape deselects.
//   5. The text survives a reload (IndexedDB).
//   6. Enter on the selected box (issue #20) edits with a collapsed caret at
//      the end, so "?" appends; Escape returns to selected; Enter while the
//      book-name field has focus leaves the box alone.
//   7. No uncaught page errors.
// Along the way: the inspector shows the text element's properties both
// while selected and while editing.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, settle, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

/** What the canvas has selected, and whether it is being typed into. */
const active = () =>
  page.evaluate(() => {
    const object = window.__loupeCanvas.getActiveObject()
    if (!object) return null
    return {
      kind: object.elementKind ?? null,
      elementId: object.elementId ?? null,
      editing: Boolean(object.isEditing),
      handles: Boolean(object.hasControls) && object.isControlVisible("br") && object.isControlVisible("ml"),
      caretFocused: document.activeElement?.tagName === "TEXTAREA",
      text: object.text,
      selection: [object.selectionStart, object.selectionEnd],
      left: object.left,
      top: object.top,
    }
  })

/**
 * Screen point of the boundary before character `charIndex` on the active
 * text box's first line, using the object-space math Fabric's own
 * `getSelectionStartFromPointer` inverts.
 */
const pointInTextbox = (charIndex) =>
  page.evaluate((charIndex) => {
    const canvas = window.__loupeCanvas
    const object = canvas.getActiveObject()
    const x = -object.width / 2 + object.__charBounds[0][charIndex].left
    const y = -object.height / 2 + object.getHeightOfLine(0) / 2
    const [a, b, c, d, e, f] = object.calcTransformMatrix()
    const scene = { x: a * x + c * y + e, y: b * x + d * y + f }
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.left + v[0] * scene.x + v[2] * scene.y + v[4], y: rect.top + v[1] * scene.x + v[3] * scene.y + v[5] }
  }, charIndex)

/** Screen point of the (one) text box's center, selected or not. */
const textCenter = () =>
  page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const center = canvas
      .getObjects()
      .find((object) => object.elementKind === "text")
      .getCenterPoint()
    const v = canvas.viewportTransform
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    return { x: rect.left + v[0] * center.x + v[4], y: rect.top + v[3] * center.y + v[5] }
  })

const inspectorShowsText = () =>
  page
    .getByRole("tablist", { name: "Text alignment" })
    .waitFor({ timeout: 2_000 })
    .then(() => true, () => false)

/** The text elements as persisted, straight from IndexedDB. */
const storedTexts = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("loupe")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () =>
            resolve(
              (get.result[0]?.frames ?? [])
                .flatMap((frame) => frame.elements)
                .filter((element) => element.kind === "text")
                .map((element) => element.content),
            )
        }
      }),
  )

try {
  await dismissIntroduction(page)
  if (!(await page.evaluate(() => Boolean(window.__loupeCanvas)))) {
    throw new Error(
      "window.__loupeCanvas is missing: this build has no test hooks. Run `npm run verify:text-selection`, " +
        "or build with LOUPE_TEST_HOOKS=1 before pointing LOUPE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  // The canvas fits the new book to view a moment after setup; measure after.
  await settle(page)

  // Zoom in on page 1 through the real wheel handler, so "Hello" is big
  // enough to double-click between two letters.
  const frame = await page.evaluate(() => {
    const canvas = window.__loupeCanvas
    const rect = canvas.upperCanvasEl.getBoundingClientRect()
    const first = canvas
      .getObjects()
      .filter((object) => object.frameId && !object.elementId && object.type === "rect")
      .sort((p, q) => p.top - q.top || p.left - q.left)[0]
    const v = canvas.viewportTransform
    return { x: rect.left + v[0] * first.left + v[4], y: rect.top + v[3] * first.top + v[5] }
  })
  await page.mouse.move(frame.x, frame.y)
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -560)
  await page.waitForTimeout(300)

  // Place a box with T, type, Escape. The `T` box enters editing at once.
  await page.keyboard.press("T")
  await page.mouse.click(frame.x - 150, frame.y - 150)
  await page.waitForFunction(() => window.__loupeCanvas.getActiveObject()?.isEditing === true, null, { timeout: 5_000 })
  check(true, "T then a click on the frame places a box already in editing")
  await page.keyboard.type("Hello")
  await page.keyboard.press("Escape")
  let state = await active()
  check(
    state?.kind === "text" && !state.editing && state.handles && state.text === "Hello",
    `Escape after typing leaves "Hello" selected with handles (${JSON.stringify(state)})`,
  )

  await page.keyboard.press("Escape")
  check((await active()) === null, "a second Escape deselects")

  // 1. Single click selects, no caret; typing doesn't edit.
  const center = await textCenter()
  await page.mouse.click(center.x, center.y)
  state = await active()
  check(
    state?.kind === "text" && !state.editing && state.handles && !state.caretFocused,
    `1. a single click selects the box: handles showing, no caret (${JSON.stringify(state)})`,
  )
  check(await inspectorShowsText(), "the inspector shows the text element's properties while selected")
  await page.keyboard.type("x")
  check((await active())?.text === "Hello", `typing "x" while selected leaves the text "Hello"`)
  await page.waitForTimeout(250) // past the double-click window
  await page.mouse.click(center.x, center.y)
  state = await active()
  check(state?.kind === "text" && !state.editing && state.handles, "a second single click on the selected box still doesn't edit")

  // 2. Dragging moves it.
  const before = { left: state.left, top: state.top }
  await page.waitForTimeout(250)
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  await page.mouse.move(center.x + 40, center.y + 30, { steps: 8 })
  await page.mouse.move(center.x + 80, center.y + 60, { steps: 8 })
  await page.mouse.up()
  state = await active()
  check(
    state?.kind === "text" && !state.editing && (state.left !== before.left || state.top !== before.top),
    `2. dragging moves the box (${before.left.toFixed(0)},${before.top.toFixed(0)} → ${state?.left?.toFixed(0)},${state?.top?.toFixed(0)})`,
  )

  // 3. Double click between "He" and "llo": caret there, "!" inserts.
  await page.waitForTimeout(250)
  const between = await pointInTextbox(2)
  await page.mouse.dblclick(between.x, between.y)
  state = await active()
  check(
    state?.editing && state.caretFocused && state.selection[0] === 2 && state.selection[1] === 2,
    `3. a double click edits with a collapsed caret at the click point (selection ${JSON.stringify(state?.selection)})`,
  )
  check(await inspectorShowsText(), "the inspector shows the text element's properties while editing")
  await page.keyboard.type("!")
  check((await active())?.text === "He!llo", `typing "!" inserts at the caret and replaces nothing (${(await active())?.text})`)

  // While editing, a double click keeps the editor convention: select a word.
  await page.waitForTimeout(250)
  const insideWord = await pointInTextbox(1)
  await page.mouse.dblclick(insideWord.x, insideWord.y)
  state = await active()
  check(
    state?.editing && state.selection[0] === 0 && state.selection[1] === 2,
    `while editing, a double click selects the word under it, "He" (selection ${JSON.stringify(state?.selection)})`,
  )

  // 4. Escape back to selected-with-handles.
  await page.keyboard.press("Escape")
  state = await active()
  check(state?.kind === "text" && !state.editing && state.handles && !state.caretFocused, "4. Escape returns to selected with handles")

  // 5. Persists across a reload.
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Loupe").waitFor()
  const texts = await page
    .waitForFunction(() => window.__loupeCanvas?.getObjects().some((o) => o.elementKind === "text"), null, { timeout: 10_000 })
    .then(() => storedTexts())
    .catch(() => storedTexts())
  const rendered = await page.evaluate(() => window.__loupeCanvas?.getObjects().find((o) => o.elementKind === "text")?.text)
  check(
    texts.length === 1 && texts[0] === "He!llo" && rendered === "He!llo",
    `5. "He!llo" survives a reload (stored ${JSON.stringify(texts)}, rendered ${JSON.stringify(rendered)})`,
  )

  // 6. Enter on a selected box: caret at the end. Select it with a single click first.
  await page.waitForFunction(() => window.__loupeCanvas?.getObjects().some((o) => o.elementKind === "text"))
  const reloadedCenter = await textCenter()
  await page.mouse.click(reloadedCenter.x, reloadedCenter.y)
  state = await active()
  check(state?.kind === "text" && !state.editing && state.handles, "after the reload, a single click selects the box again")
  await page.keyboard.press("Enter")
  state = await active()
  check(
    state?.editing && state.caretFocused && state.selection[0] === 6 && state.selection[1] === 6,
    `6a. Enter on the selected box edits with a collapsed caret at the end (selection ${JSON.stringify(state?.selection)})`,
  )
  await page.keyboard.type("?")
  check((await active())?.text === "He!llo?", `typing "?" appends (${(await active())?.text})`)
  await page.keyboard.press("Escape")
  state = await active()
  check(state?.kind === "text" && !state.editing && state.handles, "6b. Escape returns to selected with handles")

  await page.getByRole("complementary").first().getByRole("button", { name: "Untitled book", exact: true }).click()
  await page.getByRole("textbox", { name: "Book name" }).press("Enter")
  state = await active()
  check(
    state?.kind === "text" && !state.editing && !state.caretFocused && state.text === "He!llo?",
    `6c. Enter in the book-name field leaves the text box alone (${JSON.stringify({ editing: state?.editing, text: state?.text })})`,
  )

  check(errors.length === 0, `7. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "text-selection-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nText selection: PASS" : `\nText selection: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
