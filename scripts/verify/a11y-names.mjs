// Accessible names check: every inspector control is named after its visible
// label, and selected state is exposed (issue #50).
//
//   npm run verify:a11y-names        # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/a11y-names.mjs
//
// The contract, read from Playwright's accessibility snapshot:
//   1. In all four inspector states (nothing, a page, an image, a text box
//      selected) every interactive control has a non-empty name, and each
//      one is the label shown next to it ("Type", "Top", "X", "Color …").
//   2. The active image preset is aria-pressed; the others aren't.
//   3. Book view: each page row and page preview is named "Page N" (the
//      row's margins are its description, not part of its name), and the
//      selected page is aria-current in both.
//   4. The zoom readout's name says what it does: "Zoom N%, reset to 100%".
//   5. No uncaught page errors.

import path from "node:path"

import {
  dismissIntroduction,
  importPhotos,
  openApp,
  placePhotoOnFirstPage,
  placeTextOnFirstPage,
  settle,
  setupBook,
} from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const ROLES = ["button", "combobox", "spinbutton", "textbox", "tab", "slider", "checkbox", "switch", "radio"]

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

/** Every interactive control inside `scope`, as { role, name, rest } read
 *  from its own accessibility snapshot line, e.g. `- combobox "Type": body`. */
async function controls(scope) {
  const found = []
  for (const role of ROLES) {
    for (const element of await scope.getByRole(role).all()) {
      if (!(await element.isVisible())) continue
      const line = (await element.ariaSnapshot()).split("\n")[0]
      // YAML single-quotes the key when the name has a special character:
      // `- 'button "Color #18181b"': "#18181b"`.
      const match = line.match(/^- '?(\w+)(?: "((?:[^"\\]|\\.)*)")?(.*)$/)
      found.push({ role, name: match?.[2] ?? "", rest: match?.[3] ?? "", line })
    }
  }
  return found
}

/** Checks every control in `scope` is named, and that the names include
 *  `expected` (role → names), with nothing unnamed. */
async function expectNames(label, scope, expected) {
  const found = await controls(scope)
  const unnamed = found.filter((control) => control.name.trim() === "")
  check(
    unnamed.length === 0,
    `${label}: every control has a name` + (unnamed.length ? `; unnamed: ${unnamed.map((c) => c.line).join(" | ")}` : ""),
  )
  for (const [role, names] of Object.entries(expected)) {
    const have = found.filter((control) => control.role === role).map((control) => control.name)
    const missing = names.filter((name) => !have.includes(name))
    check(
      missing.length === 0,
      `${label}: ${role}s named ${names.map((n) => `"${n}"`).join(", ")}` +
        (missing.length ? `; missing ${missing.join(", ")} (have ${have.map((n) => `"${n}"`).join(", ")})` : ""),
    )
  }
  return found
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url)
const inspector = page.getByRole("complementary").last()

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })
  await settle(page)

  // 1. Nothing selected: book settings.
  await expectNames("book settings", inspector, {})

  // 4. Zoom readout.
  const zoom = await controls(page.locator("body"))
  const readout = zoom.find((control) => /%/.test(control.name) && control.role === "button")
  check(
    !!readout && /^Zoom \d+%, reset to 100%$/.test(readout.name),
    `4. the zoom readout is named for its action (${readout?.name ?? "not found"})`,
  )

  // 3. Book view: rows and previews, with page 3 selected from its row.
  await page.getByRole("tab", { name: "Book" }).click()
  const pagesList = page.getByRole("complementary").first()
  await pagesList.getByRole("button", { name: "Page 3", exact: true }).click()
  await page.waitForTimeout(300)
  const rows = await pagesList.getByRole("button", { name: /^Page \d+$/ }).all()
  check(rows.length === 8, `3. book view: 8 page rows named "Page N" (found ${rows.length})`)
  const rowDescription = await pagesList
    .getByRole("button", { name: "Page 3", exact: true })
    .evaluate((row) => document.getElementById(row.getAttribute("aria-describedby"))?.textContent ?? "")
  check(/mm margins$/.test(rowDescription), `3. book view: a row's margins are its description ("${rowDescription}")`)
  const currentRows = await pagesList.locator('[aria-current="true"]').allTextContents()
  check(
    currentRows.length === 1 && currentRows[0].startsWith("Page 3"),
    `3. book view: only the selected row is aria-current (${JSON.stringify(currentRows)})`,
  )
  // The book overview's grid of page previews, in the canvas region.
  const grid = page.locator('[class*="minmax(220px"]')
  const previews = await grid.getByRole("button", { name: /^Page \d+$/ }).all()
  check(previews.length === 8, `3. book view: 8 page previews named "Page N" (found ${previews.length})`)
  const currentPreview = await grid.locator('[aria-current="true"]').getAttribute("aria-label")
  check(currentPreview === "Page 3", `3. book view: the selected preview is aria-current (${currentPreview})`)

  // 1. A page selected (still page 3).
  await expectNames("page selected", inspector, {
    combobox: ["Position"],
    spinbutton: ["Top", "Inner", "Outer", "Bottom"],
  })
  await page.getByRole("tab", { name: "Canvas" }).click()
  await settle(page)

  // 1–2. An image selected; apply a preset and check its pressed state.
  await placePhotoOnFirstPage(page)
  await expectNames("image selected", inspector, {
    combobox: ["Fit"],
    button: ["Full bleed", "Centered", "Two-page spread", "Left half"],
    spinbutton: ["X", "Y", "W", "H"],
  })
  await inspector.getByRole("button", { name: "Centered" }).click()
  await page.waitForTimeout(200)
  const pressed = {}
  for (const name of ["Full bleed", "Centered", "Two-page spread", "Left half"]) {
    pressed[name] = await inspector.getByRole("button", { name }).getAttribute("aria-pressed")
  }
  check(
    pressed.Centered === "true" && Object.entries(pressed).every(([name, value]) => name === "Centered" || value === "false"),
    `2. only the active preset is aria-pressed (${JSON.stringify(pressed)})`,
  )

  // 1. A text box selected.
  await page.keyboard.press("Escape")
  await placeTextOnFirstPage(page)
  await expectNames("text selected", inspector, {
    textbox: ["Text"],
    tab: ["Align left", "Align center", "Align right"],
    combobox: ["Type", "Size", "Font"],
    button: ["Color #18181b"],
    spinbutton: ["Width"],
  })

  check(errors.length === 0, `5. no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "a11y-names-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nAccessible names: PASS" : `\nAccessible names: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
