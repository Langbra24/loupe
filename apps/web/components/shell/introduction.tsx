"use client"

import { BookOpenIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/state/editor-store"

/**
 * The empty-canvas introduction (R25).
 *
 * Rendered as a direct sibling of the canvas region (see app-shell.tsx) so its
 * `absolute inset-0` sizes to the whole shell rather than to whatever small
 * wrapper the bottom-left controls happen to sit in — {@link IntroductionReopenButton}
 * is a separate export for exactly that reason, so it can be placed inside
 * that row alongside the feedback control (R32) without dragging the overlay
 * along with it.
 *
 * "Dismissed" and "the project has content" are two different things: a
 * returning bookmaker with photographs already imported can still reopen this
 * via the control beside feedback (AE9), which a rule keyed only on project
 * emptiness could never express — hence the separate `introductionDismissed`
 * flag rather than deriving visibility from `project` alone.
 */
export function Introduction() {
  const dismissed = useEditorStore((state) => state.introductionDismissed)
  const isEmptyProject = useEditorStore(
    (state) => state.project.frames.length === 0 && state.project.assets.length === 0,
  )
  const dismissIntroduction = useEditorStore((state) => state.dismissIntroduction)

  const shouldShowOverlay = !dismissed && isEmptyProject
  if (!shouldShowOverlay) return null

  return (
    <div
      role="dialog"
      aria-label="About Loupe"
      className="absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="relative flex max-w-md flex-col gap-3 rounded-2xl border bg-card p-6 shadow-lg">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss introduction"
          className="absolute top-2 right-2"
          onClick={dismissIntroduction}
        >
          <XIcon />
        </Button>

        <h1 className="font-heading text-lg font-medium">Loupe</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Loupe is an open experiment in growing software with the people who use it — a
          browser-based tool for sequencing, designing, and print-imposing a photobook or zine,
          built in the open rather than behind a roadmap nobody outside the project can see.
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          It is early, and it will keep changing shape based on what the people actually using it
          need. Import some photographs to get started, and use the feedback control in this
          corner any time something feels wrong, missing, or confusing — that is how this gets
          built.
        </p>

        <Button onClick={dismissIntroduction} className="self-start">
          Get started
        </Button>
      </div>
    </div>
  )
}

/** The permanent way back (R32, AE9) — lives beside the feedback control in
 *  the bottom-left corner regardless of whether the overlay above is showing
 *  or the project has content. */
export function IntroductionReopenButton() {
  const showIntroduction = useEditorStore((state) => state.showIntroduction)

  return (
    <Button variant="secondary" size="icon-sm" aria-label="About Loupe" onClick={showIntroduction}>
      <BookOpenIcon />
    </Button>
  )
}
