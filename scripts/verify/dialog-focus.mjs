// Dialog focus check: keyboard focus starts in the right place and Tab never
// reaches what a dialog covers (issue #45).
//
//   npm run verify:dialog-focus      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/dialog-focus.mjs
//
// Tab and Shift+Tab are pressed 20 times each with no pause between presses:
// Base UI's own trap redirects on the next animation frame, so fast presses
// are exactly what used to walk out of the Export dialog.
//
// The contract:
//   1. Introduction overlay (covers the panels and canvas, not the top nav):
//      focus starts on "Get started" and only ever lands in the overlay, the
//      top nav or the browser's own UI, never on a covered control.
//   2. Book setup (covers the canvas region): focus starts on the selected
//      page size and never lands on the canvas or its toolbars.
//   3. Export dialog (modal): focus starts on the selected format, never on
//      the info button, and never leaves the dialog.
//   4. No uncaught page errors.

import path from "node:path"

import { importPhotos, openApp, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const PRESSES = 20

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** Where focus is, described, and whether `allowed` (run in the page) accepts it. */
const focusIn = (page, allowed) =>
  page.evaluate((allowedSource) => {
    const element = document.activeElement
    const describe = (e) =>
      !e || e === document.body ? "body" : `${e.tagName.toLowerCase()} "${(e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 24)}"`
    // eslint-disable-next-line no-new-func
    const ok = new Function("element", `return (${allowedSource})(element)`)(element)
    return { ok, where: describe(element) }
  }, allowed.toString())

/** Presses Tab then Shift+Tab `PRESSES` times each, back to back, and returns
 *  every place focus landed that `allowed` rejects. */
async function tabAround(page, allowed) {
  const escapes = []
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < PRESSES; i++) {
      await page.keyboard.press(key)
      const { ok, where } = await focusIn(page, allowed)
      if (!ok) escapes.push(`${key} #${i + 1} → ${where}`)
    }
  }
  return escapes
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)

try {
  // 1. Introduction overlay.
  const intro = page.getByRole("dialog", { name: "About Loupe" })
  await intro.waitFor()
  await page.waitForTimeout(100)
  const introStart = await focusIn(page, (element) => element?.textContent?.trim() === "Get started")
  check(introStart.ok, `1. the introduction starts focus on "Get started" (${introStart.where})`)
  // Past the last tabbable on the page, Tab goes to the browser's own UI
  // (activeElement = body) before wrapping to the top nav. That's right for
  // an overlay that isn't modal; what matters is never landing under it.
  const introEscapes = await tabAround(
    page,
    (element) =>
      element === document.body ||
      !!element?.closest('[role="dialog"][aria-label="About Loupe"]') ||
      !!element?.closest("header, [role=banner]"),
  )
  check(
    introEscapes.length === 0,
    `1. ${PRESSES * 2} fast Tab/Shift+Tab presses stay in the introduction or the top nav` +
      (introEscapes.length ? `; escaped: ${introEscapes.slice(0, 3).join("; ")}` : ""),
  )
  await intro.getByRole("button", { name: "Get started" }).click()
  await intro.waitFor({ state: "detached" })

  // 2. Book setup, after importing.
  await importPhotos(page)
  const setup = page.getByRole("dialog", { name: "Set up your book" })
  await setup.waitFor()
  await page.waitForTimeout(100)
  const setupStart = await focusIn(
    page,
    (element) => element?.getAttribute("aria-pressed") === "true" && !!element.closest('[role="dialog"]'),
  )
  check(setupStart.ok, `2. book setup starts focus on the selected page size (${setupStart.where})`)
  const setupEscapes = await tabAround(page, (element) => {
    const dialog = document.querySelector('[role="dialog"]')
    const region = dialog?.parentElement?.parentElement
    return !region || !region.contains(element) || dialog.contains(element)
  })
  check(
    setupEscapes.length === 0,
    `2. ${PRESSES * 2} fast Tab/Shift+Tab presses never land on the canvas or its toolbars` +
      (setupEscapes.length ? `; landed on: ${setupEscapes.slice(0, 3).join("; ")}` : ""),
  )
  await setupBook(page, { preset: "A5 Portrait", pageCount: 10 })

  // 3. Export dialog.
  await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
  const exportDialog = page.getByRole("dialog", { name: "Export book" })
  await exportDialog.waitFor()
  await page.waitForTimeout(100)
  const exportStart = await focusIn(
    page,
    (element) => element instanceof HTMLInputElement && element.type === "radio" && element.checked,
  )
  check(exportStart.ok, `3. the Export dialog starts focus on the selected format (${exportStart.where})`)
  const exportEscapes = await tabAround(page, (element) => !!element?.closest('[role="dialog"]'))
  check(
    exportEscapes.length === 0,
    `3. ${PRESSES * 2} fast Tab/Shift+Tab presses never leave the Export dialog` +
      (exportEscapes.length ? `; escaped: ${exportEscapes.slice(0, 3).join("; ")}` : ""),
  )

  check(errors.length === 0, `4. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "dialog-focus-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nDialog focus: PASS" : `\nDialog focus: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
