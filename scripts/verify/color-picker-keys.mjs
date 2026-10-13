// Color picker keyboard check: arrow keys, Shift and Home/End drive the hue
// slider and the saturation/value square (issue #21).
//
//   npm run verify:picker-keys       # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/color-picker-keys.mjs
//
// The contract, starting from #37bf7b (saturated, so a few degrees of hue
// always change the hex):
//   1. Hue slider: → ×5 then Shift+→ moves the hue by exactly 15°; Home and
//      End reach 0° and 359°.
//   2. Square: ↑ ×3 raises brightness by exactly 3; Home and End set
//      saturation to 0 and 100, and → at 100 stays there.
//   3. After each move the hex field, the sidebar's Color field and the
//      stored text element all hold the same new color.
//   4. aria-valuetext reads as words ("Hue 140 degrees", "Saturation 72%,
//      brightness 75%"); no uncaught page errors.

import path from "node:path"

import { openApp, openColorPicker } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const START = "#37bf7b"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** The text element's color as persisted, straight from IndexedDB. */
const storedColor = (page) =>
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
  const square = popover.getByRole("slider", { name: "Saturation and value" })
  const sidebarColor = () =>
    page
      .getByRole("complementary")
      .getByRole("button", { name: /^Color #[0-9a-f]{6}$/i })
      .textContent()
      .then((text) => text.trim().toLowerCase())

  /** Hex field, sidebar field and stored element agree on one new color. */
  const colorFollows = async (label, previous) => {
    const field = (await hex.inputValue()).toLowerCase()
    const sidebar = await sidebarColor()
    // The store's save is debounced (800ms); wait it out before reading IndexedDB.
    await page.waitForTimeout(1_000)
    const stored = (await storedColor(page))?.toLowerCase()
    check(
      field !== previous && field === sidebar && field === stored,
      `${label}: hex field ${field}, sidebar ${sidebar}, stored ${stored} (was ${previous})`,
    )
    return field
  }

  await hex.fill(START)
  await page.waitForTimeout(200)
  let color = (await hex.inputValue()).toLowerCase()

  // 1. Hue: five steps of 1°, one Shift step of 10°.
  await hue.focus()
  const hue0 = Number(await hue.getAttribute("aria-valuenow"))
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Shift+ArrowRight")
  const hue1 = Number(await hue.getAttribute("aria-valuenow"))
  check(hue1 - hue0 === 15, `1. hue: → ×5, Shift+→ ×1 moves ${hue0}° → ${hue1}° (want +15)`)
  const hueText = await hue.getAttribute("aria-valuetext")
  check(hueText === `Hue ${hue1} degrees`, `4. hue aria-valuetext reads "${hueText}"`)
  color = await colorFollows("3. after the hue keys", color)
  await page.keyboard.press("Home")
  check(Number(await hue.getAttribute("aria-valuenow")) === 0, "1. hue: Home goes to 0°")
  await page.keyboard.press("End")
  check(Number(await hue.getAttribute("aria-valuenow")) === 359, "1. hue: End goes to 359°")
  await page.keyboard.press("ArrowRight")
  check(Number(await hue.getAttribute("aria-valuenow")) === 359, "1. hue: → at 359° clamps, no wrap")
  color = (await hex.inputValue()).toLowerCase()

  // 2. Square: brightness up by three.
  await square.focus()
  const brightness = async () => Number((await square.getAttribute("aria-valuetext")).match(/brightness (\d+)%/)[1])
  const v0 = await brightness()
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowUp")
  const v1 = await brightness()
  check(v1 - v0 === 3, `2. square: ↑ ×3 raises brightness ${v0}% → ${v1}% (want +3)`)
  const squareText = await square.getAttribute("aria-valuetext")
  check(/^Saturation \d+%, brightness \d+%$/.test(squareText), `4. square aria-valuetext reads "${squareText}"`)
  color = await colorFollows("3. after the square keys", color)
  await page.keyboard.press("Home")
  check(Number(await square.getAttribute("aria-valuenow")) === 0, "2. square: Home sets saturation to 0")
  await page.keyboard.press("End")
  check(Number(await square.getAttribute("aria-valuenow")) === 100, "2. square: End sets saturation to 100")
  await page.keyboard.press("ArrowRight")
  check(Number(await square.getAttribute("aria-valuenow")) === 100, "2. square: → at 100 clamps")

  check(errors.length === 0, `4. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "color-picker-keys-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nColor picker keys: PASS" : `\nColor picker keys: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
