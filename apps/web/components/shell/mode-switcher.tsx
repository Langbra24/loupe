"use client"

import { cn } from "@/lib/utils"
import { MODES, useEditorStore } from "@/state/editor-store"

/**
 * Floating tab group, top-right above the canvas.
 *
 * In Sequence it stands alone — the canvas is the whole interface. In Design
 * and Print the right panel grows downward from directly beneath it, so the
 * two read as one piece of chrome rather than two.
 */
export function ModeSwitcher() {
  const mode = useEditorStore((state) => state.mode)
  const setMode = useEditorStore((state) => state.setMode)

  return (
    <div
      role="tablist"
      aria-label="Editor mode"
      className="absolute top-3 right-3 z-20 flex items-center gap-0.5 rounded-xl border bg-background/90 p-0.5 shadow-sm backdrop-blur"
    >
      {MODES.map((item) => {
        const isActive = mode === item.id
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => setMode(item.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
