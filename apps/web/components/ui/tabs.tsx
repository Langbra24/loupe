"use client"

import * as React from "react"
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * shadcn `base-nova`-pattern Tabs on `@base-ui/react/tabs`, added for the
 * left panel's Canvas/Book switcher (`PanelViewSwitcher` in
 * layers-panel.tsx) — the first thing in this app that needed a sliding
 * active-tab rail rather than an instant background-color snap.
 *
 * `TabsIndicator` positions itself via the `--active-tab-left` /
 * `--active-tab-width` CSS variables Base UI computes and writes onto the
 * element; `tabs-indicator-rail` in globals.css turns those into a
 * `transform: translateX(...)` transition (transform only, per the
 * animations skill — never `left`/`width`) so the rail slides instead of
 * jumping. Width isn't animated because `PanelViewSwitcher`'s two tabs are
 * equal-width (`flex-1`), so it never actually changes between them.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("relative flex", className)}
      {...props}
    />
  )
}

function TabsIndicator({ className, ...props }: TabsPrimitive.Indicator.Props) {
  return (
    <TabsPrimitive.Indicator
      data-slot="tabs-indicator"
      className={cn("tabs-indicator-rail absolute rounded-md bg-primary", className)}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "relative z-10 flex-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors select-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-active:text-primary-foreground hover:not-data-active:bg-muted hover:not-data-active:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel data-slot="tabs-panel" className={cn(className)} {...props} />
  )
}

export { Tabs, TabsList, TabsIndicator, TabsTab, TabsPanel }
