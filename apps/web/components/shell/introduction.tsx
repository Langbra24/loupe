"use client"

import { useEffect, useRef } from "react"
import { BookOpenIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { stagger } from "@/lib/utils"
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
 *
 * Content is split into four `.stagger-section` pieces (what it is, who built
 * it, why it exists, then the button) that cascade in on mount — see the
 * entrance-animation comment in globals.css. Splitting the copy this way
 * isn't just for the animation: it's also why the copy below stays terse —
 * each piece has to read as a single complete beat on its own.
 */
export function Introduction() {
  const shouldShowOverlay = useIntroductionShowing()
  const dismissIntroduction = useEditorStore((state) => state.dismissIntroduction)
  const getStartedRef = useRef<HTMLButtonElement>(null)

  // Keyboard focus starts on the overlay's main action (#45). What the
  // overlay covers is made inert in app-shell.tsx; the top nav stays live,
  // for the keyboard as for the mouse.
  useEffect(() => {
    if (shouldShowOverlay) getStartedRef.current?.focus()
  }, [shouldShowOverlay])

  if (!shouldShowOverlay) return null

  return (
    // Escape does what the X does (#56). Handled on the overlay, not the
    // window: it isn't modal, so Escape pressed in the top nav (still live)
    // belongs to whatever has focus there.
    <div
      role="dialog"
      aria-label="About Loupe"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.stopPropagation()
        dismissIntroduction()
      }}
      className="intro-overlay absolute inset-0 z-40 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <div className="intro-dialog relative flex max-w-md flex-col gap-3 rounded-2xl border bg-card p-6 shadow-lg">
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss introduction"
          className="absolute top-2 right-2 before:absolute before:-inset-1"
          onClick={dismissIntroduction}
        >
          <XIcon />
        </Button>

        <div className="stagger-section flex flex-col gap-1.5" style={stagger(0)}>
          <h1 className="font-heading text-lg font-medium">Loupe</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            A browser-based tool for sequencing, designing, and print-imposing a photobook or
            zine — no InDesign required.
          </p>
        </div>

        {/* Geist is loaded without an italic, so the name is emphasised by
            colour and weight, not a slant the browser would have to fake. */}
        <p className="stagger-section text-sm leading-relaxed text-muted-foreground" style={stagger(1)}>
          Built in the open by <em className="font-medium text-foreground not-italic">Brandon Lang</em>.
        </p>

        <p className="stagger-section text-sm leading-relaxed text-muted-foreground" style={stagger(2)}>
          It&apos;s early, and it&apos;ll keep changing shape based on what people actually
          building books with it need. Import some photographs to get started, and use the
          feedback control in this corner any time something feels wrong, missing, or confusing —
          that&apos;s how this gets built.
        </p>

        <Button
          ref={getStartedRef}
          onClick={dismissIntroduction}
          className="stagger-section self-start"
          style={stagger(3)}
        >
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

/** Whether the introduction overlay is up. app-shell.tsx uses it to make
 *  the panels and canvas it covers inert. */
export function useIntroductionShowing(): boolean {
  // Before hydration the store holds a placeholder empty project, which says
  // nothing about whether this bookmaker has a book (#59).
  const hydrated = useEditorStore((state) => state.hydrated)
  const dismissed = useEditorStore((state) => state.introductionDismissed)
  const isEmptyProject = useEditorStore(
    (state) => state.project.frames.length === 0 && state.project.assets.length === 0,
  )
  return hydrated && !dismissed && isEmptyProject
}
