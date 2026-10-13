import assert from "node:assert/strict"
import { test } from "node:test"
import { PDFDocument } from "pdf-lib"

import { checkExportedPdf, POINTS_PER_MM } from "./pdf-checks.mjs"

const A5 = { widthMm: 148, heightMm: 210, pageCount: 10 }

async function makePdf({ pages, widthMm, heightMm, bleedMm = 0 }) {
  const pdf = await PDFDocument.create()
  const bleed = bleedMm * POINTS_PER_MM
  const trim = { width: widthMm * POINTS_PER_MM, height: heightMm * POINTS_PER_MM }
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([trim.width + 2 * bleed, trim.height + 2 * bleed])
    if (bleedMm > 0) page.setTrimBox(bleed, bleed, trim.width, trim.height)
  }
  return pdf.save()
}

const failed = (results) => results.filter((result) => !result.ok).map((result) => result.message)

test("passes a padded A5 export with bleed and a TrimBox", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, widthMm: 148, heightMm: 210, bleedMm: 3 }), A5)
  assert.deepEqual(failed(results), [])
})

test("passes a trim-sized MediaBox with no TrimBox", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, widthMm: 148, heightMm: 210 }), A5)
  assert.deepEqual(failed(results), [])
})

test("fails an unpadded page count", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 10, widthMm: 148, heightMm: 210 }), A5)
  assert.deepEqual(failed(results), ["page count 10 is a multiple of 4"])
})

test("fails a page count below the book's", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 8, widthMm: 148, heightMm: 210 }), A5)
  assert.deepEqual(failed(results), ["page count 8 ≥ the book's 10 pages"])
})

test("fails the wrong trim size", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, widthMm: 210, heightMm: 297 }), A5)
  assert.equal(failed(results).length, 1)
  assert.match(failed(results)[0], /trim size wrong on 12 page\(s\).*210\.0×297\.0mm, expected 148×210mm/)
})

test("fails bleed-sized pages that carry no TrimBox", async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([154 * POINTS_PER_MM, 216 * POINTS_PER_MM])
  for (let i = 0; i < 11; i++) pdf.addPage([148 * POINTS_PER_MM, 210 * POINTS_PER_MM])
  const results = await checkExportedPdf(await pdf.save(), A5)
  assert.match(failed(results)[0], /trim size wrong on 1 page\(s\), first is page 1/)
})
