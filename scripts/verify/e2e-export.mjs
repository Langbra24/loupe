// End-to-end export check: import the fixture photos, set up a book, export a
// PDF through the real Export button, and verify the file with pdf-lib.
//
//   npm run e2e                      # builds first
//   LOUPE_URL=http://localhost:3000 node scripts/verify/e2e-export.mjs
//
// The contract this holds the export to:
//   1. Clicking the top nav's "Export" button downloads a PDF.
//   2. The PDF's page count is a multiple of 4 (saddle stitch) and at least the
//      book's page count. The book is deliberately set up with a count that is
//      NOT a multiple of 4, so this only passes if export pads with blank pages.
//   3. Every page's trim size equals the book's page size. The TrimBox is used
//      when present, so an export that includes bleed in the MediaBox still
//      passes; with no TrimBox, pdf-lib falls back to CropBox, then MediaBox.
//   4. The PDF is reader-order pages, not imposed printer's spreads. If export
//      grows an imposed mode, check that mode separately — don't loosen this.
//
// If a payment gate is ever put in front of Export, this needs a test-mode
// bypass rather than an edit to skip the gate here.

import { mkdtemp, readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { dismissIntroduction, FIXTURE_PHOTOS, importPhotos, openApp, setupBook } from "./lib/app.mjs"
import { checkExportedPdf } from "./lib/pdf-checks.mjs"
import { repoRoot, startApp } from "./lib/server.mjs"

const BOOK = { preset: "A5 Portrait", widthMm: 148, heightMm: 210, pageCount: 10 }

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

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 })
  await page.getByRole("banner").getByRole("button", { name: "Export" }).click()
  let download
  try {
    download = await downloadPromise
  } catch {
    throw new Error(
      'Clicking "Export" produced no download within 30s. Either PDF export is not implemented yet, ' +
        "or its trigger changed — if so, update the export step in scripts/verify/e2e-export.mjs.",
    )
  }

  const pdfPath = path.join(await mkdtemp(path.join(os.tmpdir(), "loupe-e2e-")), download.suggestedFilename())
  await download.saveAs(pdfPath)
  console.log(`✓ downloaded ${download.suggestedFilename()} → ${pdfPath}`)
  check(pdfPath.toLowerCase().endsWith(".pdf"), `download has a .pdf filename (${download.suggestedFilename()})`)

  for (const { ok, message } of await checkExportedPdf(await readFile(pdfPath), BOOK)) check(ok, message)

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
