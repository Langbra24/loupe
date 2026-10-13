const TABBABLE =
  'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]:not([contenteditable="false"])'

/** The elements Tab visits inside `container`, in order. A radio group counts
 *  once (its checked radio, or its first), as the browser treats it. */
export function tabbables(container: HTMLElement): HTMLElement[] {
  const seenGroups = new Set<string>()
  const candidates = [...container.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.checkVisibility(),
  )
  return candidates.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name) return true
    if (seenGroups.has(element.name)) return false
    const group = candidates.filter(
      (other): other is HTMLInputElement => other instanceof HTMLInputElement && other.name === element.name,
    )
    const representative = group.find((radio) => radio.checked) ?? group[0]
    if (representative !== element) return false
    seenGroups.add(element.name)
    return true
  })
}

/**
 * Keeps Tab and Shift+Tab inside `container`, synchronously: at either end,
 * focus wraps to the other end within the same keydown, and focus that has
 * somehow left is brought back in.
 *
 * Base UI's modal Dialog traps with focus guards that redirect on the next
 * animation frame, so a Tab that lands before that frame (fast key repeat, or
 * a main thread busy redrawing the canvas) walks out of the dialog (#45).
 * Handling the boundary in the keydown itself never reaches the guards.
 */
export function trapTab(event: Pick<KeyboardEvent, "key" | "shiftKey" | "preventDefault">, container: HTMLElement) {
  if (event.key !== "Tab") return
  const items = tabbables(container)
  const first = items[0]
  const last = items[items.length - 1]
  const active = container.ownerDocument.activeElement
  if (!first || !last) {
    event.preventDefault()
    return
  }
  if (!(active instanceof Node) || !container.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}
