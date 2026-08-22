import {
  createEmptyProject,
  migrateProject,
  type LegacyProject,
  type MigrationFailureReason,
  type Project,
} from "@loupe/core"

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

export interface LoadProjectResult {
  project: Project
  /** Set when a stored pre-frame project failed to migrate. The returned
   *  `project` is the raw stored record in that case — unmigrated and never
   *  written back — so the caller can surface the failure instead of
   *  silently working from (or persisting) a guess. */
  migrationError: string | null
}

/** True once a stored record has the current frame-based shape. There is no
 *  version field in storage, so shape-sniffing on `frames` is the only way
 *  to tell a current record from a pre-frame ("legacy") one. */
function hasFrames(value: unknown): value is Project {
  return typeof value === "object" && value !== null && Array.isArray((value as { frames?: unknown }).frames)
}

function describeMigrationFailure(reason: MigrationFailureReason): string {
  switch (reason.kind) {
    case "invalid-input":
      return reason.message
    case "frame-count-mismatch":
      return `expected ${reason.expected} pages, found ${reason.actual}`
    case "missing-asset":
      return `a page references a photo that no longer exists`
    case "invalid-box":
      return `a page layout has invalid geometry`
    case "invalid-positions":
      return `page order is corrupt`
  }
}

/**
 * Load the project, migrating a pre-frame stored record on the way in.
 *
 * A crash or a tab closed mid-import can leave blobs no asset record
 * references. They are invisible to the user and would consume quota forever,
 * so loading is where they get collected.
 *
 * Migration failure degrades to read-only rather than corrupting the stored
 * record: the raw legacy record is returned as-is (cast to `Project` so the
 * rest of the app can still render something) and `saveProject` is never
 * called, so nothing about the failed attempt is persisted.
 */
export async function loadProject(): Promise<LoadProjectResult> {
  const db = await getDb()
  const stored = await db.get("project", PROJECT_KEY)

  if (!stored) {
    const project = createEmptyProject()
    await deleteOrphanedBlobs(project)
    return { project, migrationError: null }
  }

  if (hasFrames(stored)) {
    await deleteOrphanedBlobs(stored)
    return { project: stored, migrationError: null }
  }

  // Pre-frame shape: no `frames` field at all. Run it through the one-time
  // migration rather than handing the old shape to code that expects
  // `Project.frames` to exist.
  const result = migrateProject(stored as unknown as LegacyProject)

  if (result.ok) {
    await saveProject(result.project)
    await deleteOrphanedBlobs(result.project)
    return { project: result.project, migrationError: null }
  }

  // Do NOT call saveProject here — the stored record must be left exactly as
  // it was found so a future fix to the migration can still recover it.
  const project = stored as unknown as Project
  await deleteOrphanedBlobs(project)
  return {
    project,
    migrationError: `This project was saved by an older version of Loupe and could not be upgraded (${describeMigrationFailure(result.reason)}). Changes will not be saved until this is resolved.`,
  }
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
