/**
 * One-time migration of a pre-frame ("legacy") project into the current
 * `Frame`-based `Project` shape.
 *
 * Legacy projects had `edits: LegacyEdit[]` (candidate sequences of asset
 * ids) and `pages: Page[]` (the committed book), but no `frames` field at
 * all — frames didn't exist yet. This module converts one legacy page into
 * one frame, in order, and leaves everything else about the project alone.
 *
 * Deliberately NOT attempted: turning `edits` into frames. An edit is just
 * an ordered list of asset ids — there is no recorded layout, so "the"
 * frame a given edit would produce doesn't exist to recover. Inventing one
 * (e.g. one image per frame, arbitrarily positioned) would be indistinguishable
 * from data loss dressed up as data. Legacy `edits` are therefore read only
 * far enough to note they existed; nothing derived from them appears in the
 * output, and the tests assert that.
 */

import type { Asset, Box, BookSetup, CanvasState, Frame, Page, PageElement, PageSize, Project } from './types'

/**
 * Minimal shape of the pre-frame `Edit` record, copied from history
 * (core/src/types.ts as of commit 2dca43d^) rather than re-exported from
 * `types.ts` — the real `Edit` type is gone for good (KTD3) and this module
 * only needs enough of its shape to read a legacy project, not to resurrect
 * the type as a first-class concept.
 */
export interface LegacyEdit {
  id: string
  name: string
  memberIds: string[]
  createdAt: number
}

/** The pre-frame project shape: had `edits` + `pages`, no `frames` field. */
export interface LegacyProject {
  name: string
  pageSize: PageSize
  assets: Asset[]
  canvas: CanvasState
  edits: LegacyEdit[]
  pages: Page[]
  typeBaseSize: number
  typeRatio: number
}

/**
 * Sane normalized range for a `Box` field. `Box` values are 0..1 relative to
 * the page in the common case, but a small amount of overflow past the page
 * edge is legitimate (e.g. a bleed image dragged slightly off-page), so the
 * bound is wider than [0, 1]. Anything outside [-1, 2] is treated as
 * corrupt geometry rather than an unusual-but-valid layout — that is, up to
 * one full page-width/height of overflow on either side. This is a
 * judgment call: no product spec pins this number down, and it exists only
 * to catch NaN/garbage, not to enforce a real design constraint.
 */
const BOX_MIN = -1
const BOX_MAX = 2

export type MigrationFailureReason =
  | { kind: 'invalid-input'; message: string }
  | { kind: 'frame-count-mismatch'; expected: number; actual: number }
  | { kind: 'missing-asset'; frameId: string; elementId: string; assetId: string }
  | { kind: 'invalid-box'; frameId: string; elementId: string; field: keyof Box; value: number }
  | { kind: 'invalid-positions'; positions: number[] }

export type MigrationResult =
  | { ok: true; project: Project; legacyEditCount: number }
  | { ok: false; reason: MigrationFailureReason }

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoxInRange(box: Box): keyof Box | null {
  const fields: (keyof Box)[] = ['x', 'y', 'width', 'height']
  for (const field of fields) {
    const value = box[field]
    if (!isFiniteNumber(value) || value < BOX_MIN || value > BOX_MAX) return field
  }
  return null
}

/** Validate an already-built frame list against the rules the plan specifies.
 *  Exported separately from `migrateProject` so tests (and any future caller
 *  building frames some other way) can exercise the validator directly on a
 *  hand-constructed, possibly-malformed frame list. */
export function validateMigratedFrames(
  frames: readonly Frame[],
  expectedCount: number,
  assets: readonly Asset[],
): MigrationFailureReason | null {
  if (frames.length !== expectedCount) {
    return { kind: 'frame-count-mismatch', expected: expectedCount, actual: frames.length }
  }

  const assetIds = new Set(assets.map((a) => a.id))

  for (const frame of frames) {
    for (const element of frame.elements) {
      if (element.kind === 'image' && !assetIds.has(element.assetId)) {
        return {
          kind: 'missing-asset',
          frameId: frame.id,
          elementId: element.id,
          assetId: element.assetId,
        }
      }

      const badField = isBoxInRange(element.frame)
      if (badField) {
        return {
          kind: 'invalid-box',
          frameId: frame.id,
          elementId: element.id,
          field: badField,
          value: element.frame[badField],
        }
      }
    }
  }

  const positions = frames.map((f) => f.position).sort((a, b) => a - b)
  const expectedPositions = frames.map((_, i) => i)
  const positionsOk = positions.every((p, i) => p === expectedPositions[i])
  if (!positionsOk) {
    return { kind: 'invalid-positions', positions: frames.map((f) => f.position) }
  }

  return null
}

function isLegacyProjectShape(value: unknown): value is LegacyProject {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.name === 'string' &&
    typeof v.pageSize === 'object' &&
    v.pageSize !== null &&
    Array.isArray(v.assets) &&
    typeof v.canvas === 'object' &&
    v.canvas !== null &&
    Array.isArray(v.edits) &&
    Array.isArray(v.pages) &&
    typeof v.typeBaseSize === 'number' &&
    typeof v.typeRatio === 'number'
  )
}

/**
 * Convert a legacy (pre-frame) project into the current frame-based shape.
 *
 * One frame per legacy page, in existing order, with that page's elements
 * copied verbatim — `Page.elements` and `Frame.elements` are both
 * `PageElement[]`, so no per-element transformation is needed. Legacy
 * `edits` are read only to report how many existed; they are never
 * converted into frames (see module doc).
 *
 * Returns a typed failure instead of throwing on any malformed input, and
 * validates the result before reporting success so a caller can never
 * persist a migration that produced dangling references or corrupt
 * geometry/ordering.
 */
export function migrateProject(legacy: LegacyProject): MigrationResult {
  if (!isLegacyProjectShape(legacy)) {
    return { ok: false, reason: { kind: 'invalid-input', message: 'legacy project is missing required fields' } }
  }

  const frames: Frame[] = legacy.pages.map((page, index) => ({
    id: page.id,
    pageSize: legacy.pageSize,
    position: index,
    elements: page.elements as PageElement[],
  }))

  const failure = validateMigratedFrames(frames, legacy.pages.length, legacy.assets)
  if (failure) return { ok: false, reason: failure }

  const project: Project = {
    name: legacy.name,
    pageSize: legacy.pageSize,
    assets: legacy.assets,
    canvas: legacy.canvas,
    frames,
    pages: legacy.pages,
    typeBaseSize: legacy.typeBaseSize,
    typeRatio: legacy.typeRatio,
  }

  return { ok: true, project, legacyEditCount: legacy.edits.length }
}

// Re-exported for callers that want the book-setup shape without importing
// from './types' directly in migration-adjacent code.
export type { BookSetup }
