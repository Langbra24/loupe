"use client"

import { useEffect, useState } from "react"

export type Platform = "mac" | "other" | "unknown"

/**
 * Which modifier key to name in shortcut hints.
 *
 * Resolved after mount, never during render: `navigator` does not exist on the
 * server, and rendering `Ctrl` there then `⌘` on the client is a hydration
 * mismatch. `unknown` is the honest pre-mount answer and callers render nothing
 * until it resolves.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown")

  useEffect(() => {
    const agent = navigator as Navigator & {
      userAgentData?: { platform?: string }
    }
    const name = agent.userAgentData?.platform ?? navigator.platform ?? ""
    setPlatform(/mac/i.test(name) ? "mac" : "other")
  }, [])

  return platform
}

export function modifierLabel(platform: Platform): string | null {
  if (platform === "unknown") return null
  return platform === "mac" ? "⌘" : "Ctrl"
}
