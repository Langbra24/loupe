// Frame cycling check: `]` / `[` cycle the focused frame, and Tab is plain
// browser focus movement again (issue #19).
//
//   npm run verify:frame-cycling     # builds first, with test hooks on
//
// Nothing on the canvas shows the focused frame yet, so this reads it from
// `window.__loupeFocusedFrameIndex`, which exists only in a build made with
// LOUPE_TEST_HOOKS=1 (the npm script does that). With LOUPE_URL, the server
// must be such a build.
//
// The contract, on a fresh load of an 8-page book:
//   1. The first Tab focuses a real UI control, and moves no frame.
//   2. With nothing focused, `]` focuses frame 0, then 1; `[` goes back to 0
//      and then wraps to the last frame.
//   3. Typing `[` in the book-name field inserts a `[` and moves no frame.
//   4. No uncaught page errors.

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

const focusedFrame = () => page.evaluate(() => window.__loupeFocusedFrameIndex)
const activeControl = () =>
  page.evaluate(() => {
    const element = document.activeElement
    if (!element || element === document.body) return null
    return { tag: element.tagName.toLowerCase(), name: element.getAttribute("aria-label") ?? element.textContent.trim() }
  })

try {
  await dismissIntroduction(page)
  if ((await page.evaluate(() => "__loupeFocusedFrameIndex" in window)) === false) {
    throw new Error(
      "window.__loupeFocusedFrameIndex is missing: this build has no test hooks. Run `npm run verify:frame-cycling`, " +
        "or build with LOUPE_TEST_HOOKS=1 before pointing LOUPE_URL at it.",
    )
  }
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: PAGES })

  // 1. A fresh load (the book is in IndexedDB now): the first Tab reaches the UI.
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Loupe").waitFor()
  await settle(page)
  await page.keyboard.press("Tab")
  const first = await activeControl()
  check(
    first !== null && ["a", "button", "input"].includes(first.tag),
    `1. the first Tab focuses a real UI control (${JSON.stringify(first)})`,
  )
  check((await focusedFrame()) === null, "   and moves no frame")

  // 2. Brackets with nothing focused. Clicking empty canvas leaves focus on the body.
  const canvas = await page.locator("canvas.upper-canvas").first().boundingBox()
  await page.mouse.click(canvas.x + canvas.width - 20, canvas.y + canvas.height / 2)
  check((await activeControl()) === null, "clicking empty canvas leaves no control focused")
  const sequence = []
  for (const key of ["]", "]", "[", "["]) {
    await page.keyboard.press(key)
    sequence.push(await focusedFrame())
  }
  check(
    JSON.stringify(sequence) === JSON.stringify([0, 1, 0, PAGES - 1]),
    `2. ] ] [ [ focuses frames ${JSON.stringify(sequence)} (want [0,1,0,${PAGES - 1}], wrapping at the start)`,
  )

  // 3. In the book-name field, `[` is just a character.
  const before = await focusedFrame()
  await page.getByRole("complementary").first().getByRole("button", { name: "Untitled book", exact: true }).click()
  const field = page.getByRole("textbox", { name: "Book name" })
  await field.press("End")
  await page.keyboard.press("[")
  const value = await field.inputValue()
  check(value === "Untitled book[", `3. typing [ in the book-name field inserts it (${JSON.stringify(value)})`)
  check((await focusedFrame()) === before, `   and moves no frame (still ${before})`)
  await page.keyboard.press("Escape")

  check(errors.length === 0, `4. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "frame-cycling-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nFrame cycling: PASS" : `\nFrame cycling: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
