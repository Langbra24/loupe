// Color undo check: a typed hex value and a hue-slider drag are one undo step
// each, and undo/redo move the color everywhere (issue #27).
//
//   npm run verify:color-undo        # builds first
//   SEQUENCE_URL=http://localhost:3000 node scripts/verify/color-undo.mjs
//
// The contract, on a new text box (default color #18181b):
//   1. Type #37bf7b into the hex field, then drag the hue slider top to bottom.
//   2. Cmd/Ctrl+Z once undoes the whole drag (back to #37bf7b, not to some
//      color partway through it); again undoes the hex edit (back to #18181b).
//   3. Cmd/Ctrl+Shift+Z redoes each in turn.
//   4. Typing a hex and pressing Escape mid-typing closes the picker; after
//      reopening it and dragging the hue, one undo reverts just that drag. So
//      no gesture is left open when the popover unmounts.
//   After every step the hex field, the sidebar's Color field and the stored
//   text element agree.

import path from "node:path"

import { openApp, openColorPicker } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const DEFAULT = "#18181b"
const TYPED = "#37bf7b"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const storedColor = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("sequence")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () =>
            resolve(
              (get.result[0]?.frames ?? []).flatMap((frame) => frame.elements).find((e) => e.kind === "text")?.color ??
                null,
            )
        }
      }),
  )

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  const popover = await openColorPicker(page)
  const hex = popover.getByRole("textbox", { name: "Hex color" })
  const hue = popover.getByRole("slider", { name: "Hue" })
  const sidebar = page.getByRole("complementary").getByRole("button", { name: /^Color #[0-9a-f]{6}$/i })

  /** The color in the hex field, the sidebar and IndexedDB (stored null = the default). */
  const colorEverywhere = async () => {
    await page.waitForTimeout(1_000) // past the save debounce
    const stored = await storedColor(page)
    return {
      field: (await hex.inputValue()).toLowerCase(),
      sidebar: (await sidebar.textContent()).trim().toLowerCase(),
      stored: (stored ?? DEFAULT).toLowerCase(),
    }
  }
  const agreesOn = async (label, want) => {
    const seen = await colorEverywhere()
    check(
      seen.field === want && seen.sidebar === want && seen.stored === want,
      `${label}: ${want} in the hex field, sidebar and IndexedDB (${JSON.stringify(seen)})`,
    )
  }

  // 1. A typed hex edit, ended by moving focus to the hue slider.
  await hex.fill(TYPED)
  await page.keyboard.press("Shift+Tab")
  await agreesOn("typed hex", TYPED)

  // A drag down the hue slider, many pointermoves long.
  const box = await hue.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 4, { steps: 20 })
  await page.mouse.up()
  const dragged = (await hex.inputValue()).toLowerCase()
  check(dragged !== TYPED, `the drag changed the color (${TYPED} → ${dragged})`)

  // 2. Undo: the whole drag, then the hex edit. Focus is on the slider, not a text field.
  await page.keyboard.press("ControlOrMeta+z")
  await agreesOn("one undo reverts the whole drag", TYPED)
  await page.keyboard.press("ControlOrMeta+z")
  await agreesOn("a second undo reverts the typed hex", DEFAULT)

  // 3. Redo both.
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await agreesOn("redo reapplies the typed hex", TYPED)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await agreesOn("redo reapplies the drag", dragged)

  // 4. Escape mid-typing, reopen, drag, undo once.
  const ESCAPED = "#123456"
  await hex.click()
  await hex.fill("")
  await page.keyboard.type(ESCAPED)
  await page.keyboard.press("Escape")
  await popover.waitFor({ state: "hidden" })
  await sidebar.click()
  await hue.waitFor()
  const hueBox = await hue.boundingBox()
  await page.mouse.move(hueBox.x + hueBox.width / 2, hueBox.y + 4)
  await page.mouse.down()
  await page.mouse.move(hueBox.x + hueBox.width / 2, hueBox.y + hueBox.height / 2, { steps: 12 })
  await page.mouse.up()
  const draggedAgain = (await hex.inputValue()).toLowerCase()
  check(draggedAgain !== ESCAPED, `the drag after reopening changed the color (${ESCAPED} → ${draggedAgain})`)
  await page.keyboard.press("ControlOrMeta+z")
  await agreesOn("after Escape mid-typing, one undo reverts only the next drag", ESCAPED)

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "color-undo-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nColor undo: PASS" : `\nColor undo: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
