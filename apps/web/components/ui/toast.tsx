"use client"

import { Toast as ToastPrimitive } from "@base-ui/react/toast"

import { cn } from "@/lib/utils"

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

  return toasts.map((toast) => (
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
  ))
}

/** The hook callers use to actually fire a toast — `useToastManager().add({ title, description })`. */
const useToastManager = ToastPrimitive.useToastManager

export { ToastProvider, ToastViewport, useToastManager }
