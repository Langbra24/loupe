"use client"

import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react"
import { Toast as ToastPrimitive } from "@base-ui/react/toast"

import { cn } from "@/lib/utils"

/**
 * `ToastObject.type` (shadcn's `base/toast` reference — ui.shadcn.com/docs/
 * components/base/toast) is a free-form string on Base UI's own primitive;
 * shadcn's docs list success/info/warning/error/loading with "status icons"
 * as the convention, but the icon rendering itself is each consumer's own
 * addition on top of the primitive, not something Base UI provides. This is
 * that addition — `loading` gets a spinner (handled separately below, since
 * it animates rather than picking a static icon), the other three map here.
 * `info` has no icon of its own in this project (no dedicated info color
 * token exists, and nothing calls `type: "info"` yet) — add one the same
 * way if a caller needs it.
 */
const TOAST_TYPE_ICONS: Record<string, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: XCircleIcon,
  warning: WarningCircleIcon,
}

const TOAST_TYPE_COLORS: Record<string, string> = {
  success: "text-emerald-400",
  error: "text-destructive",
  warning: "text-amber-400",
}

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />
}

/** Fixed to the bottom-right, above everything else in the shell (`z-50`,
 *  matching the popover/tooltip layer) — never anchored to the trigger that
 *  created it, since a toast is meant to read as coming from the app itself. */
function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Portal>
      <ToastPrimitive.Viewport
        data-slot="toast-viewport"
        className={cn(
          "fixed right-4 bottom-4 z-50 mx-auto flex w-[calc(100vw-2rem)] flex-col sm:w-90",
          className
        )}
        {...props}
      >
        <ToastList />
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Portal>
  )
}

/** One `Toast.Root` per live toast — `useToastManager` (re-exported below)
 *  is how callers actually create one (`toast.add({ title, description })`),
 *  this just renders whatever the manager is currently holding. */
function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager()

  return toasts.map((toast) => {
    const TypeIcon = toast.type ? TOAST_TYPE_ICONS[toast.type] : undefined

    return (
      <ToastPrimitive.Root
        key={toast.id}
        toast={toast}
        data-slot="toast"
        className={cn(
          "[--gap:0.5rem] [--offset-y:calc(var(--toast-offset-y)*-1+(var(--toast-index)*var(--gap)*-1))]",
          "absolute right-0 bottom-0 left-0 z-[calc(1000-var(--toast-index))] origin-bottom rounded-xl border bg-popover text-popover-foreground shadow-lg",
          "transition-[transform,opacity] duration-300 ease-out",
          "[transform:translateY(var(--offset-y))_scale(calc(1-(var(--toast-index)*0.05)))]",
          "data-expanded:[transform:translateY(var(--offset-y))]",
          "data-starting-style:translate-y-4 data-starting-style:opacity-0",
          "data-ending-style:opacity-0",
          "motion-reduce:transition-none"
        )}
      >
        <ToastPrimitive.Content className="flex items-start gap-3 p-3">
          {toast.type === "loading" ? (
            <CircleNotchIcon className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
          ) : TypeIcon ? (
            <TypeIcon className={cn("mt-0.5 size-4 shrink-0", TOAST_TYPE_COLORS[toast.type!])} weight="fill" />
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <ToastPrimitive.Title className="text-sm font-medium" />
            <ToastPrimitive.Description className="text-xs text-muted-foreground" />
          </div>
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            ×
          </ToastPrimitive.Close>
        </ToastPrimitive.Content>
      </ToastPrimitive.Root>
    )
  })
}

/** The hook callers use to actually fire a toast — `useToastManager().add({ title, description })`. */
const useToastManager = ToastPrimitive.useToastManager

export { ToastProvider, ToastViewport, useToastManager }
