import { describe, expect, it } from "vitest"

import { sidebarVariantFor } from "@/components/shell/inspector-panel"

/**
 * `sidebarVariantFor` is the pure mapping from `Selection` to which of the
 * inspector's four variants renders — extracted so the mapping is testable
 * without mounting the sidebar or a Fabric canvas.
 */
describe("sidebarVariantFor", () => {
  it("maps null to the book-level variant", () => {
    expect(sidebarVariantFor(null)).toBe("book")
  })

  it("maps a frame selection to the frame variant", () => {
    expect(sidebarVariantFor({ kind: "frame", frameId: "f1" })).toBe("frame")
  })

  it("maps a text-element selection to the text-element variant", () => {
    expect(sidebarVariantFor({ kind: "text-element", frameId: "f1", elementId: "e1" })).toBe(
      "text-element",
    )
  })

  it("maps an image-element selection to the image-element variant", () => {
    expect(sidebarVariantFor({ kind: "image-element", frameId: "f1", elementId: "e1" })).toBe(
      "image-element",
    )
  })
})
