import JSZip from "jszip"

import type { Asset, Frame } from "@loupe/core"

import { renderFrameToCanvas } from "@/lib/export/render-frame"

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
 * zipped together — for a print shop that wants to run its own imposition
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

  const ordered = [...frames].sort((a, b) => a.position - b.position)
  const zip = new JSZip()
  const digits = String(ordered.length).length

  for (const [index, frame] of ordered.entries()) {
    const canvas = await renderFrameToCanvas(frame, assets, typeBaseSize, typeRatio)
    const pngBytes = await canvasToPngBytes(canvas)
    const pageNumber = String(index + 1).padStart(digits, "0")
    zip.file(`page-${pageNumber}.png`, pngBytes)

    onProgress?.(index + 1, ordered.length)
  }

  return zip.generateAsync({ type: "blob" })
}
