import JSZip from "jszip"

import type { Asset, Frame } from "@sequence/core"

import { renderExportPages } from "@/lib/export/render-frame"

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not encode page"))
        return
      }
      blob
        .arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject)
    }, "image/png")
  })
}

/**
 * One lossless PNG per page (trim size plus bleed, same as the PDF export),
 * zipped together, blanks for saddle stitch included — for a print shop that wants to run its own imposition
 * software rather than accept a pre-flattened PDF. There's no imposition
 * math in `core/` yet (no signature/press-sheet arrangement), so this
 * sidesteps needing any: it hands over full-resolution flat pages in
 * reading order and lets the print shop's own software do that step, which
 * is how most photobook print shops that accept "flat pages" already expect
 * to receive a job.
 */
export async function buildPngZip(
  frames: readonly Frame[],
  assets: readonly Asset[],
  typeBaseSize: number,
  typeRatio: number,
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  await document.fonts.ready

  const zip = new JSZip()

  // Print order, with any blanks saddle stitch needs (#31).
  let index = 0
  for await (const { canvas, total } of renderExportPages(frames, assets, typeBaseSize, typeRatio)) {
    const pngBytes = await canvasToPngBytes(canvas)
    index += 1
    const pageNumber = String(index).padStart(String(total).length, "0")
    zip.file(`page-${pageNumber}.png`, pngBytes)

    onProgress?.(index, total)
  }

  return zip.generateAsync({ type: "blob" })
}
