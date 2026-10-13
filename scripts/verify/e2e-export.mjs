// End-to-end export check: import the fixture photos, set up a book, export a
// PDF through the real Export button, and verify the file with pdf-lib.
//
//   npm run e2e                      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/e2e-export.mjs
//
// The contract this holds the export to:
//   1. The top nav's "Export" button opens the "Export book" dialog; choosing
//      "Print-ready PDF" and confirming downloads a PDF.
//   2. The PDF's page count is a multiple of 4 (saddle stitch) and at least the
//      book's page count. The book is deliberately set up with a count that is
//      NOT a multiple of 4, so this only passes if export pads with blank pages
//      (#31); the added pages must be blank, and the dialog must say
//      "Adds 2 blank pages to reach 12" with a keyboard-reachable explanation.
//   3. Every page is drawn with 3mm bleed and says where to trim (issue #30):
//      MediaBox = BleedBox = page size plus 3mm each side, and an explicit
//      TrimBox of the page size at 3mm offsets.
//   4. The PDF is reader-order pages, not imposed printer's spreads. If export
//      grows an imposed mode, check that mode separately — don't loosen this.
//
// If a payment gate is ever put in front of Export, this needs a test-mode
// bypass rather than an edit to skip the gate here.

import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import {
  dismissIntroduction,
  FIXTURE_PHOTOS,
  importPhotos,
  openApp,
  placePhotoOnFirstPage,
  settle,
  setupBook,
} from "./lib/app.mjs"
import { checkExportedPdf, pageImages } from "./lib/pdf-checks.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const BOOK = { preset: "A5 Portrait", widthMm: 148, heightMm: 210, bleedMm: 3, pageCount: 10 }

const failures = []
const check = (ok, message) => {
  console.log(`${ok ? "✓" : "✗"} ${message}`)
  if (!ok) failures.push(message)
}

const app = await startApp()
const { browser, page, errors } = await openApp(app.url, { acceptDownloads: true })

try {
  await dismissIntroduction(page)
  await importPhotos(page, FIXTURE_PHOTOS)
  console.log(`✓ imported ${FIXTURE_PHOTOS.length} fixture photos`)
  await setupBook(page, BOOK)
  console.log(`✓ set up a ${BOOK.pageCount}-page ${BOOK.preset} book`)
  // A photo on page 1 gives the blank-page check something non-blank to tell apart.
  await settle(page)
  await placePhotoOnFirstPage(page)
  console.log("✓ placed a photo on page 1")

  await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
  const dialog = page.getByRole("dialog", { name: "Export book" })
  await dialog.waitFor()

  // The dialog says what padding will happen, and why on keyboard focus (#31).
  const padded = Math.ceil(BOOK.pageCount / 4) * 4
  const blanks = padded - BOOK.pageCount
  const note = `Adds ${blanks} blank page${blanks === 1 ? "" : "s"} to reach ${padded}`
  check(await dialog.getByText(note).isVisible(), `the dialog says "${note}"`)
  // One real keyboard step onto the info control: it comes right before the
  // first format radio in tab order, so Shift+Tab from that radio lands on
  // it. Cycling Tab around the dialog instead was flaky: the dialog's initial
  // focus already sits on the info button, and Tab can leave the dialog
  // altogether, so where 12 presses ended up varied run to run.
  const info = dialog.getByRole("button", { name: "Why blank pages are added" })
  await dialog.getByRole("radio").first().focus()
  await page.keyboard.press("Shift+Tab")
  const focused = await info.evaluate((button) => document.activeElement === button)
  const tooltip = page.getByText(/sheets folded in half/)
  const tooltipShown = focused && (await tooltip.waitFor({ timeout: 3_000 }).then(() => true, () => false))
  check(
    tooltipShown,
    `keyboard focus (Shift+Tab) reaches the info control and its tooltip explains the padding${focused ? "" : " (never focused)"}`,
  )
  await dialog.getByText("Print-ready PDF").click()
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 })
  await dialog.getByRole("button", { name: "Export", exact: true }).click()
  let download
  try {
    download = await downloadPromise
  } catch {
    throw new Error(
      'The Export dialog produced no download within 60s. If the export flow changed on purpose, ' +
        "update the export step in scripts/verify/e2e-export.mjs.",
    )
  }

  const pdfPath = path.join(await mkdtemp(path.join(os.tmpdir(), "loupe-e2e-")), download.suggestedFilename())
  await download.saveAs(pdfPath)
  console.log(`✓ downloaded ${download.suggestedFilename()} → ${pdfPath}`)
  check(pdfPath.toLowerCase().endsWith(".pdf"), `download has a .pdf filename (${download.suggestedFilename()})`)

  const pdfBytes = await readFile(pdfPath)
  for (const { ok, message } of await checkExportedPdf(pdfBytes, BOOK)) check(ok, message)

  // The padded pages are blank paper and the photo page isn't: decode each
  // page's JPEG in the browser and look for anything darker than paper-white.
  const images = await pageImages(pdfBytes)
  const isBlank = (jpeg) =>
    page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/jpeg;base64,${base64}`
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = 200
      canvas.height = Math.round((200 * image.height) / image.width)
      const ctx = canvas.getContext("2d")
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      for (let i = 0; i < data.length; i += 4) if (Math.min(data[i], data[i + 1], data[i + 2]) < 245) return false
      return true
    }, Buffer.from(jpeg).toString("base64"))
  const added = images.slice(BOOK.pageCount)
  const addedBlank = (await Promise.all(added.map(isBlank))).every(Boolean)
  check(
    added.length === blanks && addedBlank,
    `pages ${BOOK.pageCount + 1}–${padded} are blank paper (${added.length} added)`,
  )
  check(!(await isBlank(images[0])), "page 1, with its photo, is not blank (the blank check can tell)")

  check(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join("; ")}` : ""}`)
} catch (error) {
  failures.push(error.message)
  console.error(`✗ ${error.message}`)
  const shot = path.join(repoRoot, "screenshots", "e2e-failure.png")
  await page.screenshot({ path: shot }).then(
    () => console.error(`  page at failure → ${path.relative(repoRoot, shot)}`),
    () => {},
  )
} finally {
  await browser.close()
  await app.stop()
}

console.log(failures.length === 0 ? "\nE2E export: PASS" : `\nE2E export: FAIL (${failures.length})`)
process.exit(failures.length === 0 ? 0 : 1)
