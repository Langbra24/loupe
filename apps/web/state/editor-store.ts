"use client"

import { create } from "zustand"
import {
  createEmptyProject,
  createFrame,
  layoutNewPlacements,
  movePage,
  pageNumber,
  reorderFrame,
  type PageId,
  type PageSize,
  type Project,
  type Selection,
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

  hydrate: () => Promise<void>
  setMode: (mode: Mode) => void

  importPhotos: (files: readonly File[]) => Promise<void>
  movePlacement: (placementId: string, x: number, y: number) => void
  scalePlacement: (placementId: string, scale: number) => void

  addFrame: (pageSize: PageSize) => string
  removeFrame: (frameId: string) => void
  reorderFrameById: (from: number, to: number) => void

  selectPage: (pageId: PageId) => void
  selectElement: (pageId: PageId, elementId: string) => void
  clearSelection: () => void
  setActiveSpread: (index: number) => void
  openPageInDesign: (pageId: PageId) => void
  reorderPage: (from: number, to: number) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  dismissError: () => void
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

    addFrame: (pageSize) => {
      const id = newId("frame")
      updateProject((project) => ({
        ...project,
        frames: [...project.frames, createFrame(id, pageSize, project.frames.length)],
      }))
      return id
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
  }
})
