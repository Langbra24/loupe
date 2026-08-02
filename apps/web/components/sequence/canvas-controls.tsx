"use client"

import {
  ArrowsOutIcon,
  MagnifyingGlassMinusIcon,
  MagnifyingGlassPlusIcon,
} from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { CanvasControls as Controls } from "@/components/sequence/use-fabric-canvas"
import { useCanvasShortcuts } from "@/components/sequence/use-canvas-shortcuts"
import { modifierLabel, usePlatform } from "@/components/sequence/use-platform"

/** Long enough not to fire while a pointer crosses the cluster on its way
 *  somewhere else. */
const TOOLTIP_DELAY_MS = 600

/**
 * Navigation controls for the light table, floating bottom-right.
 *
 * Deliberately the only chrome over the canvas besides the mode switcher —
 * everything else about this stage is the photographs.
 */
export function CanvasControls({ controls }: { controls: Controls }) {
  const { zoom, zoomIn, zoomOut, resetZoom, fitToView } = controls

  const platform = usePlatform()
  const modifier = modifierLabel(platform)
  const canIntercept = useCanvasShortcuts({
    enabled: true,
    zoomIn,
    zoomOut,
    resetZoom,
  })

  // Only advertise a shortcut we can actually deliver. Where the browser keeps
  // the shortcut for itself, naming it would point users at page zoom.
  const shortcut = (key: string) =>
    modifier && canIntercept ? `${modifier} ${key}` : null

  return (
    <TooltipProvider delay={TOOLTIP_DELAY_MS}>
      <div className="absolute right-3 bottom-3 z-20 flex items-center gap-0.5 rounded-xl border bg-background/90 p-0.5 shadow-sm backdrop-blur">
        <ControlButton
          label="Zoom out"
          shortcut={shortcut("−")}
          onClick={zoomOut}
        >
          <MagnifyingGlassMinusIcon />
        </ControlButton>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                onClick={resetZoom}
                className="min-w-14 rounded-lg px-2 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {Math.round(zoom * 100)}%
              </button>
            }
          />
          <TooltipContent>
            <TooltipBody label="Reset to 100%" shortcut={shortcut("0")} />
          </TooltipContent>
        </Tooltip>

        <ControlButton label="Zoom in" shortcut={shortcut("+")} onClick={zoomIn}>
          <MagnifyingGlassPlusIcon />
        </ControlButton>

        {/* No shortcut is bound for fit, so its tooltip names the action only. */}
        <ControlButton label="Fit to view" shortcut={null} onClick={fitToView}>
          <ArrowsOutIcon />
        </ControlButton>
      </div>
    </TooltipProvider>
  )
}

function ControlButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string
  shortcut: string | null
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick}>
            {children}
          </Button>
        }
      />
      <TooltipContent>
        <TooltipBody label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  )
}

function TooltipBody({ label, shortcut }: { label: string; shortcut: string | null }) {
  return (
    <span className="flex items-center gap-2">
      {label}
      {shortcut && (
        <kbd data-slot="kbd" className="rounded bg-background/20 px-1 font-mono">
          {shortcut}
        </kbd>
      )}
    </span>
  )
}
