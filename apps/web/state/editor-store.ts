"use client"

import { create } from "zustand"
import {
  assignToFrame,
  createEmptyProject,
  createFrame,
  framesForBookSetup,
  layoutNewPlacements,
  movePage,
  pageNumber,
  reorderFrame,
  type BookSetup,
  type ImageElement,
  type PageId,
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
 * The three modes exist because they are three different cognitive tasks.
 * See docs/plans/00-initial-build-brief.md.
 */
export type Mode = "sequence" | "design" | "print"

export const MODES: { id: Mode; label: string }[] = [
  { id: "sequence", label: "Sequence" },
  { id: "design", label: "Design" },
  { id: "print", label: "Print" },
]

interface EditorState {
  project: Project
  mode: Mode
  selection: Selection
  /** Which spread Design view is scoped to. */
  activeSpreadIndex: number
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
  setMode: (mode: Mode) => void

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

  selectPage: (pageId: PageId) => void
  selectElement: (pageId: PageId, elementId: string) => void
  clearSelection: () => void
  setActiveSpread: (index: number) => void
  openPageInDesign: (pageId: PageId) => void
  reorderPage: (from: number, to: number) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  dismissError: () => void
  dismissIntroduction: () => void
  showIntroduction: () => void
}

/**
 * Panel state follows the mode. Sequence keeps the left panel open for
 * navigation — that is not editing chrome, so the brief's "no editing chrome
 * while sequencing" principle still holds.
 */
function panelDefaults(mode: Mode): { leftPanelOpen: boolean; rightPanelOpen: boolean } {
  if (mode === "sequence") return { leftPanelOpen: true, rightPanelOpen: false }
  return { leftPanelOpen: true, rightPanelOpen: true }
}

/** Reading order → spread index. Page 1 sits alone in spread 0. Mirrors
 *  `toSpreads` in @loupe/core. */
function spreadIndexForPage(index: number): number {
  if (index <= 0) return 0
  return Math.floor((index - 1) / 2) + 1
}

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

  return {
    // Must be a valid empty project, not undefined: the server render and the
    // first client render have to agree, and hydration replaces this after
    // mount. Getting this wrong surfaces as a hydration mismatch, not an error.
    project: createEmptyProject(),
    mode: "sequence",
    selection: null,
    activeSpreadIndex: 0,
    ...panelDefaults("sequence"),
    hydrated: false,
    importProgress: null,
    lastError: null,
    introductionDismissed: false,

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const { project, migrationError } = await loadProject()
        set({ project, hydrated: true, lastError: migrationError })
      } catch {
        // An unavailable IndexedDB (private mode, blocked storage) should not
        // brick the app — the session just will not survive a reload.
        set({ hydrated: true, lastError: "Local storage is unavailable — work will not be saved" })
      }
    },

    setMode: (mode) => set({ mode, ...panelDefaults(mode) }),

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
      updateProject((project) => {
        const placement = project.canvas.placements.find((p) => p.id === placementId)
        if (!placement) return project

        const asset = project.assets.find((a) => a.id === placement.assetId)
        if (!asset) return project

        const element: ImageElement = {
          id: newId("element"),
          name: asset.name,
          // Fills the frame edge-to-edge by default. There is no UI yet for
          // repositioning a photo within its frame once it lands — that is
          // later units' concern (design mode / the sidebar) — so a
          // full-bleed box with `cover` fit is the least surprising start.
          frame: { x: 0, y: 0, width: 1, height: 1 },
          locked: false,
          hidden: false,
          kind: "image",
          assetId: placement.assetId,
          fit: "cover",
        }

        return {
          ...project,
          canvas: {
            placements: project.canvas.placements.filter((p) => p.id !== placementId),
          },
          frames: assignToFrame(project.frames, frameId, element),
        }
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
      updateProject((project) => {
        const element: TextElement = {
          id: newId("element"),
          name: content.trim().slice(0, 40) || "Text",
          frame: { x: 0, y: 0, width: 1, height: 1 },
          locked: false,
          hidden: false,
          kind: "text",
          content,
          role: "body",
          align: "left",
        }

        return { ...project, frames: assignToFrame(project.frames, frameId, element) }
      })
    },

    addFrame: (pageSize) => {
      const id = newId("frame")
      updateProject((project) => ({
        ...project,
        frames: [...project.frames, createFrame(id, pageSize, project.frames.length)],
      }))
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
      updateProject((project) => ({
        ...project,
        frames: project.frames
          .filter((frame) => frame.id !== frameId)
          // Re-derive position from the resulting order — reorderFrame leaves
          // the array as the source of truth and expects callers to do this.
          .map((frame, index) => ({ ...frame, position: index })),
      }))
    },

    reorderFrameById: (from, to) => {
      updateProject((project) => ({
        ...project,
        frames: reorderFrame(project.frames, from, to).map((frame, index) => ({
          ...frame,
          position: index,
        })),
      }))
    },

    selectPage: (pageId) => set({ selection: { kind: "page", pageId } }),

    selectElement: (pageId, elementId) =>
      set({ selection: { kind: "element", pageId, elementId } }),

    clearSelection: () => set({ selection: null }),

    setActiveSpread: (index) => set({ activeSpreadIndex: index }),

    openPageInDesign: (pageId) => {
      const index = pageNumber(get().project.pages, pageId)
      if (index < 0) return
      set({
        mode: "design",
        activeSpreadIndex: spreadIndexForPage(index),
        selection: { kind: "page", pageId },
        ...panelDefaults("design"),
      })
    },

    reorderPage: (from, to) =>
      updateProject((project) => ({ ...project, pages: movePage(project.pages, from, to) })),

    toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
    toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
    dismissError: () => set({ lastError: null }),
    dismissIntroduction: () => set({ introductionDismissed: true }),
    // Reopening (R32/AE9) is not tied to project state — a returning user with
    // content can still bring it back on demand.
    showIntroduction: () => set({ introductionDismissed: false }),
  }
})
