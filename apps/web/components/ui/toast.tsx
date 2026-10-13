"use client"

import {
  CheckCircleIcon,
  InfoIcon,
  SpinnerIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * Direct follow-up: the stacking and enter/exit animation here were both
 * wrong — toasts piled up as a plain vertical list instead of a collapsed
 * "peek" stack, and they just appeared/disappeared instead of sliding in
 * from the bottom and back out. Root-caused against the actual shadcn
 * `base/toast` reference (ui.shadcn.com/docs/components/base/toast) —
 * pulled its real source from shadcn-ui/ui
 * (apps/v4/registry/bases/base/ui/toast.tsx) rather than guess, since the
 * original version of this file had clearly drifted from it: the collapsed
 * (resting) state was reusing the *expanded* transform verbatim, which is
 * why every toast rendered fully spread apart all the time instead of
 * tucked behind the frontmost one.
 *
 * The fix carries over the reference's actual mechanism almost verbatim
 * (see `Toast` below): `--scale`/`--shrink`/`--peek` drive the collapsed
 * stack (each toast behind the front one scaled down ~10% and tucked up
 * behind it), `--offset-y` (Base UI's own measured spacing) only takes
 * over once `data-expanded` is set (hover), and `data-starting-style`/
 * `data-ending-style` both resolve to `translateY(150%)` — i.e. enter and
 * exit both happen relative to the toast's own height, sliding fully in
 * from below and fully back out below, not a fixed pixel nudge. One
 * genuine adaptation to this app rather than a copy: `rounded-xl` is kept
 * (the reference has no rounding at all) to match every other surface in
 * this app's own popover/card language, which the raw reference doesn't
 * have to answer to.
 */
const TOAST_TYPE_ICONS: Record<string, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  info: InfoIcon,
  warning: WarningIcon,
  error: XCircleIcon,
}

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />
}

/** Fixed to the bottom-right, above everything else in the shell (`z-50`,
 *  matching the popover/tooltip layer) — never anchored to the trigger that
 *  created it, since a toast is meant to read as coming from the app itself.
 *  `pointer-events-none` here (with `pointer-events-auto` on each `Toast`
 *  below) is the reference's own trick for letting clicks pass through the
 *  viewport's own empty space above/around the stack while the toasts
 *  themselves stay clickable. */
function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className={cn(
          "pointer-events-none fixed right-4 bottom-4 z-50 mx-auto flex w-[calc(100vw-2rem)] flex-col outline-none sm:w-90",
          className
        )}
        {...props}
      >
        <ToastList />
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

/** One toast's own root — the collapsed/expanded stack math and the
 *  enter/exit slide, all as CSS custom properties Base UI keeps live on
 *  this element (`--toast-index`, `--toast-offset-y`, `--toast-height`,
 *  `--toast-frontmost-height`, `--toast-swipe-movement-*`). See this
 *  file's top doc comment for where this came from and why. */
function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom rounded-xl border bg-popover text-popover-foreground shadow-lg will-change-transform outline-none select-none focus-ring",
        "[--gap:0.75rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.75rem] [--scale:calc(max(0,1-(var(--toast-index)*0.1)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_500ms_cubic-bezier(0.22,1,0.36,1),opacity_500ms,height_150ms]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0 data-starting-style:[transform:translateY(150%)]",
        "[&[data-ending-style]:not([data-limited]):not([data-swipe-direction])]:[transform:translateY(150%)]",
        "data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "motion-reduce:transition-none",
        className
      )}
      {...props}
    />
  )
}

/** A background toast's content stays invisible until the stack expands
 *  (`data-behind`) — only the frontmost card's title/description show
 *  while collapsed, matching what's actually visible of a tucked-behind
 *  card (just its top edge). */
function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-start gap-3 overflow-hidden p-3 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return <ToastPrimitive.Title data-slot="toast-title" className={cn("text-sm font-medium", className)} {...props} />
}

function ToastDescription({ className, ...props }: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

/** Renders an action button when a toast was `.add()`ed with `actionProps`
 *  — unused by any caller yet, but part of the primitive's real capability
 *  (per the reference), so it's here rather than missing entirely. */
function ToastAction({ className, render = <Button variant="outline" size="sm" />, ...props }: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action data-slot="toast-action" render={render} className={cn("shrink-0", className)} {...props} />
  )
}

function ToastClose({ className, ...props }: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Dismiss"
      className={cn(
        "shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-ring",
        className
      )}
      {...props}
    >
      <XIcon className="size-4" />
    </ToastPrimitive.Close>
  )
}

/** The status icon a `type` (`success`/`info`/`warning`/`error`/`loading`)
 *  renders — `loading` gets a spinning glyph instead of a static one from
 *  `TOAST_TYPE_ICONS`, since it's the one type that animates rather than
 *  picks a shape. `error` is the only type with a deliberate color
 *  (`text-destructive`) rather than inheriting the toast's own text color —
 *  matching the reference, which does the same. */
function ToastIcon({ type }: { type: string | undefined }) {
  if (type === "loading") {
    return <SpinnerIcon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden />
  }

  const Icon = type ? TOAST_TYPE_ICONS[type] : undefined
  if (!Icon) return null

  return (
    <Icon
      weight="fill"
      className={cn("mt-0.5 size-4 shrink-0", type === "error" && "text-destructive")}
      aria-hidden
    />
  )
}

/** One `Toast` per live toast — `useToastManager` (re-exported below) is
 *  how callers actually create one (`toast.add({ title, description })`),
 *  this just renders whatever the manager is currently holding. */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toastItem) => (
    <Toast key={toastItem.id} toast={toastItem}>
      <ToastContent>
        <ToastIcon type={toastItem.type} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastTitle />
          <ToastDescription />
        </div>
        {toastItem.actionProps ? <ToastAction {...toastItem.actionProps} /> : null}
        <ToastClose />
      </ToastContent>
    </Toast>
  ))
}

/** The hook callers use to actually fire a toast — `useToastManager().add({ title, description })`. */
const useToastManager = ToastPrimitive.useToastManager

export { ToastProvider, ToastViewport, useToastManager }
