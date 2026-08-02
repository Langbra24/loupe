import { createEmptyProject, type Project } from "@loupe/core"

import { getDb, isQuotaError, PROJECT_KEY } from "@/lib/storage/db"

/** Long enough to collapse a drag's worth of position updates, short enough
 *  that an ordinary pause between gestures commits the work. */
const SAVE_DEBOUNCE_MS = 800

let pending: Project | null = null
let timer: ReturnType<typeof setTimeout> | null = null

/**
 * Write the project immediately.
 *
 * Used after an import commits its blobs. The project record holds the asset
 * metadata that addresses those blobs, so a tab closed inside the debounce
 * window would otherwise lose every imported photograph while its pixels stayed
 * behind consuming quota.
 */
export async function saveProject(project: Project): Promise<void> {
  cancelPending()

  try {
    const db = await getDb()
    await db.put("project", project, PROJECT_KEY)
  } catch (error) {
    if (isQuotaError(error)) {
      throw new Error("Out of local storage space — the project could not be saved")
    }
    throw error
  }
}

/**
 * Write the project after a quiet period.
 *
 * Dragging on the canvas produces a position update per frame; committing each
 * one to IndexedDB would be the wrong trade. Only placement and edit mutations
 * come through here — anything that creates or destroys a blob saves
 * immediately via `saveProject`.
 */
export function saveProjectDebounced(project: Project): void {
  pending = project
  if (timer) clearTimeout(timer)

  timer = setTimeout(() => {
    timer = null
    const snapshot = pending
    pending = null
    if (snapshot) void saveProject(snapshot).catch(() => undefined)
  }, SAVE_DEBOUNCE_MS)
}

/** Commit any debounced write now. Registered on `pagehide` so closing the tab
 *  mid-arrangement does not discard the last gesture. */
export function flushPendingSave(): void {
  if (!pending) return

  const snapshot = pending
  cancelPending()
  void saveProject(snapshot).catch(() => undefined)
}

function cancelPending(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pending = null
}

/**
 * Load the project, then reconcile storage against it.
 *
 * A crash or a tab closed mid-import can leave blobs no asset record
 * references. They are invisible to the user and would consume quota forever,
 * so loading is where they get collected.
 */
export async function loadProject(): Promise<Project> {
  const db = await getDb()
  const stored = await db.get("project", PROJECT_KEY)
  const project = stored ?? createEmptyProject()

  await deleteOrphanedBlobs(project)

  return project
}

async function deleteOrphanedBlobs(project: Project): Promise<void> {
  const db = await getDb()
  const known = new Set(project.assets.map((asset) => asset.id))

  const tx = db.transaction(["originals", "thumbnails"], "readwrite")
  const originals = tx.objectStore("originals")
  const thumbnails = tx.objectStore("thumbnails")

  const [originalKeys, thumbnailKeys] = await Promise.all([
    originals.getAllKeys(),
    thumbnails.getAllKeys(),
  ])

  for (const key of originalKeys) {
    if (!known.has(key)) void originals.delete(key)
  }
  for (const key of thumbnailKeys) {
    if (!known.has(key)) void thumbnails.delete(key)
  }

  await tx.done
}

/** Register the tab-close flush. Returns a teardown for React effects. */
export function registerSaveFlush(): () => void {
  if (typeof window === "undefined") return () => undefined

  const handler = () => flushPendingSave()
  window.addEventListener("pagehide", handler)

  return () => window.removeEventListener("pagehide", handler)
}
