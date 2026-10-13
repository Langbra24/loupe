"use client"

import { ExportDialog } from "@/components/shell/export-dialog"

/**
 * Fixed app chrome. This never moves, hides, or reflows between modes — it is
 * the thing the user stays oriented within while the canvas underneath
 * changes shape.
 */
export function TopNav() {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b bg-background px-4">
      <span className="font-heading text-base font-medium tracking-tight">Loupe</span>

      {/* Eventually the $5 / $15 payment gate. Renders the book and
          downloads it directly for now — see export-dialog.tsx. */}
      <ExportDialog />
    </header>
  )
}
