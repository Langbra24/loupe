/**
 * Small array helpers shared across the engine.
 *
 * `moveItem` exists because reordering pages and reordering an edit's members
 * are the same operation on different lists — writing the splice twice invites
 * the two from drifting apart.
 */

/**
 * Move one element to a new index, shifting everything between.
 *
 * Out-of-range sources return the list unchanged; out-of-range targets clamp.
 * Both are reachable from drag-and-drop, where a pointer can leave the list.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items]
  if (from < 0 || from >= next.length) return next

  const target = Math.max(0, Math.min(to, next.length - 1))
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next

  next.splice(target, 0, moved)
  return next
}
