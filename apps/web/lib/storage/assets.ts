import { thumbnailTarget, type Asset } from "@loupe/core"

import { getDb, isQuotaError, requestPersistentStorage } from "@/lib/storage/db"

/** Long edge of a canvas thumbnail, in pixels. Large enough to judge an image
 *  at working zoom, small enough that a hundred of them stay responsive. */
const THUMBNAIL_MAX_EDGE = 600

export interface ImportFailure {
  fileName: string
  reason: string
}

export interface ImportResult {
  assets: Asset[]
  failures: ImportFailure[]
}

/**
 * Import photographs from disk into local storage.
 *
 * Sequential rather than parallel: decoding and re-drawing a forty-file drop
 * all at once starves the main thread and presents a frozen UI. One at a time
 * with progress keeps the window responsive and lets a partial batch survive.
 */
export async function importFiles(
  files: readonly File[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult> {
  // Ask before writing anything, so the first photographs a user brings in are
  // already covered. Fire-and-forget: a denial is a browser policy they cannot
  // change, and blocking an import on it would be worse than degrading quietly.
  void ensurePersistenceRequested()

  const assets: Asset[] = []
  const failures: ImportFailure[] = []

  for (const [index, file] of files.entries()) {
    try {
      assets.push(await importOne(file))
    } catch (error) {
      failures.push({ fileName: file.name, reason: describeFailure(error) })
    }
    onProgress?.(index + 1, files.length)
  }

  return { assets, failures }
}

/** Requested once per session — the browser's answer does not change mid-run. */
let persistenceRequested: Promise<boolean> | null = null

function ensurePersistenceRequested(): Promise<boolean> {
  persistenceRequested ??= requestPersistentStorage()
  return persistenceRequested
}

async function importOne(file: File): Promise<Asset> {
  // Decode via createImageBitmap — universally supported. The resize *options*
  // are not (Safari implements none of them), so the downscale happens on a
  // canvas below rather than here.
  const bitmap = await createImageBitmap(file)

  try {
    const id = newAssetId()
    const target = thumbnailTarget(bitmap.width, bitmap.height, THUMBNAIL_MAX_EDGE)
    const thumbnail = await drawToBlob(bitmap, target.width, target.height)

    const db = await getDb()
    const tx = db.transaction(["originals", "thumbnails"], "readwrite")
    await Promise.all([
      tx.objectStore("originals").put(file, id),
      tx.objectStore("thumbnails").put(thumbnail, id),
      tx.done,
    ])

    return {
      id,
      name: file.name,
      width: bitmap.width,
      height: bitmap.height,
      importedAt: Date.now(),
    }
  } finally {
    bitmap.close()
  }
}

async function drawToBlob(
  bitmap: ImageBitmap,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext("2d")
  if (!context) throw new Error("Could not get a 2D drawing context")

  context.drawImage(bitmap, 0, 0, width, height)

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode thumbnail"))),
      "image/jpeg",
      0.82,
    )
  })
}

function describeFailure(error: unknown): string {
  if (isQuotaError(error)) return "Out of local storage space"
  if (error instanceof Error && /decode|image/i.test(error.message)) {
    return "Not a readable image"
  }
  return error instanceof Error ? error.message : "Could not import"
}

/* ------------------------------------------------------------------ */
/* Blob URL lifecycle                                                   */
/* ------------------------------------------------------------------ */

/**
 * Object URLs are process-global and leak until revoked, so creation and
 * revocation live here rather than being scattered across components. This is
 * the likeliest memory failure at session scale.
 */
const thumbnailUrls = new Map<string, string>()

/** Resolve an asset's thumbnail to a URL, caching so repeated renders of the
 *  same photograph share one object URL. */
export async function thumbnailUrl(assetId: string): Promise<string | null> {
  const cached = thumbnailUrls.get(assetId)
  if (cached) return cached

  const db = await getDb()
  const blob = await db.get("thumbnails", assetId)
  if (!blob) return null

  const url = URL.createObjectURL(blob)
  thumbnailUrls.set(assetId, url)
  return url
}

export function revokeThumbnailUrl(assetId: string): void {
  const url = thumbnailUrls.get(assetId)
  if (!url) return

  URL.revokeObjectURL(url)
  thumbnailUrls.delete(assetId)
}

export function revokeAllThumbnailUrls(): void {
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url)
  thumbnailUrls.clear()
}

/** Full-resolution original, kept for Design work and export. Not cached — it
 *  is large and read rarely, so holding a URL open would waste memory. */
export async function originalBlob(assetId: string): Promise<Blob | null> {
  const db = await getDb()
  return (await db.get("originals", assetId)) ?? null
}

export async function deleteAsset(assetId: string): Promise<void> {
  revokeThumbnailUrl(assetId)

  const db = await getDb()
  const tx = db.transaction(["originals", "thumbnails"], "readwrite")
  await Promise.all([
    tx.objectStore("originals").delete(assetId),
    tx.objectStore("thumbnails").delete(assetId),
    tx.done,
  ])
}

function newAssetId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `asset-${crypto.randomUUID()}`
  }
  return `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
