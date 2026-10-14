import { PDFDocument } from "pdf-lib"

import type { Asset, Frame } from "@sequence/core"

import { EXPORT_BLEED_MM, renderExportPages } from "@/lib/export/render-frame"

/** 1mm in PDF points (1pt = 1/72in). */
function mmToPt(mm: number): number {
  return (mm / 25.4) * 72
}

function canvasToJpegBytes(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not encode page"))
          return
        }
        blob
          .arrayBuffer()
          .then((buffer) => resolve(new Uint8Array(buffer)))
          .catch(reject)
      },
      "image/jpeg",
      quality,
    )
  })
}

/**
 * A single flattened, print-ready PDF: every frame in reading order, plus
 * any blank pages saddle stitch needs (`padForSaddleStitch` in core),
 * rasterized to `EXPORT_DPI` and embedded as one full-bleed JPEG per page.
 * Each page's MediaBox and BleedBox are trim plus `EXPORT_BLEED_MM` on every
 * edge, and its TrimBox is the page size inset by that bleed. (See the doc
 * comment on `renderFrameToCanvas` for why rasterizing —
 * rather than emitting live vector text — is the pragmatic choice here: no
 * font subsetting/embedding pipeline exists, and rasterizing guarantees the
 * PDF matches what the user actually designed, pixel for pixel).
 *
 * Deliberately not a PDF/X-1a or PDF/X-4: both require an embedded CMYK
 * ICC output-intent profile, and CLAUDE.md/the build brief already scope
 * full ICC color management as a stretch goal past v1 (this ships plain
 * sRGB-tagged, same as the brief's tech-stack note). Calling this PDF/X
 * would be a false compliance claim; it's labeled "Print-ready PDF" in the
 * export dialog instead.
 *
 * JPEG at quality 0.92 trades a small amount of fidelity for file size —
 * most pages here are photograph-dominated, where that's imperceptible, and
 * a many-page book as uncompressed PNG pages would produce an unreasonably
 * large PDF.
 */
export async function buildPrintPdf(
  frames: readonly Frame[],
  assets: readonly Asset[],
  typeBaseSize: number,
  typeRatio: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  await document.fonts.ready

  const pdf = await PDFDocument.create()

  // Print order, with any blanks saddle stitch needs (#31).
  let index = 0
  for await (const { canvas, pageSize, total } of renderExportPages(frames, assets, typeBaseSize, typeRatio)) {
    const jpegBytes = await canvasToJpegBytes(canvas, 0.92)
    const image = await pdf.embedJpg(jpegBytes)

    const bleedPt = mmToPt(EXPORT_BLEED_MM)
    const trimWidthPt = mmToPt(pageSize.width)
    const trimHeightPt = mmToPt(pageSize.height)
    const widthPt = trimWidthPt + 2 * bleedPt
    const heightPt = trimHeightPt + 2 * bleedPt
    const page = pdf.addPage([widthPt, heightPt])
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt })
    // The page is drawn with bleed, so record where it trims (issue #30);
    // without a TrimBox a print service may print the whole 6mm-larger page.
    page.setBleedBox(0, 0, widthPt, heightPt)
    page.setTrimBox(bleedPt, bleedPt, trimWidthPt, trimHeightPt)

    index += 1
    onProgress?.(index, total)
  }

  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: "application/pdf" })
}
