"use client"

import { create } from "zustand"
import {
  assignToFrame,
  createEmptyProject,
  createFrame,
  framesForBookSetup,
  insertFrame,
  layoutNewPlacements,
  presetImageBox,
  removeFromFrame,
  reorderFrame,
  spreadSideOf,
  updateElement,
  updateFrame,
  defaultFrameMargins,
  type Asset,
  type BookSetup,
  type Box,
  type CanvasPlacement,
  type Frame,
  type ImageElement,
  type ImagePreset,
  type Margins,
  type PageElement,
  type PageSize,
  type Project,
  type Selection,
  type TextElement,
} from "@sequence/core"

import { BLEED_MM } from "@/components/shell/inspector-panel"
import { DEFAULT_TEXT_FONT } from "@/lib/fonts"

import { importFiles } from "@/lib/storage/assets"
import {
  loadProject,
  saveProject,
  saveProjectDebounced,
} from "@/lib/storage/project"

/**
 * A freshly created text element's initial `fontSize` override (points) —
 * deliberately independent of the type scale's `sizeForRole('body', ...)`
 * value (10pt at the book's default base/ratio), which reads as an almost
 * invisible scrap of text the instant a box lands rather than something the
 * user can see they just placed. User-directed: "big enough so the user can
 * see that we rendered a text box." Still just a starting point — the
 * sidebar's Size field overwrites it same as any other override.
 */
const DEFAULT_NEW_TEXT_SIZE = 24

/**
 * One undoable step (U8). `do` replays the mutation forward; `undo` reverses
 * it. Both are plain closures over whatever state the action needs to
 * invert itself — a targeted snapshot of just what that action touched
 * (the frame array before a reorder, the placement a photograph came from),
 * not a snapshot of the whole project. This is a command stack scoped to
 * these specific canvas mutations, not a general state-snapshot/time-travel
 * system. `redo()` consumes the `do` side: an undone command moves onto
 * `redoStack`, and redoing it calls `.do()` and moves it back onto
 * `undoStack` — the same shape serves both directions.
 */
interface UndoCommand {
  do: () => void
  undo: () => void
}

/** What the left panel shows, and — since a book review should replace the
 *  editable canvas rather than sit beside it, the way it did before this
 *  plan's restructure — what the main canvas region shows too. Lives in the
 *  store rather than as local state in one component because both
 *  `LayersPanel` and `CanvasRegion` need to read it. */
export type PanelView = "canvas" | "book"

interface EditorState {
  project: Project
  selection: Selection
  panelView: PanelView
  /** See `UndoCommand`. Cleared on project load (`hydrate`) — undoing right
   *  after opening a project must never reach into a previous project's
   *  history. */
  undoStack: UndoCommand[]
  /** Commands popped off `undoStack` by `undo()`, available for `redo()` to
   *  replay. Cleared alongside `undoStack` on project load, and cleared by
   *  `pushUndo` on every new action — the standard convention that
   *  performing a fresh action after an undo invalidates the redo history,
   *  since there is no longer a consistent timeline to redo into. */
  redoStack: UndoCommand[]
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  hydrated: boolean
  importProgress: { done: number; total: number } | null
  lastError: string | null
  /** UI-only — resets on reload, which is fine: the reopen control (R32)
   *  means dismissal is never the only way back, so nothing is lost by not
   *  persisting this to IndexedDB. */
  introductionDismissed: boolean

  hydrate: () => Promise<void>
  /** Pops the most recent `UndoCommand` and runs its `undo` side, then pushes
   *  it onto `redoStack`. A no-op, not an error, when the stack is empty. */
  undo: () => void
  /** Pops the most recent `UndoCommand` off `redoStack` and runs its `do`
   *  side, then pushes it back onto `undoStack`. A no-op, not an error, when
   *  the stack is empty. */
  redo: () => void

  importPhotos: (files: readonly File[]) => Promise<void>
  movePlacement: (placementId: string, x: number, y: number) => void
  scalePlacement: (placementId: string, scale: number) => void
  /** Deletes one or more pasteboard photographs outright, as a single
   *  undoable step — Backspace/Delete on whatever's selected on the
   *  pasteboard, one photograph or several shift-clicked together
   *  (user-directed: "delete photos that are not on a page", then "I can't
   *  multi-select and delete"). See the implementation below for why this
   *  also drops each `Asset`, not just its `CanvasPlacement`. */
  removePlacements: (placementIds: readonly string[]) => void
  moveToFrame: (placementId: string, frameId: string) => void
  /** Creates a text element on a frame — either a pasteboard text box (U6)
   *  finishing editing over a frame's bounds, or (the common case since the
   *  click-to-place rework) armTextTool placing directly on a frame, where
   *  this fires immediately with empty content so the sidebar has something
   *  to show from the very first keystroke rather than only once editing
   *  ends. Returns the new element's id — the caller needs it to find the
   *  Fabric object `syncFrameElements` renders for it and enter editing on
   *  that object once it exists (see `pendingAutoEditElementIdRef` in
   *  use-fabric-canvas.ts). */
  createTextElement: (frameId: string, content: string, box?: Box) => string
  /** Remove an image or text element from its frame — the Backspace/Delete
   *  shortcut when one is selected (but not actively being edited; see
   *  `useDeleteSelectionShortcut`). Restores it at its original index within
   *  `frame.elements` on undo, the same convention `removeFrame` uses for
   *  restoring a whole frame's position. */
  removeElement: (frameId: string, elementId: string) => void

  /** Renames the book — the layers panel's top-left field, made editable on
   *  click (user-directed). Not pushed onto the undo stack: same as
   *  `setupBook`'s `pageSize`/`pageCount`, this is a settings-style field a
   *  user can just retype, not a canvas design mutation worth Ctrl+Z-ing. */
  renameProject: (name: string) => void

  addFrame: (pageSize: PageSize) => string
  removeFrame: (frameId: string) => void
  reorderFrameById: (from: number, to: number) => void
  /** Create the book's starting frame set from the setup dialog. A no-op if
   *  frames already exist — the dialog only ever fires once per project. */
  setupBook: (setup: BookSetup) => void

  /** Snapshot of a frame's contents (pageSize, margins, elements), set by
   *  Cmd/Ctrl+C on a selected frame and consumed by `pasteFrame`. UI-only —
   *  not persisted, the same way `introductionDismissed` isn't: losing the
   *  clipboard on reload is an acceptable, unsurprising loss. */
  clipboardFrame: Frame | null
  /** Copy the currently selected frame's contents to `clipboardFrame`. A
   *  no-op if nothing selected is a frame. */
  copySelectedFrame: () => void
  /** Paste `clipboardFrame` as a new frame immediately after the currently
   *  selected frame (or at the end, if nothing is selected). Elements are
   *  deep-cloned with fresh ids — a paste is a new page, not a second
   *  reference to the same one. A no-op if the clipboard is empty. */
  pasteFrame: () => void
  /** The low-opacity "add a paired page" buttons shown beside a selected
   *  frame — a blank page at the same size, inserted directly before/after
   *  it. */
  addPairedPage: (frameId: string, side: "before" | "after") => void

  /**
   * Selection, redesigned for the frame model (U7) — see `Selection` in
   * types.ts for why `page`/`element` (keyed by `pageId`) doesn't fit
   * anymore. `selectElement` takes just the ids and looks up the element's
   * `kind` itself, so callers (canvas click handlers, list rows) don't have
   * to know the `text-element`/`image-element` split to select something.
   *
   * There is no separate `commitPendingEdit` step (R29): the sidebar's form
   * fields are plain controlled inputs that write straight to the store on
   * every keystroke (see `updateTextElement` etc. below), so there is no
   * draft state sitting outside the store that a selection change could
   * discard. Changing `selection` mid-edit simply stops one set of fields
   * from rendering; the value already landed.
   */
  selectFrame: (frameId: string) => void
  selectElement: (frameId: string, elementId: string) => void
  clearSelection: () => void
  setPanelView: (view: PanelView) => void
  /** Jump from the book overview back to the canvas with a specific frame
   *  selected — the click target of a book-overview page (KTD: restoring the
   *  pre-plan "click a page to review it" behavior against frames instead of
   *  the old committed-Page model). */
  reviewFrame: (frameId: string) => void
  updateFrameMargins: (frameId: string, margins: Margins) => void
  /** Toggle a frame's `isCover` flag — the right-click "set as cover" /
   *  "remove cover" action on a frame's own background. */
  setFrameCover: (frameId: string, isCover: boolean) => void
  updateTextElement: (
    frameId: string,
    elementId: string,
    patch: Partial<Pick<TextElement, "content" | "role" | "align" | "fontFamily" | "fontSize" | "color">>,
  ) => void
  /** Brackets one color gesture — a drag on the picker, or typing in its hex
   *  or channel fields — so every color change in between becomes a single
   *  undo step, pushed by `endTextColorGesture` if the color actually moved
   *  (issue #27). Color changes outside a gesture are one step each. */
  beginTextColorGesture: (frameId: string, elementId: string) => void
  endTextColorGesture: () => void
  updateImageFit: (frameId: string, elementId: string, fit: ImageElement["fit"]) => void
  /** Snap an image element into one of the fixed layout presets (right-click
   *  on an image in a frame) — full-bleed, centered with margins, or left
   *  half. Undoable as one step, the same granularity as `moveToFrame`. */
  applyImagePreset: (frameId: string, elementId: string, preset: ImagePreset) => void
  /** Bound to an element's normalized `Box` — the text sidebar's width field
   *  and the image sidebar's position/size fields both go through this. */
  updateElementBox: (frameId: string, elementId: string, patch: Partial<Box>) => void
  /**
   * An element already inside a frame was dragged across onto a *different*
   * frame's bounds — reassigns it there instead of `updateElementBox`,
   * which only ever recomputes the element's Box against whichever frame it
   * already belongs to. Without this, dragging a photo from one page onto
   * another moved it visually but left it structurally on the original
   * page: the sidebar's "Centered"/"Full bleed" presets read `frameId` off
   * `selection`, which stayed pointed at the old page, so clicking a preset
   * re-centered the image on the page it used to live on, not the one it
   * now visually sits on (direct bug report). `box` is the element's new
   * normalized position/size, already computed against the *destination*
   * frame's bounds by the caller — the same math `onUpdateElementBox`
   * already does, just against a different frame's layout.
   */
  moveElementToFrame: (fromFrameId: string, toFrameId: string, elementId: string, box: Box) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  dismissError: () => void
  dismissIntroduction: () => void
  showIntroduction: () => void
}

/**
 * Both panels open by default: the left panel is the Canvas/Book switcher
 * (U10), always navigation; the right panel is the contextual sidebar (U7),
 * which is relevant the moment anything exists to select or configure — book
 * settings render there even with nothing selected. There is only one screen
 * now (U12), so there is no longer a mode-dependent default to branch on.
 */
const PANEL_DEFAULTS = { leftPanelOpen: true, rightPanelOpen: true } as const

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export const useEditorStore = create<EditorState>((set, get) => {
  /** Persist after a mutation that cannot orphan a blob. */
  const persistLater = (project: Project) => saveProjectDebounced(project)

  /** Persist immediately — used when blobs were just written, since the project
   *  record is what addresses them. */
  const persistNow = (project: Project) =>
    saveProject(project).catch((error: unknown) =>
      set({ lastError: error instanceof Error ? error.message : "Could not save" }),
    )

  const textElement = (frameId: string, elementId: string) =>
    get()
      .project.frames.find((frame) => frame.id === frameId)
      ?.elements.find((element): element is TextElement => element.id === elementId && element.kind === "text")

  /** The open color gesture, if any: which element, its color before, and how
   *  many begins are still open. Gestures nest because they can overlap: a
   *  press on the hue slider begins its drag before the hex field it took
   *  focus from has ended its own. */
  let colorGesture: { frameId: string; elementId: string; before: string | undefined; depth: number } | null = null

  const setTextColor = (frameId: string, elementId: string, color: string | undefined) =>
    updateProject((project) => ({
      ...project,
      frames: updateElement(project.frames, frameId, elementId, (element) =>
        element.kind === "text" ? { ...element, color } : element,
      ),
    }))

  const colorCommand = (
    frameId: string,
    elementId: string,
    before: string | undefined,
    after: string | undefined,
  ): UndoCommand => ({
    do: () => setTextColor(frameId, elementId, after),
    undo: () => setTextColor(frameId, elementId, before),
  })

  const updateProject = (
    mutate: (project: Project) => Project,
    options: { immediate?: boolean } = {},
  ) => {
    const next = mutate(get().project)
    set({ project: next })
    if (options.immediate) void persistNow(next)
    else persistLater(next)
    return next
  }

  /** Append one undoable step to the stack. Clears `redoStack` — performing
   *  any new action after an undo invalidates the redo history, since it
   *  would otherwise redo into a timeline that branched away the moment this
   *  new command landed. */
  const pushUndo = (command: UndoCommand) =>
    set((state) => ({ undoStack: [...state.undoStack, command], redoStack: [] }))

  return {
    // Must be a valid empty project, not undefined: the server render and the
    // first client render have to agree, and hydration replaces this after
    // mount. Getting this wrong surfaces as a hydration mismatch, not an error.
    project: createEmptyProject(),
    selection: null,
    panelView: "canvas",
    clipboardFrame: null,
    undoStack: [],
    redoStack: [],
    ...PANEL_DEFAULTS,
    hydrated: false,
    importProgress: null,
    lastError: null,
    introductionDismissed: false,

    hydrate: async () => {
      if (get().hydrated) return
      // A fresh load's undo/redo stacks must never reach into a previous
      // project's history (U8) — cleared unconditionally, before either
      // branch below, since there is nothing in the just-created empty
      // project worth undoing (or redoing) either way.
      set({ undoStack: [], redoStack: [] })
      try {
        const { project, migrationError } = await loadProject()
        set({ project, hydrated: true, lastError: migrationError })
      } catch {
        // An unavailable IndexedDB (private mode, blocked storage) should not
        // brick the app — the session just will not survive a reload.
        set({ hydrated: true, lastError: "Local storage is unavailable — work will not be saved" })
      }
    },

    undo: () => {
      const stack = get().undoStack
      const command = stack[stack.length - 1]
      if (!command) return
      set((state) => ({
        undoStack: stack.slice(0, -1),
        redoStack: [...state.redoStack, command],
      }))
      command.undo()
    },

    redo: () => {
      const stack = get().redoStack
      const command = stack[stack.length - 1]
      if (!command) return
      set((state) => ({
        redoStack: stack.slice(0, -1),
        undoStack: [...state.undoStack, command],
      }))
      command.do()
    },

    renameProject: (name) => updateProject((project) => ({ ...project, name })),

    importPhotos: async (files) => {
      if (files.length === 0) return
      set({ importProgress: { done: 0, total: files.length }, lastError: null })

      const { assets, failures } = await importFiles(files, (done, total) =>
        set({ importProgress: { done, total } }),
      )

      set({ importProgress: null })

      if (assets.length > 0) {
        updateProject(
          (project) => {
            const pool = [...project.assets, ...assets]
            return {
              ...project,
              assets: pool,
              canvas: {
                placements: [
                  ...project.canvas.placements,
                  ...layoutNewPlacements(project.canvas.placements, assets, pool),
                ],
              },
            }
          },
          // Blobs are already on disk; the asset records addressing them must
          // land now or a closed tab loses them.
          { immediate: true },
        )
      }

      if (failures.length > 0) {
        const [first] = failures
        set({
          lastError:
            failures.length === 1
              ? `${first?.fileName}: ${first?.reason}`
              : `${failures.length} files could not be imported`,
        })
      }
    },

    movePlacement: (placementId, x, y) =>
      updateProject((project) => ({
        ...project,
        canvas: {
          placements: project.canvas.placements.map((placement) =>
            placement.id === placementId ? { ...placement, x, y } : placement,
          ),
        },
      })),

    scalePlacement: (placementId, scale) =>
      updateProject((project) => ({
        ...project,
        canvas: {
          placements: project.canvas.placements.map((placement) =>
            placement.id === placementId ? { ...placement, scale } : placement,
          ),
        },
      })),

    /**
     * Also drops each `Asset` from `project.assets`, not just its
     * `CanvasPlacement` — a pasteboard placement is the only thing
     * referencing an asset on this side of the book (once a photograph
     * joins a frame, `moveToFrame` already removes its placement), so with
     * the placement gone the asset would otherwise sit in `project.assets`
     * forever: invisible, unreachable, and still counted as "known" by
     * `deleteOrphanedBlobs` (lib/storage/project.ts), which would keep its
     * IndexedDB blobs alive too.
     *
     * Takes an array and removes them all as one undoable step rather than
     * one call per id — shift-clicking several pasteboard photographs
     * (Fabric's own multi-select) is a normal gesture, and Backspace on
     * that selection should feel like one delete, restorable with one
     * Ctrl+Z, not `placementIds.length` separate history entries.
     *
     * The blobs themselves are not deleted synchronously here — this only
     * touches in-memory `Project` state, same as `removeFrame`/
     * `removeElement`. `deleteOrphanedBlobs` already sweeps any asset id no
     * longer present in `project.assets` on the *next* load, which is what
     * keeps this safely undoable: undo only has to restore the `Asset`/
     * `CanvasPlacement` records, never resurrect an already-deleted blob.
     */
    removePlacements: (placementIds) => {
      const state = get()
      const idSet = new Set(placementIds)

      // Collected in ascending array-index order (the loop below runs in
      // that order), which is what lets undo below splice each one back in
      // using its original index directly, unadjusted — every earlier
      // restoration in the loop is for an item that was originally before
      // the current one too, so it's already back in place by the time the
      // current one's original index is used.
      const removedPlacements: { index: number; placement: CanvasPlacement }[] = []
      state.project.canvas.placements.forEach((placement, index) => {
        if (idSet.has(placement.id)) removedPlacements.push({ index, placement })
      })
      if (removedPlacements.length === 0) return

      const assetIdSet = new Set(removedPlacements.map(({ placement }) => placement.assetId))
      const removedAssets: { index: number; asset: Asset }[] = []
      state.project.assets.forEach((asset, index) => {
        if (assetIdSet.has(asset.id)) removedAssets.push({ index, asset })
      })

      const doRemove = () =>
        updateProject((project) => ({
          ...project,
          canvas: { placements: project.canvas.placements.filter((p) => !idSet.has(p.id)) },
          assets: project.assets.filter((a) => !assetIdSet.has(a.id)),
        }))

      doRemove()

      pushUndo({
        do: doRemove,
        undo: () =>
          updateProject((project) => {
            const placements = [...project.canvas.placements]
            for (const { index, placement } of removedPlacements) placements.splice(index, 0, placement)
            const assets = [...project.assets]
            for (const { index, asset } of removedAssets) assets.splice(index, 0, asset)
            return { ...project, assets, canvas: { placements } }
          }),
      })
    },

    /**
     * A photograph dragged off the pasteboard and dropped onto a frame joins
     * that frame's elements and leaves the pasteboard — see `assignToFrame`
     * in core/src/frames.ts for the append semantics.
     *
     * Converting `CanvasPlacement` to `ImageElement` here is a lossy,
     * deliberate boundary crossing: `ImageElement` has no rotation field and
     * no scale field (only a normalized `Box` and a `fit` mode), so a
     * rotated or zoomed-in photograph resets to upright and full-bleed the
     * moment it becomes a frame element. This is the simplest, least
     * surprising option — carrying rotation/scale across would need either
     * adding fields to `ImageElement` (a bigger data-model change than this
     * unit) or inventing a transform to approximate it in the Box, which
     * `cover` fit already does implicitly. A prior plan review flagged that
     * silently dropping this without documentation reads as a data-loss
     * bug, hence this comment.
     */
    moveToFrame: (placementId, frameId) => {
      const placement = get().project.canvas.placements.find((p) => p.id === placementId)
      const asset = placement && get().project.assets.find((a) => a.id === placement.assetId)
      if (!placement || !asset) return

      // Generated once, up front, rather than inside `updateProject`'s
      // mutator — the undo closure below needs the same id `assignToFrame`
      // uses, and `updateProject`'s mutator can run more than once in
      // principle (React strict-mode double-invocation, etc.), which would
      // desync a second freshly-generated id from what actually landed.
      const elementId = newId("element")

      const doMove = () =>
        updateProject((project) => {
          const current = project.canvas.placements.find((p) => p.id === placementId)
          if (!current) return project

          const element: ImageElement = {
            id: elementId,
            name: asset.name,
            // Fills the frame edge-to-edge by default. There is no UI yet
            // for repositioning a photo within its frame once it lands —
            // that is later units' concern (design mode / the sidebar) — so
            // a full-bleed box with `cover` fit is the least surprising
            // start.
            frame: { x: 0, y: 0, width: 1, height: 1 },
            locked: false,
            hidden: false,
            kind: "image",
            assetId: current.assetId,
            fit: "cover",
          }

          /**
           * Converting `CanvasPlacement` to `ImageElement` here is a lossy,
           * deliberate boundary crossing: `ImageElement` has no rotation
           * field and no scale field (only a normalized `Box` and a `fit`
           * mode), so a rotated or zoomed-in photograph resets to upright
           * and full-bleed the moment it becomes a frame element. This is
           * the simplest, least surprising option — carrying rotation/scale
           * across would need either adding fields to `ImageElement` (a
           * bigger data-model change than this unit) or inventing a
           * transform to approximate it in the Box, which `cover` fit
           * already does implicitly. A prior plan review flagged that
           * silently dropping this without documentation reads as a
           * data-loss bug, hence this comment.
           */
          return {
            ...project,
            canvas: {
              placements: project.canvas.placements.filter((p) => p.id !== placementId),
            },
            frames: assignToFrame(project.frames, frameId, element),
          }
        })

      const applyMove = () => {
        doMove()
        // Without this, the sidebar has nothing to point at the instant a
        // photograph lands in a frame: the pasteboard `CanvasPlacement`
        // Fabric object is gone (replaced by a new frame-owned one
        // `syncFrameElements` draws next render), so `canvas.getActiveObject()`
        // comes back empty and the selection-cleared path reverts the
        // sidebar to book-level settings — even though something did land,
        // right there, selected-looking, on the canvas.
        set({ selection: { kind: "image-element", frameId, elementId } })
      }

      applyMove()

      pushUndo({
        do: applyMove,
        // The photograph's exact prior placement (position, scale,
        // rotation) is restored verbatim — U8's "restores it to its prior
        // frame (or pasteboard)" scenario, here the pasteboard side of it.
        undo: () => {
          updateProject((project) => ({
            ...project,
            canvas: { placements: [...project.canvas.placements, placement] },
            frames: removeFromFrame(project.frames, frameId, elementId),
          }))
          set({ selection: null })
        },
      })
    },

    /**
     * A text box lands on a frame — either `armTextTool`'s click/drag (the
     * common case; `box` is that gesture's position/size, converted to the
     * frame's normalized coordinates), or a pasteboard `Textbox` (U6)
     * finishing editing with its center over a frame with no click-position
     * of its own to give (see `use-fabric-canvas.ts`), in which case `box`
     * is omitted and this falls back to the same full-bleed `{0,0,1,1}` box
     * `moveToFrame` gives a dropped photograph. `role`/`align` default to
     * `'body'`/`'left'`: there is no UI yet for restyling text beyond the
     * sidebar's existing Type/Font/Alignment/Size fields, so the
     * least-surprising start is plain body text, sized so it's visibly
     * there (`DEFAULT_NEW_TEXT_SIZE`) rather than guessing at a role.
     */
    createTextElement: (frameId, content, box) => {
      // Generated up front for the same reason `moveToFrame`'s is — the
      // undo closure needs the id that actually landed.
      const elementId = newId("element")
      const element: TextElement = {
        id: elementId,
        name: content.trim().slice(0, 40) || "Text",
        frame: box ?? { x: 0, y: 0, width: 1, height: 1 },
        locked: false,
        hidden: false,
        kind: "text",
        content,
        role: "body",
        align: "left",
        fontFamily: DEFAULT_TEXT_FONT,
        fontSize: DEFAULT_NEW_TEXT_SIZE,
      }

      const doCreate = () => {
        updateProject((project) => ({ ...project, frames: assignToFrame(project.frames, frameId, element) }))
        // Without this, the sidebar has nothing to point at the instant a
        // pasteboard textbox commits into a frame: the transient Fabric
        // object is removed (a new frame-owned one takes its place on the
        // next `syncFrameElements` render), so `canvas.getActiveObject()`
        // comes back empty and the selection-cleared path reverts the
        // sidebar to book-level settings — even though text just landed,
        // right there, on the canvas.
        set({ selection: { kind: "text-element", frameId, elementId } })
      }

      doCreate()

      pushUndo({
        do: doCreate,
        undo: () => {
          updateProject((project) => ({
            ...project,
            frames: removeFromFrame(project.frames, frameId, elementId),
          }))
          set({ selection: null })
        },
      })

      return elementId
    },

    removeElement: (frameId, elementId) => {
      const frame = get().project.frames.find((f) => f.id === frameId)
      const index = frame?.elements.findIndex((element) => element.id === elementId) ?? -1
      const removed = index >= 0 ? frame?.elements[index] : undefined
      if (!frame || !removed) return

      // The removed element was necessarily the selection (it's a right-click
      // menu / keyboard-shortcut target on the currently selected element) —
      // clear it rather than leave a stale reference to an id that no longer
      // exists in `frame.elements`.
      const selection = get().selection
      const wasSelected = selection !== null && selection.kind !== "frame" && selection.elementId === elementId

      const doRemove = () => {
        updateProject((project) => ({ ...project, frames: removeFromFrame(project.frames, frameId, elementId) }))
        if (wasSelected) set({ selection: null })
      }

      doRemove()

      pushUndo({
        do: doRemove,
        // Restores the element at its original index within `frame.elements`
        // — mirrors `removeFrame`'s undo restoring a whole frame's position —
        // not just appended at the end.
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: updateFrame(project.frames, frameId, (f) => {
              const elements = [...f.elements]
              elements.splice(index, 0, removed)
              return { ...f, elements }
            }),
          })),
      })
    },

    addFrame: (pageSize) => {
      const id = newId("frame")

      const doAdd = () =>
        updateProject((project) => ({
          ...project,
          frames: [...project.frames, createFrame(id, pageSize, project.frames.length)],
        }))

      doAdd()

      pushUndo({
        do: doAdd,
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: project.frames
              .filter((frame) => frame.id !== id)
              .map((frame, index) => ({ ...frame, position: index })),
          })),
      })

      return id
    },

    setupBook: (setup) => {
      if (get().project.frames.length > 0) return
      const ids = Array.from({ length: setup.pageCount }, () => newId("frame"))
      updateProject((project) => ({
        ...project,
        pageSize: setup.pageSize,
        frames: framesForBookSetup(setup, ids),
      }))
    },

    copySelectedFrame: () => {
      const { selection, project } = get()
      const frameId = selection?.frameId ?? null
      if (!frameId) return
      const frame = project.frames.find((f) => f.id === frameId)
      if (frame) set({ clipboardFrame: frame })
    },

    pasteFrame: () => {
      const { clipboardFrame, selection, project } = get()
      if (!clipboardFrame) return

      const frameId = selection?.frameId ?? null
      const insertIndex = frameId
        ? project.frames.findIndex((f) => f.id === frameId) + 1
        : project.frames.length

      const newFrameId = newId("frame")
      // A paste is a new page, not a second reference to the copied one — its
      // elements get fresh ids so editing the copy never touches the original.
      const newFrame: Frame = {
        ...clipboardFrame,
        id: newFrameId,
        position: insertIndex,
        elements: clipboardFrame.elements.map((element: PageElement) => ({
          ...element,
          id: newId("element"),
        })),
      }

      const doPaste = () =>
        updateProject((project) => ({
          ...project,
          frames: insertFrame(project.frames, insertIndex, newFrame).map((frame, index) => ({
            ...frame,
            position: index,
          })),
        }))

      doPaste()

      pushUndo({
        do: doPaste,
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: project.frames
              .filter((frame) => frame.id !== newFrameId)
              .map((frame, index) => ({ ...frame, position: index })),
          })),
      })
    },

    addPairedPage: (frameId, side) => {
      const frames = get().project.frames
      const index = frames.findIndex((frame) => frame.id === frameId)
      const source = frames[index]
      if (!source) return

      const insertIndex = side === "before" ? index : index + 1
      const newFrameId = newId("frame")
      const newFrame = createFrame(newFrameId, source.pageSize, insertIndex)

      const doAdd = () =>
        updateProject((project) => ({
          ...project,
          frames: insertFrame(project.frames, insertIndex, newFrame).map((frame, index) => ({
            ...frame,
            position: index,
          })),
        }))

      doAdd()

      pushUndo({
        do: doAdd,
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: project.frames
              .filter((frame) => frame.id !== newFrameId)
              .map((frame, index) => ({ ...frame, position: index })),
          })),
      })
    },

    removeFrame: (frameId) => {
      const frames = get().project.frames
      const index = frames.findIndex((frame) => frame.id === frameId)
      const removed: Frame | undefined = frames[index]
      if (!removed) return

      const doRemove = () =>
        updateProject((project) => ({
          ...project,
          frames: project.frames
            .filter((frame) => frame.id !== frameId)
            // Re-derive position from the resulting order — reorderFrame
            // leaves the array as the source of truth and expects callers to
            // do this.
            .map((frame, i) => ({ ...frame, position: i })),
        }))

      doRemove()

      pushUndo({
        do: doRemove,
        // Restores the whole frame — including whatever elements it held —
        // at its original array index, not just re-appended at the end.
        undo: () =>
          updateProject((project) => {
            const restored = [...project.frames]
            restored.splice(index, 0, removed)
            return { ...project, frames: restored.map((frame, i) => ({ ...frame, position: i })) }
          }),
      })
    },

    reorderFrameById: (from, to) => {
      // The exact prior order, restored verbatim on undo — simpler and just
      // as correct as trying to compute the inverse move algebraically, and
      // it can't drift from whatever `reorderFrame`'s actual semantics are.
      const prevFrames = get().project.frames

      const doReorder = () =>
        updateProject((project) => ({
          ...project,
          frames: reorderFrame(project.frames, from, to).map((frame, index) => ({
            ...frame,
            position: index,
          })),
        }))

      doReorder()

      pushUndo({
        do: doReorder,
        undo: () => updateProject((project) => ({ ...project, frames: prevFrames })),
      })
    },

    selectFrame: (frameId) => set({ selection: { kind: "frame", frameId } }),

    selectElement: (frameId, elementId) => {
      const frame = get().project.frames.find((f) => f.id === frameId)
      const element = frame?.elements.find((e) => e.id === elementId)
      if (!element) return
      set({
        selection: {
          kind: element.kind === "text" ? "text-element" : "image-element",
          frameId,
          elementId,
        },
      })
    },

    clearSelection: () => set({ selection: null }),

    setPanelView: (view) => set({ panelView: view }),

    reviewFrame: (frameId) => set({ panelView: "canvas", selection: { kind: "frame", frameId } }),

    updateFrameMargins: (frameId, margins) =>
      updateProject((project) => ({
        ...project,
        frames: updateFrame(project.frames, frameId, (frame) => ({ ...frame, margins })),
      })),

    setFrameCover: (frameId, isCover) => {
      const frames = get().project.frames
      const index = frames.findIndex((frame) => frame.id === frameId)
      if (index === -1) return

      const prevIsCover = frames[index].isCover
      // "Set as cover" also promotes the frame to the front of the book —
      // same convention every other reorder action here follows: reorder,
      // then re-derive `position` from the resulting array order. "Remove
      // cover" never moves anything, and a frame that's already at the
      // front needs no reorder at all (avoids a no-op move / undo step).
      const shouldMoveToFront = isCover && index !== 0

      const doSet = () =>
        updateProject((project) => {
          const patched = updateFrame(project.frames, frameId, (frame) => ({ ...frame, isCover }))
          const reordered = shouldMoveToFront
            ? reorderFrame(
                patched,
                patched.findIndex((frame) => frame.id === frameId),
                0,
              )
            : patched
          return {
            ...project,
            frames: reordered.map((frame, i) => ({ ...frame, position: i })),
          }
        })

      doSet()

      pushUndo({
        do: doSet,
        // Restores both the exact prior array position (splice back to the
        // original index, mirroring `removeFrame`'s undo) and the prior
        // `isCover` value, in one step.
        undo: () =>
          updateProject((project) => {
            const current = project.frames.find((frame) => frame.id === frameId)
            if (!current) return project
            const restoredFrame = { ...current, isCover: prevIsCover }
            const withoutFrame = project.frames.filter((frame) => frame.id !== frameId)
            const restored = [...withoutFrame]
            restored.splice(index, 0, restoredFrame)
            return { ...project, frames: restored.map((frame, i) => ({ ...frame, position: i })) }
          }),
      })
    },

    updateTextElement: (frameId, elementId, patch) => {
      // Only a content change is treated as the "text edit" undo scenario
      // (U8) — role/alignment are structural choices closer in kind to the
      // frame/fit settings elsewhere in the sidebar, which this unit's list
      // of undoable actions doesn't name. Note the granularity this gives:
      // every call here (every keystroke, if a caller wires this straight to
      // an <input>'s onChange) is its own undo step, so undo restores to
      // immediately before that one call, not to "before the user started
      // typing". Coalescing keystrokes into one undo step per editing
      // session would need buffering this unit doesn't build — the command
      // stack stays a thin do/undo pair per store-mutating call, as the plan
      // specifies.
      const prevContent =
        patch.content !== undefined
          ? get()
              .project.frames.find((f) => f.id === frameId)
              ?.elements.find((e): e is TextElement => e.id === elementId && e.kind === "text")?.content
          : undefined

      const prevColor = patch.color !== undefined ? textElement(frameId, elementId)?.color : undefined

      const doUpdate = () =>
        updateProject((project) => ({
          ...project,
          frames: updateElement(project.frames, frameId, elementId, (element) =>
            element.kind === "text" ? { ...element, ...patch } : element,
          ),
        }))

      doUpdate()

      // Color is undoable (#27): one step per change, unless a gesture is
      // open on this element, in which case `endTextColorGesture` pushes one
      // step for the whole gesture.
      const inGesture = colorGesture?.frameId === frameId && colorGesture.elementId === elementId
      if (patch.color !== undefined && !inGesture && patch.color !== prevColor) {
        pushUndo(colorCommand(frameId, elementId, prevColor, patch.color))
      }

      // Leaving a text box's editing commits its content whether or not it
      // changed. Entering and leaving editing isn't an edit, so an unchanged
      // content gets no undo step.
      if (patch.content !== undefined && prevContent !== undefined && patch.content !== prevContent) {
        pushUndo({
          do: doUpdate,
          undo: () =>
            updateProject((project) => ({
              ...project,
              frames: updateElement(project.frames, frameId, elementId, (element) =>
                element.kind === "text" ? { ...element, content: prevContent } : element,
              ),
            })),
        })
      }
    },

    beginTextColorGesture: (frameId, elementId) => {
      if (colorGesture?.frameId === frameId && colorGesture.elementId === elementId) {
        colorGesture.depth += 1
        return
      }
      colorGesture = { frameId, elementId, before: textElement(frameId, elementId)?.color, depth: 1 }
    },

    endTextColorGesture: () => {
      const gesture = colorGesture
      if (!gesture) return
      gesture.depth -= 1
      if (gesture.depth > 0) return
      colorGesture = null
      const after = textElement(gesture.frameId, gesture.elementId)?.color
      if (after !== gesture.before) {
        pushUndo(colorCommand(gesture.frameId, gesture.elementId, gesture.before, after))
      }
    },

    updateImageFit: (frameId, elementId, fit) =>
      updateProject((project) => ({
        ...project,
        frames: updateElement(project.frames, frameId, elementId, (element) =>
          element.kind === "image" ? { ...element, fit } : element,
        ),
      })),

    applyImagePreset: (frameId, elementId, preset) => {
      const frame = get().project.frames.find((f) => f.id === frameId)
      const prevElement = frame?.elements.find((e) => e.id === elementId)
      if (!frame || !prevElement) return
      const prevBox = prevElement.frame

      const margins = frame.margins ?? defaultFrameMargins(frame.pageSize)
      // Only `two-page-spread` reads this (see `presetImageBox`'s doc
      // comment) — harmless to always compute since it's cheap and every
      // other preset simply ignores it.
      const spreadSide = spreadSideOf(get().project.frames, frameId)
      const nextBox = presetImageBox(preset, frame.pageSize, margins, BLEED_MM, spreadSide)
      // full-bleed is meant to crop-to-fill the page; centered/left-half/
      // two-page-spread are meant to show the whole image without
      // distortion — see the `fit` honoring in use-fabric-canvas.ts's
      // syncFrameElements.
      const nextFit: ImageElement["fit"] = preset === "full-bleed" ? "cover" : "contain"
      const prevFit = prevElement.kind === "image" ? prevElement.fit : undefined

      const doApply = () =>
        updateProject((project) => ({
          ...project,
          frames: updateElement(project.frames, frameId, elementId, (element) =>
            element.kind === "image"
              ? { ...element, frame: nextBox, fit: nextFit }
              : { ...element, frame: nextBox },
          ),
        }))

      doApply()

      pushUndo({
        do: doApply,
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: updateElement(project.frames, frameId, elementId, (element) =>
              element.kind === "image"
                ? { ...element, frame: prevBox, fit: prevFit ?? element.fit }
                : { ...element, frame: prevBox },
            ),
          })),
      })
    },

    updateElementBox: (frameId, elementId, patch) =>
      updateProject((project) => ({
        ...project,
        frames: updateElement(project.frames, frameId, elementId, (element) => ({
          ...element,
          frame: { ...element.frame, ...patch },
        })),
      })),

    moveElementToFrame: (fromFrameId, toFrameId, elementId, box) => {
      const fromFrame = get().project.frames.find((f) => f.id === fromFrameId)
      const element = fromFrame?.elements.find((e) => e.id === elementId)
      if (!fromFrame || !element) return
      const prevBox = element.frame

      const selectionFor = (frameId: string): Selection => ({
        kind: element.kind === "text" ? "text-element" : "image-element",
        frameId,
        elementId,
      })

      const doMove = () => {
        updateProject((project) => ({
          ...project,
          frames: assignToFrame(
            removeFromFrame(project.frames, fromFrameId, elementId),
            toFrameId,
            { ...element, frame: box },
          ),
        }))
        set({ selection: selectionFor(toFrameId) })
      }

      doMove()

      pushUndo({
        do: doMove,
        // Restores both which frame it belongs to and its exact prior Box
        // there — a plain `removeFromFrame`/`assignToFrame` round-trip
        // would put it back on the right page but at the destination
        // frame's Box, not the position it actually had before the drag.
        undo: () => {
          updateProject((project) => ({
            ...project,
            frames: assignToFrame(
              removeFromFrame(project.frames, toFrameId, elementId),
              fromFrameId,
              { ...element, frame: prevBox },
            ),
          }))
          set({ selection: selectionFor(fromFrameId) })
        },
      })
    },

    toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
    toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
    dismissError: () => set({ lastError: null }),
    dismissIntroduction: () => set({ introductionDismissed: true }),
    // Reopening (R32/AE9) is not tied to project state — a returning user with
    // content can still bring it back on demand.
    showIntroduction: () => set({ introductionDismissed: false }),
  }
})
