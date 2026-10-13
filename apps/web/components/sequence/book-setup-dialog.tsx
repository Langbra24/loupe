"use client"

import { useEffect, useId, useRef, useState } from "react"

import { PAGE_SIZE_PRESETS, validateCustomPageSize, type PageSize } from "@loupe/core"

import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/state/editor-store"

const DEFAULT_PAGE_COUNT = 12

/**
 * The one-time book-setup prompt.
 *
 * Fires whenever photographs exist but no frames have been created yet
 * (`assets.length > 0 && frames.length === 0` — checked by the caller,
 * `LightTable`). Deliberately non-dismissible: there is no "skip for now"
 * because a partially-set-up project (photos imported, no page size chosen)
 * has nowhere sensible to put book-level settings until this completes, and
 * a dismiss-and-reoffer flow would need to track that half-finished state
 * somewhere. Completing the form is the only way out, which keeps the state
 * space small — imported-with-no-frames always means "this dialog is up."
 */
export function BookSetupDialog() {
  const setupBook = useEditorStore((state) => state.setupBook)

  const [selectedPreset, setSelectedPreset] = useState<PageSize>(PAGE_SIZE_PRESETS[0]!)
  const [useCustom, setUseCustom] = useState(false)
  const [customWidth, setCustomWidth] = useState("210")
  const [customHeight, setCustomHeight] = useState("297")
  const [pageCount, setPageCount] = useState(String(DEFAULT_PAGE_COUNT))
  const titleId = useId()
  const selectedPresetRef = useRef<HTMLButtonElement>(null)

  // Keyboard focus starts on the selected page size (#45). What this covers
  // in the canvas region is made inert in light-table.tsx.
  useEffect(() => {
    selectedPresetRef.current?.focus()
  }, [])

  const width = Number(customWidth)
  const height = Number(customHeight)
  const customValidation = validateCustomPageSize(width, height)
  const count = Number(pageCount)
  const countValid = Number.isFinite(count) && count > 0 && Number.isInteger(count)

  const canSubmit = countValid && (!useCustom || customValidation.valid)

  const handleSubmit = () => {
    if (!canSubmit) return
    const pageSize: PageSize = useCustom
      ? { name: "Custom", width, height }
      : selectedPreset
    setupBook({ pageSize, pageCount: count })
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div role="dialog" aria-labelledby={titleId} className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-lg">
        <h2 id={titleId} className="font-heading text-base font-medium">
          Set up your book
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a page size and how many pages to start with. You can change
          this later.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <span className="text-xs font-medium text-muted-foreground">Page size</span>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              {PAGE_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  ref={!useCustom && selectedPreset.name === preset.name ? selectedPresetRef : undefined}
                  aria-pressed={!useCustom && selectedPreset.name === preset.name}
                  onClick={() => {
                    setSelectedPreset(preset)
                    setUseCustom(false)
                  }}
                  className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                    !useCustom && selectedPreset.name === preset.name
                      ? "border-ring bg-muted"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  {preset.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setUseCustom(true)}
                className={`rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  useCustom ? "border-ring bg-muted" : "border-border hover:bg-muted"
                }`}
              >
                Custom
              </button>
            </div>

            {useCustom && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  aria-label="Width in millimetres"
                  className="h-8 w-20 rounded-lg border border-border bg-background px-2 text-sm"
                />
                <span className="text-xs text-muted-foreground">×</span>
                <input
                  type="number"
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  aria-label="Height in millimetres"
                  className="h-8 w-20 rounded-lg border border-border bg-background px-2 text-sm"
                />
                <span className="text-xs text-muted-foreground">mm</span>
              </div>
            )}
            {useCustom && !customValidation.valid && (
              <p className="mt-1 text-xs text-destructive">{customValidation.reason}</p>
            )}
          </div>

          <div>
            {/* Label left, value right in a single bordered box (Paper
                reference FL-0) — the same row shape as the inspector
                panel's X/Y/W/H fields, not a stacked label-above-input
                block. */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm text-muted-foreground" htmlFor="page-count">
                Starting page count
              </label>
              <input
                id="page-count"
                type="number"
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
                className="w-20 rounded-md border bg-input/30 px-2 py-1 text-right font-mono text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
            {!countValid && (
              <p className="mt-1 text-xs text-destructive">Enter a whole number greater than zero.</p>
            )}
          </div>
        </div>

        <Button className="mt-4 w-full" disabled={!canSubmit} onClick={handleSubmit}>
          Create book
        </Button>
      </div>
    </div>
  )
}
