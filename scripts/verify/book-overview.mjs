// Book overview check: pages are white paper and text keeps its own color
// (issue #54).
//
//   npm run verify:book-overview     # builds first
//   SEQUENCE_URL=http://localhost:3000 node scripts/verify/book-overview.mjs
//
// The contract: place a caption on page 1, give it a color through the
// sidebar's Color field, then open the Book view. Page 1's preview has a
// white background, as on the canvas and in the exported PDF, and the caption
// renders in exactly the color picked, not the shell's light foreground.

import path from "node:path"

import { openApp, openColorPicker } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const CAPTION = "Ink"
const COLOR = "#c2410c"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const rgb = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  const popover = await openColorPicker(page)
  await popover.getByRole("textbox", { name: "Hex color" }).fill(COLOR)
  await page.keyboard.press("Shift+Tab") // commits the hex, as in color-undo.mjs
  await page.keyboard.press("Escape")
  await popover.waitFor({ state: "hidden" })
  const sidebar = page.getByRole("complementary").getByRole("button", { name: /^Color #[0-9a-f]{6}$/i })
  check(
    (await sidebar.textContent()).trim().toLowerCase() === COLOR,
    `the sidebar's Color field reads ${COLOR} before opening the Book view`,
  )

  await page.getByRole("tab", { name: "Book" }).click()
  // The sidebar textarea holds the caption too; inside a button, only the
  // Book view's page 1 preview does.
  const caption = page.locator("button").getByText(CAPTION, { exact: true })
  await caption.waitFor()
  check((await caption.count()) === 1, `one "${CAPTION}" caption in the Book view (found ${await caption.count()})`)
  const preview = caption.locator("xpath=ancestor::button[1]")

  const background = await preview.evaluate((el) => getComputedStyle(el).backgroundColor)
  check(background === "rgb(255, 255, 255)", `page 1's preview is white paper (background ${background})`)

  const color = await caption.evaluate((el) => getComputedStyle(el).color)
  check(color === rgb(COLOR), `the caption renders in ${COLOR} = ${rgb(COLOR)} (color ${color})`)

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "book-overview-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nBook overview: PASS" : `\nBook overview: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
