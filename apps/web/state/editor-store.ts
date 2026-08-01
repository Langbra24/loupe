"use client"

import { create } from "zustand"
import {
  createSampleProject,
  movePage,
  pageNumber,
  type PageId,
  type Project,
  type Selection,
} from "@loupe/core"

/**
 * The three modes exist because they are three different cognitive tasks, not
 * three toolbars. See docs/plans/00-initial-build-brief.md.
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
  /** Which spread Design view is scoped to. Design work happens one spread at
   *  a time — that is the whole point of the mode. */
  activeSpreadIndex: number
  leftPanelOpen: boolean
  rightPanelOpen: boolean

  setMode: (mode: Mode) => void
  selectPage: (pageId: PageId) => void
  selectElement: (pageId: PageId, elementId: string) => void
  clearSelection: () => void
  setActiveSpread: (index: number) => void
  /** Open the given page in Design view — the Sequence → Design handoff. */
  openPageInDesign: (pageId: PageId) => void
  reorderPage: (from: number, to: number) => void
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
}

/** Panel state follows the mode by default: Sequence hides all editing chrome,
 *  because removing friction is the entire reason that mode exists. The user
 *  can still override with the panel toggles afterwards. */
function panelDefaults(mode: Mode): { leftPanelOpen: boolean; rightPanelOpen: boolean } {
  if (mode === "sequence") return { leftPanelOpen: false, rightPanelOpen: false }
  return { leftPanelOpen: true, rightPanelOpen: true }
}

/** Reading order → spread index. Page 1 sits alone in spread 0; every pair
 *  after that shares one. Mirrors `toSpreads` in @loupe/core. */
function spreadIndexForPage(index: number): number {
  if (index <= 0) return 0
  return Math.floor((index - 1) / 2) + 1
}

export const useEditorStore = create<EditorState>((set, get) => ({
  project: createSampleProject(),
  mode: "sequence",
  selection: null,
  activeSpreadIndex: 1,
  ...panelDefaults("sequence"),

  setMode: (mode) => set({ mode, ...panelDefaults(mode) }),

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
    set((state) => ({
      project: { ...state.project, pages: movePage(state.project.pages, from, to) },
    })),

  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
}))
