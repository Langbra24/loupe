"use client"

import { useSyncExternalStore } from "react"

export type Platform = "mac" | "other" | "unknown"

/** Nothing to subscribe to — the platform never changes mid-session. */
const subscribe = () => () => undefined

function clientPlatform(): Platform {
  const agent = navigator as Navigator & { userAgentData?: { platform?: string } }
  const name = agent.userAgentData?.platform ?? navigator.platform ?? ""
  return /mac/i.test(name) ? "mac" : "other"
}

/**
 * Which modifier key to name in shortcut hints.
 *
 * Read through `useSyncExternalStore` rather than an effect so the server
 * snapshot is explicitly `unknown`: `navigator` does not exist there, and
 * rendering `Ctrl` on the server then `⌘` on the client is a hydration
 * mismatch. Callers render no shortcut until it resolves.
 */
export function usePlatform(): Platform {
  return useSyncExternalStore<Platform>(subscribe, clientPlatform, () => "unknown")
}

export function modifierLabel(platform: Platform): string | null {
  if (platform === "unknown") return null
  return platform === "mac" ? "⌘" : "Ctrl"
}
