"use client"

import { create } from "zustand"
import {
  addToEdit,
  checkPageCount,
  commitEditToPages,
  createEdit,
  createEmptyProject,
  duplicateEdit,
  layoutNewPlacements,
  movePage,
  pageNumber,
  removeFromEdit,
  renameEdit,
  reorderEditMember,
  type Edit,
  type PageId,
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

/**
 * Stages inside Sequence mode — a funnel, not a toggle. Structure increases at
 * each step: loose on the canvas, ordered in an edit, paginated in the book.
 * These are sub-views of one cognitive task, which is why they are not a fourth
 * top-level mode.
 */
export type SequenceStage = "canvas" | "edit" | "book"

export interface CommitOutcome {
  ok: boolean
  /** Set when the commit was refused because it would replace an existing book. */
  wouldOverwrite?: number
  message?: string
}

interface EditorState {
  project: Project
  mode: Mode
  sequenceStage: SequenceStage
  activeEditId: string | null
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
  setSequenceStage: (stage: SequenceStage, editId?: string) => void

  importPhotos: (files: readonly File[]) => Promise<void>
  movePlacement: (placementId: string, x: number, y: number) => void
  scalePlacement: (placementId: string, scale: number) => void

  newEdit: (name?: string) => string
  addAssetToEdit: (editId: string, assetId: string) => void
  newEditFromAsset: (assetId: string) => string
  removeAssetFromEdit: (editId: string, assetId: string) => void
  moveEditMember: (editId: string, from: number, to: number) => void
  renameEditById: (editId: string, name: string) => void
  duplicateEditById: (editId: string) => void
  deleteEdit: (editId: string) => void
  commitEditToBook: (editId: string, confirmOverwrite?: boolean) => CommitOutcome

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
 * Panel state follows the mode. Sequence keeps the left panel open because the
 * workflow tree lives there — that is navigation, not editing chrome, so the
 * brief's "no editing chrome while sequencing" principle still holds.
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

  const updateEdit = (editId: string, mutate: (edit: Edit) => Edit) =>
    updateProject((project) => ({
      ...project,
      edits: project.edits.map((edit) => (edit.id === editId ? mutate(edit) : edit)),
    }))

  return {
    // Must be a valid empty project, not undefined: the server render and the
    // first client render have to agree, and hydration replaces this after
    // mount. Getting this wrong surfaces as a hydration mismatch, not an error.
    project: createEmptyProject(),
    mode: "sequence",
    sequenceStage: "canvas",
    activeEditId: null,
    selection: null,
    activeSpreadIndex: 0,
    ...panelDefaults("sequence"),
    hydrated: false,
    importProgress: null,
    lastError: null,

    hydrate: async () => {
      if (get().hydrated) return
      try {
        const project = await loadProject()
        set({ project, hydrated: true, activeEditId: project.edits[0]?.id ?? null })
      } catch {
        // An unavailable IndexedDB (private mode, blocked storage) should not
        // brick the app — the session just will not survive a reload.
        set({ hydrated: true, lastError: "Local storage is unavailable — work will not be saved" })
      }
    },

    setMode: (mode) => set({ mode, ...panelDefaults(mode) }),

    setSequenceStage: (stage, editId) => {
      const state = get()
      if (stage === "edit") {
        const target = editId ?? state.activeEditId ?? state.project.edits[0]?.id ?? null
        if (!target) {
          set({ sequenceStage: "canvas" })
          return
        }
        set({ sequenceStage: "edit", activeEditId: target })
        return
      }
      set({ sequenceStage: stage })
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

    newEdit: (name) => {
      const id = newId("edit")
      const index = get().project.edits.length + 1
      updateProject((project) => ({
        ...project,
        edits: [...project.edits, createEdit(id, name ?? `Edit ${index}`, Date.now())],
      }))
      set({ activeEditId: id })
      return id
    },

    addAssetToEdit: (editId, assetId) => {
      updateEdit(editId, (edit) => addToEdit(edit, assetId))
    },

    newEditFromAsset: (assetId) => {
      const id = get().newEdit()
      get().addAssetToEdit(id, assetId)
      return id
    },

    removeAssetFromEdit: (editId, assetId) => {
      updateEdit(editId, (edit) => removeFromEdit(edit, assetId))
    },

    moveEditMember: (editId, from, to) => {
      updateEdit(editId, (edit) => reorderEditMember(edit, from, to))
    },

    renameEditById: (editId, name) => {
      updateEdit(editId, (edit) => renameEdit(edit, name))
    },

    duplicateEditById: (editId) => {
      const source = get().project.edits.find((edit) => edit.id === editId)
      if (!source) return
      const copy = duplicateEdit(source, newId("edit"), Date.now())
      updateProject((project) => ({ ...project, edits: [...project.edits, copy] }))
      set({ activeEditId: copy.id })
    },

    deleteEdit: (editId) => {
      updateProject((project) => ({
        ...project,
        edits: project.edits.filter((edit) => edit.id !== editId),
      }))

      // Never leave a dangling active id pointing at a deleted edit.
      if (get().activeEditId === editId) {
        const fallback = get().project.edits[0]?.id ?? null
        set({
          activeEditId: fallback,
          sequenceStage: fallback ? get().sequenceStage : "canvas",
        })
      }
    },

    commitEditToBook: (editId, confirmOverwrite = false) => {
      const state = get()
      const edit = state.project.edits.find((candidate) => candidate.id === editId)
      if (!edit) return { ok: false, message: "That edit no longer exists" }

      const existing = state.project.pages.length
      if (existing > 0 && !confirmOverwrite) {
        return { ok: false, wouldOverwrite: existing }
      }

      const pages = commitEditToPages(edit, state.project.assets, newId("commit"))
      updateProject((project) => ({ ...project, pages }), { immediate: true })
      set({ sequenceStage: "book", selection: null, activeSpreadIndex: 0 })

      return { ok: true, message: checkPageCount(pages.length).message }
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
