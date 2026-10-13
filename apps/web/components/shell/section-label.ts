"use client"

import { createContext, useContext } from "react"

/**
 * The id of the inspector section heading a control sits under ("Type",
 * "Size", "Color"…), so the control can name itself with `aria-labelledby`
 * (#50). The heading is the control's only visible label; without this a
 * screen reader announced "combobox, body" with no idea what it was for.
 *
 * Its own module so color-picker.tsx and number-field.tsx can read it without
 * importing inspector-panel.tsx, which imports them.
 */
export const SectionLabelContext = createContext<string | undefined>(undefined)

export function useSectionLabel(): string | undefined {
  return useContext(SectionLabelContext)
}
