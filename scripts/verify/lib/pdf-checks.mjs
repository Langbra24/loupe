// The assertions e2e-export.mjs makes about an exported PDF, kept separate so
// they can be exercised against synthetic PDFs while the export itself is
// still being built (see pdf-checks.test.mjs).

import { PDFDocument } from "pdf-lib"

export const POINTS_PER_MM = 72 / 25.4
/** Half a point (~0.18mm) — absorbs mm→pt rounding, nothing a printer would notice. */
const TOLERANCE_PT = 0.5

/**
 * @param {Uint8Array} bytes the exported PDF
 * @param {{ widthMm: number, heightMm: number, pageCount: number }} book
 * @returns {Promise<{ ok: boolean, message: string }[]>}
 */
export async function checkExportedPdf(bytes, book) {
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages()
  const results = []

  results.push({
    ok: pages.length % 4 === 0,
    message: `page count ${pages.length} is a multiple of 4`,
  })
  results.push({
    ok: pages.length >= book.pageCount,
    message: `page count ${pages.length} ≥ the book's ${book.pageCount} pages`,
  })

  const expected = { width: book.widthMm * POINTS_PER_MM, height: book.heightMm * POINTS_PER_MM }
  // getTrimBox() falls back to CropBox, then MediaBox, when no TrimBox is set.
  const wrong = pages
    .map((page, index) => ({ index, box: page.getTrimBox() }))
    .filter(
      ({ box }) =>
        Math.abs(box.width - expected.width) > TOLERANCE_PT ||
        Math.abs(box.height - expected.height) > TOLERANCE_PT,
    )
  results.push(
    wrong.length === 0
      ? {
          ok: true,
          message: `every page trims to ${book.widthMm}×${book.heightMm}mm (${expected.width.toFixed(1)}×${expected.height.toFixed(1)}pt)`,
        }
      : {
          ok: false,
          message:
            `trim size wrong on ${wrong.length} page(s), first is page ${wrong[0].index + 1}: ` +
            `${toMm(wrong[0].box.width)}×${toMm(wrong[0].box.height)}mm, expected ${book.widthMm}×${book.heightMm}mm`,
        },
  )

  return results
}

function toMm(points) {
  return (points / POINTS_PER_MM).toFixed(1)
}
