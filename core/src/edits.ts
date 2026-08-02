/**
 * Operations on Edits — the candidate sequences of stage two.
 *
 * All pure and total: no ids generated here, no clocks read. Callers supply
 * both, which keeps these functions testable and keeps `core/` free of any
 * ambient dependency.
 */

import { moveItem } from "./collections"
import type { Edit } from "./types"

export function createEdit(
  id: string,
  name: string,
  createdAt: number,
  memberIds: readonly string[] = [],
): Edit {
  return { id, name, createdAt, memberIds: [...memberIds] }
}

/**
 * Add a photograph to an Edit.
 *
 * Idempotent: an asset already in this edit is left alone rather than
 * duplicated. Promotion is additive and repeatable — a user right-clicking the
 * same photo twice should not produce it twice in the book.
 */
export function addToEdit(edit: Edit, assetId: string): Edit {
  if (edit.memberIds.includes(assetId)) return edit

  return { ...edit, memberIds: [...edit.memberIds, assetId] }
}

export function removeFromEdit(edit: Edit, assetId: string): Edit {
  if (!edit.memberIds.includes(assetId)) return edit

  return { ...edit, memberIds: edit.memberIds.filter((id) => id !== assetId) }
}

/** Reorder within an Edit. This is the only way order changes — never geometry. */
export function reorderEditMember(edit: Edit, from: number, to: number): Edit {
  return { ...edit, memberIds: moveItem(edit.memberIds, from, to) }
}

export function renameEdit(edit: Edit, name: string): Edit {
  return { ...edit, name }
}

/** Branch a variant from a working sequence, so alternatives can be compared. */
export function duplicateEdit(edit: Edit, id: string, createdAt: number): Edit {
  return { id, name: `${edit.name} copy`, createdAt, memberIds: [...edit.memberIds] }
}
