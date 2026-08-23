"use client"

import { create } from "zustand"
import {
  assignToFrame,
  createEmptyProject,
  createFrame,
  framesForBookSetup,
  layoutNewPlacements,
  removeFromFrame,
  reorderFrame,
  updateElement,
  updateFrame,
  type BookSetup,
  type Box,
  type Frame,
  type ImageElement,
  type Margins,
  type PageSize,
  type Project,
  type Selection,
  type TextElement,
} from "@loupe/core"

import { importFiles } from "@/lib/storage/assets"
import {
  loadProject,
  saveProject,
  saveProjectDebounced,
} from "@/lib/storage/project"

/**
 * One undoable step (U8). `do` replays the mutation forward; `undo` reverses
 * it. Both are plain closures over whatever state the action needs to
 * invert itself — a targeted snapshot of just what that action touched
 * (the frame array before a reorder, the placement a photograph came from),
 * not a snapshot of the whole project. This is a command stack scoped to
 * these specific canvas mutations, not a general state-snapshot/time-travel
 * system — there is no redo action consuming `do` yet; it exists so the
 * stack is symmetric and a redo can be added later without changing the
 * shape.
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
  /** Pops the most recent `UndoCommand` and runs its `undo` side. A no-op,
   *  not an error, when the stack is empty. */
  undo: () => void

  importPhotos: (files: readonly File[]) => Promise<void>
  movePlacement: (placementId: string, x: number, y: number) => void
  scalePlacement: (placementId: string, scale: number) => void
  moveToFrame: (placementId: string, frameId: string) => void
  /** A pasteboard text box (U6) finished editing over a frame's bounds —
   *  see `use-fabric-canvas.ts`'s `text:editing:exited` handler. */
  createTextElement: (frameId: string, content: string) => void

  addFrame: (pageSize: PageSize) => string
  removeFrame: (frameId: string) => void
  reorderFrameById: (from: number, to: number) => void
  /** Create the book's starting frame set from the setup dialog. A no-op if
   *  frames already exist — the dialog only ever fires once per project. */
  setupBook: (setup: BookSetup) => void

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
  updateTextElement: (
    frameId: string,
    elementId: string,
    patch: Partial<Pick<TextElement, "content" | "role" | "align">>,
  ) => void
  updateImageFit: (frameId: string, elementId: string, fit: ImageElement["fit"]) => void
  /** Bound to an element's normalized `Box` — the text sidebar's width field
   *  and the image sidebar's position/size fields both go through this. */
  updateElementBox: (frameId: string, elementId: string, patch: Partial<Box>) => void
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

  /** Append one undoable step to the stack. */
  const pushUndo = (command: UndoCommand) =>
    set((state) => ({ undoStack: [...state.undoStack, command] }))

  return {
    // Must be a valid empty project, not undefined: the server render and the
    // first client render have to agree, and hydration replaces this after
    // mount. Getting this wrong surfaces as a hydration mismatch, not an error.
    project: createEmptyProject(),
    selection: null,
    panelView: "canvas",
    undoStack: [],
    ...PANEL_DEFAULTS,
    hydrated: false,
    importProgress: null,
    lastError: null,
    introductionDismissed: false,

    hydrate: async () => {
      if (get().hydrated) return
      // A fresh load's undo stack must never reach into a previous project's
      // history (U8) — cleared unconditionally, before either branch below,
      // since there is nothing in the just-created empty project worth
      // undoing either way.
      set({ undoStack: [] })
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
      set({ undoStack: stack.slice(0, -1) })
      command.undo()
    },

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

      doMove()

      pushUndo({
        do: doMove,
        // The photograph's exact prior placement (position, scale,
        // rotation) is restored verbatim — U8's "restores it to its prior
        // frame (or pasteboard)" scenario, here the pasteboard side of it.
        undo: () =>
          updateProject((project) => ({
            ...project,
            canvas: { placements: [...project.canvas.placements, placement] },
            frames: removeFromFrame(project.frames, frameId, elementId),
          })),
      })
    },

    /**
     * A pasteboard `Textbox` (U6) finished editing with its center over a
     * frame — see `use-fabric-canvas.ts`. `role`/`align` default to `'body'`/
     * `'left'` and `frame` to the same full-bleed `{0,0,1,1}` box
     * `moveToFrame` gives a dropped photograph: there is no UI yet for
     * positioning or restyling text within its frame (that lands with U7's
     * sidebar), so the least-surprising start is "fills the page, plain
     * body text" rather than guessing at a caption-sized box.
     */
    createTextElement: (frameId, content) => {
      // Generated up front for the same reason `moveToFrame`'s is — the
      // undo closure needs the id that actually landed.
      const elementId = newId("element")
      const element: TextElement = {
        id: elementId,
        name: content.trim().slice(0, 40) || "Text",
        frame: { x: 0, y: 0, width: 1, height: 1 },
        locked: false,
        hidden: false,
        kind: "text",
        content,
        role: "body",
        align: "left",
      }

      const doCreate = () =>
        updateProject((project) => ({ ...project, frames: assignToFrame(project.frames, frameId, element) }))

      doCreate()

      pushUndo({
        do: doCreate,
        undo: () =>
          updateProject((project) => ({
            ...project,
            frames: removeFromFrame(project.frames, frameId, elementId),
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

      const doUpdate = () =>
        updateProject((project) => ({
          ...project,
          frames: updateElement(project.frames, frameId, elementId, (element) =>
            element.kind === "text" ? { ...element, ...patch } : element,
          ),
        }))

      doUpdate()

      if (patch.content !== undefined && prevContent !== undefined) {
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

    updateImageFit: (frameId, elementId, fit) =>
      updateProject((project) => ({
        ...project,
        frames: updateElement(project.frames, frameId, elementId, (element) =>
          element.kind === "image" ? { ...element, fit } : element,
        ),
      })),

    updateElementBox: (frameId, elementId, patch) =>
      updateProject((project) => ({
        ...project,
        frames: updateElement(project.frames, frameId, elementId, (element) => ({
          ...element,
          frame: { ...element.frame, ...patch },
        })),
      })),

    toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
    toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
    dismissError: () => set({ lastError: null }),
    dismissIntroduction: () => set({ introductionDismissed: true }),
    // Reopening (R32/AE9) is not tied to project state — a returning user with
    // content can still bring it back on demand.
    showIntroduction: () => set({ introductionDismissed: false }),
  }
})
