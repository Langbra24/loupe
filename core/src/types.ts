/**
 * The Loupe data model.
 *
 * A project is a flat, ordered list of pages. Spreads are *derived* from that
 * list rather than stored, because pagination is a consequence of page order —
 * inserting one page shifts every facing pair after it. Storing spreads would
 * mean re-deriving them on every insert anyway, and risking the two
 * representations drifting apart.
 */

export type ElementId = string
export type PageId = string

/** Normalized 0..1 box relative to the page. Resolution-independent, so the
 *  same layout renders correctly at screen preview and at export DPI. */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** An axis-aligned rectangle in canvas scene units, anchored at its top-left.
 *  Distinct from `Box`: `Box` is normalized to a page, this is absolute scene
 *  space on the light table. */
export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * An imported photograph. Metadata only — pixel data lives in IndexedDB and is
 * addressed by `id`, because assets are large and `Project` gets serialized on
 * every save.
 */
export interface Asset {
  id: string
  /** Original filename, used as the layer label and the default caption. */
  name: string
  /** Natural pixel dimensions of the original, not of the thumbnail. */
  width: number
  height: number
  importedAt: number
}

/**
 * Where a photograph sits on the light table.
 *
 * `x`/`y` are the placement's **center**, matching Fabric v7's default
 * `originX`/`originY` of `'center'`. Storing top-left would mean converting on
 * every read and write, and would make scale-in-place shift the object.
 */
export interface CanvasPlacement {
  id: string
  assetId: string
  x: number
  y: number
  /** Scene units per thumbnail pixel. 1 means the thumbnail's natural size. */
  scale: number
  rotation: number
}

/** The free-flowing light table: stage one of the funnel. */
export interface CanvasState {
  placements: CanvasPlacement[]
}

export interface BaseElement {
  id: ElementId
  /** Shown in the layers panel. */
  name: string
  frame: Box
  locked: boolean
  hidden: boolean
}

export interface ImageElement extends BaseElement {
  kind: 'image'
  /** Key into the project's asset store. Not the pixel data itself — assets are
   *  large and stored separately (IndexedDB blobs, once persistence lands). */
  assetId: string
  /** How the image sits inside its frame. */
  fit: 'cover' | 'contain'
}

export interface TextElement extends BaseElement {
  kind: 'text'
  content: string
  /** Named step in the type scale, not a raw pixel size — see typography.ts. */
  role: TypeRole
  align: 'left' | 'center' | 'right'
}

export type PageElement = ImageElement | TextElement

/** Named steps in the modular type scale. Deliberately few: this is a book
 *  tool, not a word processor. */
export type TypeRole = 'title' | 'subtitle' | 'body' | 'caption' | 'credit' | 'folio'

export interface Page {
  id: PageId
  elements: PageElement[]
}

/**
 * A frame's page margins, in the same units as its `pageSize` (millimetres,
 * by convention — see `PageSize`). Structurally identical to `PageMargins` in
 * typography.ts but declared separately rather than imported from there:
 * typography.ts already imports `PageSize`/`TypeRole` from this file, and
 * importing back from typography.ts would make that a cycle.
 */
export interface Margins {
  top: number
  inner: number
  outer: number
  bottom: number
}

/**
 * A page-in-progress on the canvas — a frame the user drags photographs and
 * text into before it becomes a committed `Page`.
 *
 * `position` is the frame's place in the book's reading-order flow, not its
 * geometric location on the pasteboard. The two are independent: a frame can
 * sit anywhere on the canvas and still be, say, page 3 in the flow. Reordering
 * the flow (`reorderFrame` in frames.ts) never touches where the frame sits on
 * the canvas.
 *
 * `margins` is optional (U7): every frame `createFrame` builds gets a real
 * value (defaulted from the Van de Graaf canon for its `pageSize`), but the
 * field stays optional in the type rather than required so hand-built `Frame`
 * fixtures elsewhere (tests predating this unit) don't all need updating for
 * a field that has one obvious default — see `createFrame` in frames.ts.
 */
export interface Frame {
  id: PageId
  pageSize: PageSize
  /** 0-based position in the book's reading order. */
  position: number
  elements: PageElement[]
  margins?: Margins
}

/**
 * The book's shape before any frames exist: how big the pages are and how many
 * of them to start with. `pageSize` doubles as the preset/custom choice — a
 * preset is just a named `PageSize`, and a custom one is an unnamed one with
 * the user's own dimensions.
 */
export interface BookSetup {
  pageSize: PageSize
  pageCount: number
}

/**
 * A pair of facing pages as the reader sees them with the book open.
 *
 * The first and last pages of a book have no facing partner (they are the
 * outside covers), so `left` and `right` are independently nullable rather
 * than a required tuple.
 */
export interface Spread {
  index: number
  left: Page | null
  right: Page | null
}

/** Physical page geometry, in millimetres. */
export interface PageSize {
  name: string
  width: number
  height: number
}

/**
 * The whole project.
 *
 * `assets` is every photograph imported. `canvas` is where they sit on the
 * light table. `frames` are pages in progress. `pages` is the committed book —
 * the output, not the working material.
 */
export interface Project {
  name: string
  pageSize: PageSize
  /** Every imported photograph. */
  assets: Asset[]
  /** Where those photographs sit on the light table. */
  canvas: CanvasState
  /** Pages in progress, not yet committed to the book. */
  frames: Frame[]
  /** The committed book, in reading order, cover first. */
  pages: Page[]
  /** Base font size in points; every type step derives from this. */
  typeBaseSize: number
  typeRatio: number
}

/**
 * What the layers panel and inspector are currently pointed at.
 *
 * Redesigned in U7 for the frame model: the old shape (`page`/`element`,
 * keyed by `pageId`) predates `Frame` entirely and doesn't fit it — a
 * page-in-progress is a `Frame`, not a `Page`, and its elements live at
 * `Frame.elements`, not `Page.elements`. `image-element` and `text-element`
 * are split rather than a single `element` kind because the inspector shows
 * different fields for each (fit/position vs. role/alignment/width), and a
 * single kind would just push that same discrimination into every reader.
 *
 * `null` means nothing is selected, which is a meaningful state: the
 * inspector shows book-level settings (page size, count, saddle-stitch
 * validation) instead of one frame's or element's properties.
 */
export type Selection =
  | { kind: 'frame'; frameId: PageId }
  | { kind: 'text-element'; frameId: PageId; elementId: ElementId }
  | { kind: 'image-element'; frameId: PageId; elementId: ElementId }
  | null
