import type { Textbox, TPointerEventInfo } from "fabric"

type FabricModule = typeof import("fabric")
type MouseUpOptions = Parameters<Textbox["mouseUpHandler"]>[0]
type EditingManagerTarget = Parameters<NonNullable<Textbox["canvas"]>["textEditingManager"]["unregister"]>[0]

let SelectableTextbox: typeof Textbox | null = null

/**
 * A `Textbox` that clicks like a design tool's text layer (user-directed,
 * issue #14): a single click only selects the box, and a double click edits
 * it with the caret where you clicked.
 *
 * Fabric's own `IText` behaves differently in two ways this overrides:
 * - its `mouseUpHandler` enters editing on any click on an already-selected
 *   box, so a second single click would start typing. Here mouseup only
 *   reaches Fabric while editing, where it settles a caret move or a drag
 *   selection;
 * - its `doubleClickHandler` selects the word under the pointer, even on
 *   the double click that starts editing. Here that double click places a
 *   collapsed caret at the pointer instead, so the next keystroke inserts
 *   rather than replaces. Once editing, a double click selects a word as
 *   in any text editor.
 *
 * Entering editing programmatically (`enterEditing()`, as the `T` tool does
 * for a box it just placed) is unaffected. Built on first use because Fabric
 * is imported dynamically, client-side only.
 */
export function selectableTextboxClass(fabric: FabricModule): typeof Textbox {
  SelectableTextbox ??= class extends fabric.Textbox {
    mouseUpHandler(options: MouseUpOptions) {
      if (this.isEditing) {
        super.mouseUpHandler(options)
        return
      }
      // The mousedown half registered this box for text-selection drags;
      // undo that, which is all Fabric's handler would do here besides
      // entering editing.
      this.canvas?.textEditingManager.unregister(this as EditingManagerTarget)
    }

    doubleClickHandler(options: TPointerEventInfo) {
      if (this.isEditing) {
        super.doubleClickHandler(options)
        return
      }
      this.enterEditing(options.e)
      this.setCursorByClick(options.e)
      this.initDelayedCursor(true)
    }
  }
  return SelectableTextbox
}
