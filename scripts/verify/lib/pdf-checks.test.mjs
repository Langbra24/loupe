import assert from "node:assert/strict"
import { test } from "node:test"
import { PDFDocument } from "pdf-lib"

import { checkExportedPdf, POINTS_PER_MM } from "./pdf-checks.mjs"

const A5 = { widthMm: 148, heightMm: 210, bleedMm: 3, pageCount: 10 }

/** A synthetic export: `pages` pages of trim plus `bleedMm`, with whichever boxes are asked for. */
async function makePdf({
  pages,
  widthMm = 148,
  heightMm = 210,
  bleedMm = 3,
  trimBox = true,
  bleedBox = true,
  trimOffsetMm = bleedMm,
}) {
  const pdf = await PDFDocument.create()
  const bleed = bleedMm * POINTS_PER_MM
  const offset = trimOffsetMm * POINTS_PER_MM
  const trim = { width: widthMm * POINTS_PER_MM, height: heightMm * POINTS_PER_MM }
  for (let i = 0; i < pages; i++) {
    const page = pdf.addPage([trim.width + 2 * bleed, trim.height + 2 * bleed])
    if (trimBox) page.setTrimBox(offset, offset, trim.width, trim.height)
    if (bleedBox) page.setBleedBox(0, 0, trim.width + 2 * bleed, trim.height + 2 * bleed)
  }
  return pdf.save()
}

const failed = (results) => results.filter((result) => !result.ok).map((result) => result.message)

test("passes a padded A5 export with 3mm bleed, a TrimBox and a BleedBox", async () => {
  assert.deepEqual(failed(await checkExportedPdf(await makePdf({ pages: 12 }), A5)), [])
})

test("fails an unpadded page count", async () => {
  assert.deepEqual(failed(await checkExportedPdf(await makePdf({ pages: 10 }), A5)), [
    "page count 10 is a multiple of 4",
  ])
})

test("fails a page count below the book's", async () => {
  assert.deepEqual(failed(await checkExportedPdf(await makePdf({ pages: 8 }), A5)), [
    "page count 8 ≥ the book's 10 pages",
  ])
})

test("fails trim-size pages with no bleed in the MediaBox", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, bleedMm: 0, trimOffsetMm: 0 }), A5)
  assert.match(failed(results)[0], /^MediaBox wrong on 12 page\(s\).*148\.0×210\.0mm.*expected 154×216mm/)
})

test("fails a missing TrimBox, even though pdf-lib would fall back to the MediaBox", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, trimBox: false }), A5)
  assert.deepEqual(failed(results), ["TrimBox wrong on 12 page(s), first is page 1: no TrimBox, expected 148×210mm at 3mm"])
})

test("fails a TrimBox of the right size at the wrong offset", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, trimOffsetMm: 0 }), A5)
  assert.match(failed(results)[0], /^TrimBox wrong on 12 page\(s\).*at 0\.0,0\.0mm/)
})

test("fails a missing BleedBox", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, bleedBox: false }), A5)
  assert.deepEqual(failed(results), ["BleedBox wrong on 12 page(s), first is page 1: no BleedBox, expected 154×216mm"])
})

test("fails the wrong trim size", async () => {
  const results = await checkExportedPdf(await makePdf({ pages: 12, widthMm: 210, heightMm: 297 }), A5)
  assert.equal(failed(results).length, 3)
})
