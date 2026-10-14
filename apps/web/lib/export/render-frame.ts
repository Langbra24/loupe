import {
  padForSaddleStitch,
  resolveTextSize,
  type Asset,
  type Frame,
  type ImageElement,
  type TextElement,
} from "@sequence/core"

import { BLEED_MM, DEFAULT_TEXT_COLOR } from "@/components/shell/inspector-panel"
import { resolveTextFontFamily } from "@/lib/fonts"
import { originalBlob } from "@/lib/storage/assets"

/**
 * Print export's own rendering path, deliberately separate from the
 * interactive Fabric canvas (`use-fabric-canvas.ts`). Export needs full-
 * resolution originals at a fixed physical DPI regardless of what's on
 * screen or how the pasteboard happens to be laid out, so it reasons in
 * millimetres/points from `Frame.pageSize` directly rather than reusing the
 * canvas's scene-unit grid (`frame-grid.ts`), which only exists to place
 * frames on the light table and has no physical size of its own.
 *
 * The fit math (`fitImageBox`) and text defaults (font resolution, ink
 * black) intentionally mirror `use-fabric-canvas.ts`'s `imageFitTransform`
 * and text creation so export matches what the user sees in the app —
 * including `'cover'`'s known stretch-not-crop behavior (see that file's
 * doc comment); export isn't the place to fix that.
 */

/** Standard print resolution. Fixed rather than user-configurable — one
 *  fewer decision in the export dialog, and 300 is the number every print
 *  shop expects without being asked. */
export const EXPORT_DPI = 300

/** Matches `BLEED_MM` (inspector-panel.tsx) — the same 3mm every full-bleed
 *  image preset already assumes. Rendered pages are trim size plus this
 *  margin on every edge, so a full-bleed image's box (which can legitimately
 *  extend past 0..1 — see `presetImageBox` in core) prints all the way to
 *  the bleed edge instead of being clipped at the trim line. */
export const EXPORT_BLEED_MM = BLEED_MM

function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}

/** Fabric's default `Textbox` line height — not exposed as a constant
 *  anywhere in this codebase (the canvas never sets `lineHeight` explicitly,
 *  so it takes Fabric's built-in default), reproduced here so exported text
 *  wraps at roughly the same density as what's on screen. */
const TEXTBOX_LINE_HEIGHT = 1.16

/**
 * Render one frame (a book page) to an off-screen canvas at `EXPORT_DPI`,
 * trim size plus `EXPORT_BLEED_MM` bleed on every edge.
 *
 * Callers must await `document.fonts.ready` once, before rendering any
 * frame — canvas 2D text drawing does not itself wait for a web font to
 * finish loading the way DOM text does, so drawing before that resolves
 * would silently fall back to a system font for the first render.
 */
export async function renderFrameToCanvas(
  frame: Frame,
  assets: readonly Asset[],
  typeBaseSize: number,
  typeRatio: number,
): Promise<HTMLCanvasElement> {
  const pxPerMm = EXPORT_DPI / 25.4
  const widthPx = Math.round(mmToPx(frame.pageSize.width + 2 * EXPORT_BLEED_MM, EXPORT_DPI))
  const heightPx = Math.round(mmToPx(frame.pageSize.height + 2 * EXPORT_BLEED_MM, EXPORT_DPI))

  const canvas = document.createElement("canvas")
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not get a 2D drawing context")

  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, widthPx, heightPx)

  const assetById = new Map(assets.map((asset) => [asset.id, asset]))

  for (const element of frame.elements) {
    const absLeftPx = (EXPORT_BLEED_MM + element.frame.x * frame.pageSize.width) * pxPerMm
    const absTopPx = (EXPORT_BLEED_MM + element.frame.y * frame.pageSize.height) * pxPerMm
    const absWidthPx = element.frame.width * frame.pageSize.width * pxPerMm
    const absHeightPx = element.frame.height * frame.pageSize.height * pxPerMm

    if (element.kind === "image") {
      await drawImageElement(ctx, element, assetById.get(element.assetId), absLeftPx, absTopPx, absWidthPx, absHeightPx)
    } else {
      drawTextElement(ctx, element, typeBaseSize, typeRatio, absLeftPx, absTopPx, absWidthPx)
    }
  }

  return canvas
}

/** A blank page for binding padding (`padForSaddleStitch`): paper-white at
 *  `pageSize` plus the same bleed as every rendered page. */
export function renderBlankPage(pageSize: { width: number; height: number }): HTMLCanvasElement {
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(mmToPx(pageSize.width + 2 * EXPORT_BLEED_MM, EXPORT_DPI))
  canvas.height = Math.round(mmToPx(pageSize.height + 2 * EXPORT_BLEED_MM, EXPORT_DPI))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Could not get a 2D drawing context")
  ctx.fillStyle = "#ffffff"
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  return canvas
}

/** Renders each page of the exported book in print order, blanks included,
 *  handing back the canvas and the trim size it was drawn at. A blank takes
 *  the size of the page before it. */
export async function* renderExportPages(
  frames: readonly Frame[],
  assets: readonly Asset[],
  typeBaseSize: number,
  typeRatio: number,
): AsyncGenerator<{ canvas: HTMLCanvasElement; pageSize: { width: number; height: number }; total: number }> {
  const pages = padForSaddleStitch(frames)
  let pageSize = pages.find((page) => page.kind === "page")?.frame.pageSize
  for (const page of pages) {
    if (page.kind === "page") {
      pageSize = page.frame.pageSize
      yield {
        canvas: await renderFrameToCanvas(page.frame, assets, typeBaseSize, typeRatio),
        pageSize,
        total: pages.length,
      }
    } else if (pageSize) {
      yield { canvas: renderBlankPage(pageSize), pageSize, total: pages.length }
    }
  }
}

async function drawImageElement(
  ctx: CanvasRenderingContext2D,
  element: ImageElement,
  asset: Asset | undefined,
  absLeftPx: number,
  absTopPx: number,
  absWidthPx: number,
  absHeightPx: number,
): Promise<void> {
  if (!asset) return

  const blob = await originalBlob(element.assetId)
  if (!blob) return

  const bitmap = await createImageBitmap(blob)
  try {
    const box = fitImageBox(element.fit, bitmap.width, bitmap.height, absLeftPx, absTopPx, absWidthPx, absHeightPx)
    ctx.drawImage(bitmap, box.left, box.top, box.width, box.height)
  } finally {
    bitmap.close()
  }
}

/** Mirrors `imageFitTransform` in `use-fabric-canvas.ts`: `'contain'` scales
 *  uniformly and centers within the box; `'cover'` (and the legacy-undefined
 *  default) stretches independently to exactly fill it. See that function's
 *  doc comment for why `'cover'` isn't a true crop. */
function fitImageBox(
  fit: "cover" | "contain" | undefined,
  naturalWidth: number,
  naturalHeight: number,
  absLeft: number,
  absTop: number,
  absWidth: number,
  absHeight: number,
): { left: number; top: number; width: number; height: number } {
  if (fit === "contain" && naturalWidth > 0 && naturalHeight > 0) {
    const scale = Math.min(absWidth / naturalWidth, absHeight / naturalHeight)
    const width = naturalWidth * scale
    const height = naturalHeight * scale
    return { left: absLeft + (absWidth - width) / 2, top: absTop + (absHeight - height) / 2, width, height }
  }

  return { left: absLeft, top: absTop, width: absWidth, height: absHeight }
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  element: TextElement,
  typeBaseSize: number,
  typeRatio: number,
  absLeftPx: number,
  absTopPx: number,
  absWidthPx: number,
): void {
  const fontSizePt = resolveTextSize(element.role, element.fontSize, typeBaseSize, typeRatio)
  const fontSizePx = (fontSizePt / 72) * EXPORT_DPI
  const fontFamily = resolveTextFontFamily(element.fontFamily)

  ctx.font = `${fontSizePx}px ${fontFamily}`
  ctx.fillStyle = element.color ?? DEFAULT_TEXT_COLOR
  ctx.textBaseline = "alphabetic"

  const anchorX =
    element.align === "center" ? absLeftPx + absWidthPx / 2 : element.align === "right" ? absLeftPx + absWidthPx : absLeftPx
  ctx.textAlign = element.align

  const lineHeightPx = fontSizePx * TEXTBOX_LINE_HEIGHT
  const lines = wrapText(ctx, element.content, absWidthPx)

  // Alphabetic baseline needs the first line pushed down by roughly the
  // font's ascent — `fontSizePx` itself is a close enough stand-in for that
  // across the OFL serif/sans faces this app ships (see lib/fonts.ts).
  let baselineY = absTopPx + fontSizePx
  for (const line of lines) {
    ctx.fillText(line, anchorX, baselineY)
    baselineY += lineHeightPx
  }
}

/** Greedy word-wrap against a pixel width, honoring explicit newlines as
 *  forced paragraph breaks. Approximate rather than Fabric-exact — Fabric's
 *  own wrapping accounts for per-glyph kerning this doesn't — but close
 *  enough for a rasterized export at 300 DPI. */
function wrapText(ctx: CanvasRenderingContext2D, content: string, maxWidthPx: number): string[] {
  const lines: string[] = []

  for (const paragraph of content.split("\n")) {
    const words = paragraph.split(" ")
    let current = ""

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (current && ctx.measureText(candidate).width > maxWidthPx) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    lines.push(current)
  }

  return lines
}
