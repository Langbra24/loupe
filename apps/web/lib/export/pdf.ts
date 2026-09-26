import { PDFDocument } from "pdf-lib"

import type { Asset, Frame } from "@loupe/core"

import { EXPORT_BLEED_MM, renderFrameToCanvas } from "@/lib/export/render-frame"

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
 * A single flattened, print-ready PDF: every frame in reading order,
 * rasterized to `EXPORT_DPI` and embedded as one full-bleed JPEG per page
 * (see the doc comment on `renderFrameToCanvas` for why rasterizing —
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

  const ordered = [...frames].sort((a, b) => a.position - b.position)
  const pdf = await PDFDocument.create()

  for (const [index, frame] of ordered.entries()) {
    const canvas = await renderFrameToCanvas(frame, assets, typeBaseSize, typeRatio)
    const jpegBytes = await canvasToJpegBytes(canvas, 0.92)
    const image = await pdf.embedJpg(jpegBytes)

    const widthPt = mmToPt(frame.pageSize.width + 2 * EXPORT_BLEED_MM)
    const heightPt = mmToPt(frame.pageSize.height + 2 * EXPORT_BLEED_MM)
    const page = pdf.addPage([widthPt, heightPt])
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt })

    onProgress?.(index + 1, ordered.length)
  }

  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: "application/pdf" })
}
