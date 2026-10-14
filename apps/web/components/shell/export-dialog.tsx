"use client"

import { useRef, useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { CircleNotchIcon, ExportIcon, FileArchiveIcon, FilePdfIcon, InfoIcon, type Icon } from "@phosphor-icons/react"
import { checkPageCount } from "@sequence/core"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { downloadBlob } from "@/lib/export/download"
import { trapTab } from "@/lib/focus-trap"
import { buildPrintPdf } from "@/lib/export/pdf"
import { buildPngZip } from "@/lib/export/png-zip"
import { cn, stagger } from "@/lib/utils"
import { useEditorStore } from "@/state/editor-store"

type ExportFormatId = "pdf" | "png-zip"

interface ExportFormatOption {
  id: ExportFormatId
  label: string
  description: string
  icon: Icon
  extension: string
}

/**
 * The two export formats research (photobook/zine print-shop conventions,
 * plus what `core/` actually has) narrowed this to. Both are 300 DPI with
 * bleed (`EXPORT_DPI`/`EXPORT_BLEED_MM` in `lib/export/render-frame.ts`);
 * neither claims PDF/X compliance — see `pdf.ts`'s doc comment for why that
 * would be a false claim without real ICC color management. Deliberately
 * not offering per-page TIFF: no browser-side TIFF encoder exists without a
 * heavy new dependency, and PNG already covers the same "lossless, print
 * shop does its own imposition" use case.
 */
const EXPORT_FORMATS: readonly ExportFormatOption[] = [
  {
    id: "pdf",
    label: "Print-ready PDF",
    description:
      "One flattened PDF, every page in reading order. What most print-on-demand photobook services expect to receive.",
    icon: FilePdfIcon,
    extension: "pdf",
  },
  {
    id: "png-zip",
    label: "Page images (PNG, zipped)",
    description: "One lossless PNG per page, zipped. For a print shop imposing the book onto press sheets themselves.",
    icon: FileArchiveIcon,
    extension: "zip",
  },
]

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
  return slug || "sequence-book"
}

/**
 * The top-nav Export button (R: was inert — see CLAUDE.md's tier model for
 * why it will eventually gate on payment, which this doesn't touch).
 * Renders the book's frames (reading order, via `project.frames`, not the
 * unused `pages` — see CLAUDE.md's "The canvas and the book") to one of the
 * formats in `EXPORT_FORMATS`, then triggers a browser download directly —
 * no server round trip, consistent with this app's local-first model.
 *
 * The overlay/panel enter-exit is Base UI's own `data-open`/`data-closed`
 * transition classes, same as every other dialog/popover in this app; the
 * contents inside the panel additionally cascade in via `.stagger-section`
 * (globals.css) — the same reveal the onboarding intro dialog uses,
 * reapplied here at direct user request. Title/description, each format
 * option, then the footer each land on their own delay.
 */
export function ExportDialog() {
  const [open, setOpen] = useState(false)
  const [format, setFormat] = useState<ExportFormatId>("pdf")
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  // The selected format is where focus starts (#45), not the first tabbable
  // control, which is the padding note's info button.
  const selectedFormatRef = useRef<HTMLInputElement>(null)
  const toastManager = useToastManager()

  const project = useEditorStore((state) => state.project)
  const frameCount = project.frames.length
  const exporting = progress !== null
  // Saddle stitch pads the exported file to a multiple of 4 (#31,
  // `padForSaddleStitch` in core); the project itself keeps its count.
  const blanks = frameCount > 0 ? checkPageCount(frameCount).blanksNeeded : 0

  const handleExport = async () => {
    if (frameCount === 0 || exporting) return
    setProgress({ done: 0, total: frameCount })

    const option = EXPORT_FORMATS.find((candidate) => candidate.id === format)!
    const filename = `${slugify(project.name)}.${option.extension}`
    const onProgress = (done: number, total: number) => setProgress({ done, total })

    try {
      const blob =
        format === "pdf"
          ? await buildPrintPdf(project.frames, project.assets, project.typeBaseSize, project.typeRatio, onProgress)
          : await buildPngZip(project.frames, project.assets, project.typeBaseSize, project.typeRatio, onProgress)

      downloadBlob(blob, filename)
      toastManager.add({ title: "Export complete", description: `Saved ${filename}.`, type: "success" })
      setOpen(false)
    } catch (error) {
      console.error("Export failed:", error)
      toastManager.add({
        title: "Export failed",
        description: "Something went wrong while rendering the book. Please try again.",
        type: "error",
      })
    } finally {
      setProgress(null)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !exporting && setOpen(next)}>
      <Dialog.Trigger
        render={
          <Button size="sm">
            <ExportIcon data-icon="inline-start" />
            Export
          </Button>
        }
      />
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <Dialog.Popup
          initialFocus={selectedFormatRef}
          onKeyDown={(event) => trapTab(event, event.currentTarget)}
          className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border bg-popover p-5 text-popover-foreground shadow-lg outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95">
          <div className="stagger-section" style={stagger(0)}>
            <Dialog.Title className="text-sm font-medium">Export book</Dialog.Title>
            <Dialog.Description className={cn("pt-0.5 text-xs text-muted-foreground", blanks === 0 && "pb-4")}>
              {frameCount > 0
                ? `${frameCount} page${frameCount === 1 ? "" : "s"}, rendered at 300 DPI with bleed.`
                : "Add pages to your book before exporting."}
            </Dialog.Description>
            {blanks > 0 ? <PaddingNote blanks={blanks} total={frameCount + blanks} /> : null}
          </div>

          <div className="flex flex-col gap-2">
            {EXPORT_FORMATS.map((option, index) => (
              <label
                key={option.id}
                className={cn(
                  "stagger-section flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  // The radio itself is sr-only, so its card shows keyboard focus.
                  "focus-ring-within",
                  format === option.id ? "border-ring bg-muted" : "border-border hover:bg-muted/50",
                  exporting && "pointer-events-none opacity-60",
                )}
                style={stagger(index + 1)}
              >
                <input
                  type="radio"
                  name="export-format"
                  value={option.id}
                  checked={format === option.id}
                  ref={format === option.id ? selectedFormatRef : undefined}
                  onChange={() => setFormat(option.id)}
                  disabled={exporting}
                  className="sr-only"
                />
                <option.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{option.label}</span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </div>
              </label>
            ))}
          </div>

          <div className="stagger-section flex items-center justify-between pt-4" style={stagger(EXPORT_FORMATS.length + 1)}>
            <span className="text-xs tabular-nums text-muted-foreground">
              {progress ? `Rendering page ${progress.done} of ${progress.total}…` : null}
            </span>
            <div className="flex items-center gap-2">
              <Dialog.Close
                render={
                  <Button variant="ghost" size="sm" disabled={exporting}>
                    Cancel
                  </Button>
                }
              />
              {/* Both labels share one grid cell, as the feedback Submit does
                  (#56), so the button keeps the busy label's width and Cancel
                  doesn't jump when the export starts. */}
              <Button size="sm" disabled={frameCount === 0 || exporting} onClick={handleExport}>
                <span className="grid justify-items-center">
                  <span className={cn("col-start-1 row-start-1", exporting && "invisible")}>Export</span>
                  <span className={cn("col-start-1 row-start-1 flex items-center gap-1", !exporting && "invisible")}>
                    {/* A same-size blank at rest, so no infinite spin runs
                        while hidden. */}
                    {exporting ? <CircleNotchIcon className="animate-spin" /> : <span className="size-3.5" />}
                    Exporting…
                  </span>
                </span>
              </Button>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** "Adds 2 blank pages to reach 12", with an info control that explains why
 *  on hover or keyboard focus. */
function PaddingNote({ blanks, total }: { blanks: number; total: number }) {
  return (
    <TooltipProvider>
      <p className="flex items-center gap-1 pt-1 pb-4 text-xs text-muted-foreground">
        Adds {blanks} blank page{blanks === 1 ? "" : "s"} to reach {total}
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Why blank pages are added"
                // 20px visually; the pseudo-element takes the target to 28px.
                className="relative inline-flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors outline-none before:absolute before:-inset-1 hover:text-foreground focus-ring"
              >
                <InfoIcon className="size-3.5" />
              </button>
            }
          />
          <TooltipContent side="right">
            Saddle-stitched books are made from sheets folded in half, so every sheet adds 4 pages. Blank pages go at
            the end, before the back cover if there is one, so the count works out. Your book itself isn&apos;t changed.
          </TooltipContent>
        </Tooltip>
      </p>
    </TooltipProvider>
  )
}
