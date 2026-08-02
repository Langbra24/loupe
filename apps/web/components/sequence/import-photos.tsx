"use client"

import { useRef } from "react"
import { PlusIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
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
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Import photos"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon />
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? `Importing ${progress.done} of ${progress.total}…` : "Import photos"}
        </Button>
      )}
    </>
  )
}
