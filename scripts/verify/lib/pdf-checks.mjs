// The assertions e2e-export.mjs makes about an exported PDF, kept separate so
// they can be exercised against synthetic PDFs while the export itself is
// still being built (see pdf-checks.test.mjs).

import { PDFDict, PDFDocument, PDFName } from "pdf-lib"

export const POINTS_PER_MM = 72 / 25.4
/** Half a point (~0.18mm) — absorbs mm→pt rounding, nothing a printer would notice. */
const TOLERANCE_PT = 0.5

/**
 * @param {Uint8Array} bytes the exported PDF
 * @param {{ widthMm: number, heightMm: number, bleedMm: number, pageCount: number }} book
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

  const bleed = book.bleedMm * POINTS_PER_MM
  const trim = { width: book.widthMm * POINTS_PER_MM, height: book.heightMm * POINTS_PER_MM }
  const media = { x: 0, y: 0, width: trim.width + 2 * bleed, height: trim.height + 2 * bleed }
  const trimAt = { x: bleed, y: bleed, ...trim }
  const sizeMm = `${book.widthMm + 2 * book.bleedMm}×${book.heightMm + 2 * book.bleedMm}mm`

  results.push(
    everyPage(pages, (page) => boxMismatch(page.getMediaBox(), media), {
      ok: `every page's MediaBox is ${sizeMm} (trim plus ${book.bleedMm}mm bleed)`,
      wrong: `MediaBox wrong`,
      expected: sizeMm,
    }),
  )
  // pdf-lib's getters fall back to the MediaBox when a box is missing, which
  // would let a file with no TrimBox or BleedBox pass; so presence is checked first.
  results.push(
    everyPage(pages, (page) => (hasBox(page, "TrimBox") ? boxMismatch(page.getTrimBox(), trimAt) : "no TrimBox"), {
      ok: `every page's TrimBox is ${book.widthMm}×${book.heightMm}mm at ${book.bleedMm}mm offsets`,
      wrong: `TrimBox wrong`,
      expected: `${book.widthMm}×${book.heightMm}mm at ${book.bleedMm}mm`,
    }),
  )
  results.push(
    everyPage(pages, (page) => (hasBox(page, "BleedBox") ? boxMismatch(page.getBleedBox(), media) : "no BleedBox"), {
      ok: "every page's BleedBox equals its MediaBox",
      wrong: `BleedBox wrong`,
      expected: sizeMm,
    }),
  )

  return results
}

function toMm(points) {
  return (points / POINTS_PER_MM).toFixed(1)
}

function hasBox(page, name) {
  return page.node.get(PDFName.of(name)) !== undefined
}

/** `null` when `box` matches `want` within tolerance, else a description of it. */
function boxMismatch(box, want) {
  const off = ["x", "y", "width", "height"].some((key) => Math.abs(box[key] - want[key]) > TOLERANCE_PT)
  return off ? `${toMm(box.width)}×${toMm(box.height)}mm at ${toMm(box.x)},${toMm(box.y)}mm` : null
}

function everyPage(pages, problemOf, messages) {
  const wrong = pages.map((page, index) => ({ index, problem: problemOf(page) })).filter(({ problem }) => problem)
  return wrong.length === 0
    ? { ok: true, message: messages.ok }
    : {
        ok: false,
        message:
          `${messages.wrong} on ${wrong.length} page(s), first is page ${wrong[0].index + 1}: ` +
          `${wrong[0].problem}, expected ${messages.expected}`,
      }
}

/**
 * The JPEG each page of the export draws (one full-page image per page; see
 * `buildPrintPdf`), so a verifier can decode it and look at the pixels.
 * @returns {Promise<Uint8Array[]>}
 */
export async function pageImages(bytes) {
  const pdf = await PDFDocument.load(bytes)
  return pdf.getPages().map((page) => {
    const xobjects = page.node.Resources().lookup(PDFName.of("XObject"), PDFDict)
    return pdf.context.lookup(xobjects.values()[0]).contents
  })
}
