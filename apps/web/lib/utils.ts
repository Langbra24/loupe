import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Inline `--n` for one `.stagger-section` (see globals.css) — the stagger
 * index that spaces each section's entrance delay apart in the cascading
 * reveal shared by `Introduction`, `ExportDialog`, and `FeedbackControl`.
 * CSS custom properties aren't part of React's `CSSProperties` type, hence
 * the cast.
 */
export function stagger(n: number): React.CSSProperties {
  return { "--n": n } as React.CSSProperties
}
