// Book setup dialog check (issue #57).
//
//   npm run verify:book-setup      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/book-setup.mjs
//
// The contract:
//   1. The copy says page count can change later and page size can't.
//   2. Custom carries aria-pressed like the presets: "true" when chosen, and
//      the presets go "false".
//   3. The custom width, custom height and page-count inputs share one field
//      style (border, background, radius, font size, height), and show the
//      same focus ring when reached with Tab.
//   4. An invalid custom size or page count sets aria-invalid="true" on its
//      input(s), and aria-describedby points at the visible message. A valid
//      value clears both.
//   5. The card's top edge moves by 0px when Custom is toggled on and off and
//      when an error line appears. The card does grow, so this isn't vacuous.
//   6. The book can still be created afterwards; no uncaught page errors.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const FIELD_PROPS = [
  "borderTopWidth",
  "borderTopColor",
  "borderTopStyle",
  "backgroundColor",
  "borderTopLeftRadius",
  "fontSize",
  "fontFamily",
  "height",
]
const FOCUS_PROPS = ["boxShadow", "borderTopColor", "outlineStyle", "outlineColor", "outlineWidth", "outlineOffset"]

const styleOf = (locator, props) =>
  locator.evaluate((element, names) => {
    const style = getComputedStyle(element)
    return Object.fromEntries(names.map((name) => [name, style[name]]))
  }, props)

const same = (styles) => styles.every((s) => JSON.stringify(s) === JSON.stringify(styles[0]))

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  const dialog = page.getByRole("dialog", { name: "Set up your book" })
  await dialog.waitFor()
  await page.waitForTimeout(100)
  const top = async () => (await dialog.boundingBox()).y
  const height = async () => (await dialog.boundingBox()).height

  // 1. Copy.
  const copy = "Page count can change later; page size is set for this book."
  check(await dialog.getByText(copy).isVisible(), `1. the copy reads "${copy}"`)
  check(
    (await dialog.getByText(/You can change this later/).count()) === 0,
    `1. the old "You can change this later" promise is gone`,
  )

  const presetTop = await top()
  const presetHeight = await height()

  // 2. aria-pressed on Custom.
  const custom = dialog.getByRole("button", { name: "Custom", exact: true })
  check((await custom.getAttribute("aria-pressed")) === "false", `2. Custom starts aria-pressed="false"`)
  await custom.click()
  check((await custom.getAttribute("aria-pressed")) === "true", `2. Custom is aria-pressed="true" once chosen`)
  const pressedPresets = await dialog.locator('button[aria-pressed="true"]').count()
  check(pressedPresets === 1, `2. only one page size is pressed (${pressedPresets})`)

  const customTop = await top()
  const customHeight = await height()
  check(
    customTop === presetTop,
    `5. choosing Custom moves the top edge by ${customTop - presetTop}px (card grew ${customHeight - presetHeight}px)`,
  )
  check(customHeight > presetHeight, `5. the card does grow with the custom row (${presetHeight} → ${customHeight}px)`)

  // 3. One field style, one focus ring.
  const width = dialog.getByLabel("Width in millimetres")
  const heightField = dialog.getByLabel("Height in millimetres")
  const count = dialog.getByLabel("Starting page count")
  const fields = [width, heightField, count]
  const fieldStyles = await Promise.all(fields.map((field) => styleOf(field, FIELD_PROPS)))
  check(
    same(fieldStyles),
    `3. width, height and page count share one field style` +
      (same(fieldStyles) ? ` (${fieldStyles[0].height} tall, ${fieldStyles[0].fontSize}, radius ${fieldStyles[0].borderTopLeftRadius})` : `: ${JSON.stringify(fieldStyles)}`),
  )

  // Custom has focus from the click; Tab walks width → height → page count.
  const focusStyles = []
  for (const field of fields) {
    await page.keyboard.press("Tab")
    await page.waitForTimeout(250) // the border color transitions in
    const focused = await field.evaluate((element) => element === document.activeElement && element.matches(":focus-visible"))
    check(focused, `3. Tab reaches ${await field.getAttribute("aria-label") ?? "Starting page count"} with :focus-visible`)
    focusStyles.push(await styleOf(field, FOCUS_PROPS))
  }
  // A box-shadow ring, or the shared outline ring (#53).
  const ringOf = (s) =>
    s.outlineStyle !== "none" ? `outline ${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}` : s.boxShadow
  const ringShown = focusStyles.every((s) => ringOf(s) && ringOf(s) !== "none")
  check(
    ringShown && same(focusStyles),
    `3. all three show the same focus ring` +
      (ringShown && same(focusStyles) ? ` (${ringOf(focusStyles[0])})` : `: ${JSON.stringify(focusStyles)}`),
  )

  // 4 + 5. Errors are tied to their inputs and don't move the card.
  const checkInvalid = async (inputs, label) => {
    for (const input of inputs) {
      const name = (await input.getAttribute("aria-label")) ?? "Starting page count"
      const invalid = await input.getAttribute("aria-invalid")
      const describedBy = await input.getAttribute("aria-describedby")
      const message = describedBy ? page.locator(`[id="${describedBy}"]`) : null
      const visible = message ? await message.isVisible() : false
      const text = message && visible ? (await message.textContent()).trim() : ""
      check(
        invalid === "true" && visible && text.length > 0,
        `4. ${label}: ${name} has aria-invalid="${invalid}" and aria-describedby → ${visible ? `"${text}"` : "nothing visible"}`,
      )
    }
  }
  const checkValid = async (inputs, label) => {
    for (const input of inputs) {
      const name = (await input.getAttribute("aria-label")) ?? "Starting page count"
      const invalid = await input.getAttribute("aria-invalid")
      const describedBy = await input.getAttribute("aria-describedby")
      check(invalid === null && describedBy === null, `4. ${label}: ${name} drops aria-invalid and aria-describedby`)
    }
  }

  await width.fill("0")
  await checkInvalid([width, heightField], "custom size 0 × 297")
  const sizeErrorTop = await top()
  check(sizeErrorTop === presetTop, `5. the custom size error moves the top edge by ${sizeErrorTop - presetTop}px`)

  await count.fill("0")
  await checkInvalid([count], "page count 0")
  const countErrorTop = await top()
  check(countErrorTop === presetTop, `5. the page count error moves the top edge by ${countErrorTop - presetTop}px`)

  await width.fill("210")
  await count.fill("12")
  await checkValid([width, heightField, count], "valid values")

  const preset = dialog.getByRole("button", { name: "A5 Portrait", exact: true })
  await preset.click()
  check((await custom.getAttribute("aria-pressed")) === "false", `2. Custom goes back to aria-pressed="false" on a preset`)
  const backTop = await top()
  check(backTop === presetTop, `5. toggling Custom off moves the top edge by ${backTop - presetTop}px`)
  await custom.click()
  const againTop = await top()
  check(againTop === presetTop, `5. toggling Custom on again moves the top edge by ${againTop - presetTop}px`)

  // 6. Still completes.
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  check(true, "6. the book is created from a preset after toggling Custom")
  check(errors.length === 0, `6. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "book-setup-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nBook setup: PASS" : `\nBook setup: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
