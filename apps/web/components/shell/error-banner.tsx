"use client"

import { WarningIcon, XIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/state/editor-store"

/**
 * Surfaces the store's error channel.
 *
 * Without this the channel had no outlet: a failed import, exhausted quota, a
 * save that could not complete, or an unavailable IndexedDB all set `lastError`
 * and the user saw nothing at all. For a tool whose only copy of the work is
 * local, a silent storage failure is the worst possible silence.
 *
 * Bottom-left because the canvas controls own the bottom-right and the mode
 * switcher owns the top-right.
 */
export function ErrorBanner() {
  const lastError = useEditorStore((state) => state.lastError)
  const dismissError = useEditorStore((state) => state.dismissError)

  if (!lastError) return null

  return (
    <div
      role="alert"
      className="absolute bottom-3 left-3 z-30 flex max-w-sm items-start gap-2 rounded-lg border border-destructive/40 bg-background/95 px-3 py-2 shadow-lg backdrop-blur"
    >
      <WarningIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="flex-1 text-xs leading-relaxed">{lastError}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={dismissError}
      >
        <XIcon />
      </Button>
    </div>
  )
}
