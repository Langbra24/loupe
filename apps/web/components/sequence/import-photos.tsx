"use client"

import { useRef } from "react"
import { PlusIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useEditorStore } from "@/state/editor-store"

type Variant = "primary" | "icon"

/**
 * The one way photographs get into a project.
 *
 * This owns its own hidden input so it can be dropped anywhere. It previously
 * lived inside the canvas empty state, which meant the affordance vanished the
 * moment the first photograph landed and there was no way to add a second.
 */
export function ImportPhotosButton({ variant = "primary" }: { variant?: Variant }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const importPhotos = useEditorStore((state) => state.importPhotos)
  const progress = useEditorStore((state) => state.importProgress)

  const busy = progress !== null
  // The widest the progress label gets, in tabular 8s: every count up to
  // 999 fits, so the button is already this wide at rest and doesn't grow
  // when an import starts or as the count ticks.
  const digits = Math.max(String(progress?.total ?? 0).length, 3)
  const widest = `Importing ${"8".repeat(digits)} of ${"8".repeat(digits)}…`

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // Reset so re-picking the same file still fires a change event.
          event.target.value = ""
          void importPhotos(files)
        }}
      />

      {variant === "icon" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Import photos"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <PlusIcon />
              </Button>
            }
          />
          <TooltipContent>Import photos</TooltipContent>
        </Tooltip>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          <span className="grid justify-items-center tabular-nums">
            <span aria-hidden className="invisible col-start-1 row-start-1">
              {widest}
            </span>
            <span className="col-start-1 row-start-1">
              {busy ? `Importing ${progress.done} of ${progress.total}…` : "Import photos"}
            </span>
          </span>
        </Button>
      )}
    </>
  )
}
