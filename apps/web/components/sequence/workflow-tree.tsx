"use client"

import { useState } from "react"
import {
  BookOpenIcon,
  CaretDownIcon,
  CaretRightIcon,
  CopyIcon,
  ImagesIcon,
  PlusIcon,
  StackIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import type { Asset, Edit } from "@loupe/core"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useEditorStore, type SequenceStage } from "@/state/editor-store"

/**
 * The workflow tree — Sequence mode's left panel.
 *
 * Same structural mental model as the Design mode layers panel, applied to the
 * book rather than to one page: the three stages of the funnel as a hierarchy
 * you navigate. This is a map of the work, not editing chrome, which is why it
 * can live here without contradicting "no chrome while sequencing".
 */
export function WorkflowTree() {
  const project = useEditorStore((state) => state.project)
  const stage = useEditorStore((state) => state.sequenceStage)
  const activeEditId = useEditorStore((state) => state.activeEditId)
  const setSequenceStage = useEditorStore((state) => state.setSequenceStage)
  const newEdit = useEditorStore((state) => state.newEdit)

  const [expanded, setExpanded] = useState(true)

  return (
    <div className="flex flex-col gap-0.5 px-2 pb-3">
      <Node
        icon={<ImagesIcon className="size-3.5" />}
        label="Canvas"
        count={project.assets.length}
        active={stage === "canvas"}
        onClick={() => setSequenceStage("canvas")}
      />

      <div className="flex items-center">
        <button
          onClick={() => setExpanded((open) => !open)}
          className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-foreground/90 hover:bg-muted"
        >
          {expanded ? (
            <CaretDownIcon className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <CaretRightIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <StackIcon className="size-3.5 shrink-0 text-muted-foreground" />
          Edits
          <span className="ml-auto font-mono text-xs text-muted-foreground">
            {project.edits.length}
          </span>
        </button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="New edit"
          onClick={() => newEdit()}
        >
          <PlusIcon />
        </Button>
      </div>

      {expanded && (
        <div className="flex flex-col gap-0.5">
          {project.edits.length === 0 && (
            <p className="px-2 py-1 pl-8 text-xs text-muted-foreground">
              Right-click a photo to start one.
            </p>
          )}
          {project.edits.map((edit) => (
            <EditNode
              key={edit.id}
              edit={edit}
              assets={project.assets}
              active={stage === "edit" && activeEditId === edit.id}
            />
          ))}
        </div>
      )}

      <Node
        icon={<BookOpenIcon className="size-3.5" />}
        label="Book"
        count={project.pages.length}
        active={stage === "book"}
        onClick={() => setSequenceStage("book")}
      />
    </div>
  )
}

function EditNode({
  edit,
  assets,
  active,
}: {
  edit: Edit
  assets: readonly Asset[]
  active: boolean
}) {
  const setSequenceStage = useEditorStore((state) => state.setSequenceStage)
  const moveEditMember = useEditorStore((state) => state.moveEditMember)
  const duplicateEditById = useEditorStore((state) => state.duplicateEditById)
  const deleteEdit = useEditorStore((state) => state.deleteEdit)
  const renameEditById = useEditorStore((state) => state.renameEditById)

  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)

  const nameOf = (assetId: string) =>
    assets.find((asset) => asset.id === assetId)?.name ?? assetId

  return (
    <div className="flex flex-col">
      <div className={cn("group flex items-center rounded-md pl-4", active && "bg-muted")}>
        <button
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Collapse" : "Expand"}
          className="px-1 py-1 text-muted-foreground hover:text-foreground"
        >
          {open ? (
            <CaretDownIcon className="size-3" />
          ) : (
            <CaretRightIcon className="size-3" />
          )}
        </button>

        {renaming ? (
          <input
            autoFocus
            defaultValue={edit.name}
            onBlur={(event) => {
              renameEditById(edit.id, event.target.value.trim() || edit.name)
              setRenaming(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
              if (event.key === "Escape") setRenaming(false)
            }}
            className="flex-1 rounded border bg-background px-1 py-0.5 text-sm outline-none"
          />
        ) : (
          <button
            onClick={() => setSequenceStage("edit", edit.id)}
            onDoubleClick={() => setRenaming(true)}
            className="flex-1 truncate py-1 text-left text-sm"
          >
            {edit.name}
          </button>
        )}

        <span className="px-1 font-mono text-xs text-muted-foreground">
          {edit.memberIds.length}
        </span>
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Duplicate edit"
            onClick={() => duplicateEditById(edit.id)}
          >
            <CopyIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Delete edit"
            onClick={() => deleteEdit(edit.id)}
          >
            <TrashIcon />
          </Button>
        </div>
      </div>

      {open && (
        <ol className="flex flex-col">
          {edit.memberIds.length === 0 && (
            <li className="py-1 pl-10 text-xs text-muted-foreground">Empty.</li>
          )}
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
              className="flex cursor-grab items-center gap-2 py-1 pr-2 pl-10 text-xs text-foreground/80 hover:bg-muted active:cursor-grabbing"
            >
              <span className="w-4 shrink-0 text-right font-mono text-muted-foreground">
                {index + 1}
              </span>
              <span className="truncate">{nameOf(assetId)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function Node({
  icon,
  label,
  count,
  active,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-sm text-foreground/90 hover:bg-muted",
        active && "bg-muted font-medium",
      )}
    >
      <span className="ml-4 flex shrink-0 items-center text-muted-foreground">
        {icon}
      </span>
      {label}
      <span className="ml-auto font-mono text-xs text-muted-foreground">{count}</span>
    </button>
  )
}

export type { SequenceStage }
