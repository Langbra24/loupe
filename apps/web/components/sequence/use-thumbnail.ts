"use client"

import { useEffect, useState } from "react"

import { thumbnailUrl } from "@/lib/storage/assets"

/**
 * Resolve an asset to its thumbnail URL.
 *
 * The resolved entry carries the asset it belongs to, and the read below
 * filters on it. That keeps the effect free of a synchronous state write while
 * still guaranteeing a switched asset never briefly shows the previous
 * photograph.
 *
 * Object URLs are cached and revoked centrally in the storage layer, so this
 * deliberately does not revoke on unmount — several components render the same
 * photograph at once, and revoking on one unmount would blank the others.
 */
export function useThumbnail(assetId: string | null | undefined): string | null {
  const [entry, setEntry] = useState<{ assetId: string; url: string | null } | null>(null)

  useEffect(() => {
    if (!assetId) return

    let cancelled = false
    void thumbnailUrl(assetId).then((url) => {
      if (!cancelled) setEntry({ assetId, url })
    })

    return () => {
      cancelled = true
    }
  }, [assetId])

  return entry && entry.assetId === assetId ? entry.url : null
}
