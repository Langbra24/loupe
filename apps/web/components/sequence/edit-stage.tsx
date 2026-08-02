"use client"

import { useState } from "react"
import { checkPageCount } from "@loupe/core"
import { WarningIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import { useThumbnail } from "@/components/sequence/use-thumbnail"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

/**
 * Stage two: an Edit as an ordered sequence.
 *
 * Structure has increased since the canvas — this is a line of photographs in
 * a definite order. Order is set here by dragging, never inferred from where
 * things happened to sit on the table.
 */
export function EditStage() {
  const project = useEditorStore((state) => state.project)
  const activeEditId = useEditorStore((state) => state.activeEditId)
  const moveEditMember = useEditorStore((state) => state.moveEditMember)
  const removeAssetFromEdit = useEditorStore((state) => state.removeAssetFromEdit)
  const commitEditToBook = useEditorStore((state) => state.commitEditToBook)

  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)

  const edit = project.edits.find((candidate) => candidate.id === activeEditId)
  if (!edit) {
    return <Centered>No edit selected.</Centered>
  }

  const check = checkPageCount(edit.memberIds.length)

  const commit = (confirmOverwrite = false) => {
    const outcome = commitEditToBook(edit.id, confirmOverwrite)
    if (!outcome.ok && outcome.wouldOverwrite) {
      setConfirming(outcome.wouldOverwrite)
      return
    }
    setConfirming(null)
  }

  return (
    <div className="flex min-h-full flex-col gap-6 p-8 pt-16">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-lg">{edit.name}</h1>
          <p
            className={cn(
              "text-xs",
              check.isValidForSaddleStitch ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {check.message}
          </p>
        </div>

        {confirming === null ? (
          <Button
            size="sm"
            disabled={edit.memberIds.length === 0}
            onClick={() => commit()}
          >
            Commit to book
          </Button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <WarningIcon className="size-4 shrink-0 text-destructive" />
            <span className="text-xs">
              Replace the current {confirming}-page book?
            </span>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button size="xs" onClick={() => commit(true)}>
              Replace
            </Button>
          </div>
        )}
      </header>

      {edit.memberIds.length === 0 ? (
        <Centered>
          Nothing here yet. Right-click a photograph on the canvas to add it.
        </Centered>
      ) : (
        <ol className="flex flex-wrap gap-4">
          {edit.memberIds.map((assetId, index) => (
            <li
              key={assetId}
              draggable
              onDragStart={() => setDragFrom(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (dragFrom !== null && dragFrom !== index) {
                  moveEditMember(edit.id, dragFrom, index)
                }
                setDragFrom(null)
              }}
              className={cn(
                "group relative w-40 cursor-grab active:cursor-grabbing",
                dragFrom === index && "opacity-40",
              )}
            >
              <Frame assetId={assetId} />
              <div className="mt-1 flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {index + 1}
                </span>
                <button
                  onClick={() => removeAssetFromEdit(edit.id, assetId)}
                  className="ml-auto text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Frame({ assetId }: { assetId: string }) {
  const url = useThumbnail(assetId)

  return (
    <div className="flex aspect-4/3 items-center justify-center overflow-hidden rounded-md border bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="max-h-full max-w-full object-contain" />
      ) : null}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10 text-center text-sm text-muted-foreground">
      <p className="max-w-xs leading-relaxed">{children}</p>
    </div>
  )
}
