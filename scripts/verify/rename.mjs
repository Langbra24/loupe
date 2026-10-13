// Book-name check: rename the book from the top-left field through the real
// UI, and hold it to the contract below.
//
//   npm run verify:rename            # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/rename.mjs
//
// The contract:
//   1. Clicking the name swaps in a focused text field. Escape cancels the
//      edit; an empty or whitespace-only name is refused and the old name kept;
//      Enter and blur both commit.
//   2. Typing inside the field never reaches the canvas shortcuts: a `T` lands
//      in the field as a character, and the text tool stays unarmed.
//   3. The committed name survives an immediate reload (IndexedDB).
//   4. Export downloads `<slug-of-name>.pdf`.

import path from "node:path"

import { dismissIntroduction, importPhotos, openApp, setupBook } from "./lib/app.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const DEFAULT_NAME = "Untitled book"
const NEW_NAME = "Field Notes Vol. 2"
const EXPECTED_FILENAME = "field-notes-vol-2.pdf"

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url, { acceptDownloads: true })

const panel = page.getByRole("complementary").first()
const nameButton = (name) => panel.getByRole("button", { name, exact: true })
const nameField = panel.getByRole("textbox", { name: "Book name" })

/** What the canvas would show if `T` had armed the text tool. */
const canvasCursor = async () => {
  const canvas = page.locator("canvas.upper-canvas").first()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  return canvas.evaluate((element) => element.style.cursor)
}

/** Text elements in the persisted project record, read straight from IndexedDB. */
const storedProject = () =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("loupe")
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const get = request.result.transaction("project").objectStore("project").getAll()
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            const project = get.result[0]
            resolve({
              name: project?.name,
              textElements: (project?.frames ?? []).flatMap((frame) => frame.elements).filter((e) => e.kind === "text")
                .length,
            })
          }
        }
      }),
  )

try {
  await dismissIntroduction(page)
  await importPhotos(page)
  await setupBook(page, { preset: "A5 Portrait", pageCount: 8 })

  // 1. Click → focused field, the whole name selected.
  await nameButton(DEFAULT_NAME).click()
  await nameField.waitFor()
  const selected = await nameField.evaluate(
    (input) => document.activeElement === input && input.selectionStart === 0 && input.selectionEnd === input.value.length,
  )
  check(selected, "clicking the name opens a focused field with the name selected")

  // Escape cancels.
  await page.keyboard.type("Discard me")
  await page.keyboard.press("Escape")
  check(await nameButton(DEFAULT_NAME).isVisible(), "Escape cancels the edit and keeps the old name")

  // Empty and whitespace-only names are refused.
  for (const [label, value] of [
    ["an empty", ""],
    ["a whitespace-only", "   "],
  ]) {
    await nameButton(DEFAULT_NAME).click()
    await nameField.fill(value)
    await page.keyboard.press("Enter")
    check(await nameButton(DEFAULT_NAME).isVisible(), `${label} name is refused and the old name kept`)
  }

  // 2. `T` inside the field is a character, not the text-tool shortcut.
  const cursorBefore = await canvasCursor()
  await nameButton(DEFAULT_NAME).click()
  await nameField.press("End")
  await page.keyboard.press("T")
  check((await nameField.inputValue()) === `${DEFAULT_NAME}T`, "typing T inside the field types a T")
  check((await canvasCursor()) === cursorBefore, `typing T inside the field leaves the text tool unarmed (canvas cursor "${cursorBefore}")`)
  await page.keyboard.press("Escape")

  // Enter commits.
  await nameButton(DEFAULT_NAME).click()
  await nameField.fill(NEW_NAME)
  await page.keyboard.press("Enter")
  check(await nameButton(NEW_NAME).isVisible(), `Enter commits the new name "${NEW_NAME}"`)
  check(
    await nameButton(NEW_NAME).evaluate((button) => document.activeElement === button),
    "focus returns to the name after Enter",
  )

  // Blur commits too: rename away and back, committing each by clicking off.
  await nameButton(NEW_NAME).click()
  await nameField.fill("Blur test")
  await page.getByRole("banner").click({ position: { x: 600, y: 10 } })
  check(await nameButton("Blur test").isVisible(), "blur commits the edit")
  await nameButton("Blur test").click()
  await nameField.fill(NEW_NAME)
  await page.keyboard.press("Enter")

  // 3. An immediate reload keeps it — no waiting out the save debounce.
  await page.reload({ waitUntil: "networkidle" })
  await page.getByRole("banner").getByText("Loupe").waitFor()
  const persisted = await nameButton(NEW_NAME)
    .waitFor({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false)
  check(persisted, `"${NEW_NAME}" survives a reload`)
  const stored = await storedProject()
  check(stored.name === NEW_NAME, `IndexedDB holds the new name (${JSON.stringify(stored.name)})`)
  check(stored.textElements === 0, `no text element was created along the way (${stored.textElements} found)`)

  // 4. Export filename follows the name.
  await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
  const dialog = page.getByRole("dialog", { name: "Export book" })
  await dialog.waitFor()
  await dialog.getByText("Print-ready PDF").click()
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 })
  await dialog.getByRole("button", { name: "Export", exact: true }).click()
  const download = await downloadPromise
  check(
    download.suggestedFilename() === EXPECTED_FILENAME,
    `export downloads ${EXPECTED_FILENAME} (got ${download.suggestedFilename()})`,
  )

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "rename-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nRename: PASS" : `\nRename: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
