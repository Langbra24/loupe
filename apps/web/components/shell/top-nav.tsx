"use client"

import { ArrowSquareOutIcon, ExportIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"

/**
 * Fixed app chrome. This never moves, hides, or reflows between modes — it is
 * the thing the user stays oriented within while the canvas underneath
 * changes shape.
 */
export function TopNav() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <span className="font-heading text-base font-medium tracking-tight">Loupe</span>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm">
          <ArrowSquareOutIcon data-icon="inline-start" />
          Share
        </Button>
        {/* Eventually the $5 / $15 payment gate. Inert in the shell. */}
        <Button size="sm">
          <ExportIcon data-icon="inline-start" />
          Export
        </Button>
      </div>
    </header>
  )
}
