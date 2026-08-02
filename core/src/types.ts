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

/**
 * A candidate sequence — the Edits stage.
 *
 * Members are asset ids rather than placement ids on purpose: an Edit is a
 * statement about which photographs are in a sequence, and it should survive
 * the photo being moved, rescaled, or removed from the canvas.
 *
 * Promoting a photo into an Edit does not take it off the canvas, so one asset
 * can belong to several Edits at once. That is what makes competing edits
 * comparable side by side.
 */
export interface Edit {
  id: string
  name: string
  /** Ordered asset ids. Order is set explicitly, never inferred from geometry. */
  memberIds: string[]
  createdAt: number
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
 * The whole project, across all three stages of the funnel.
 *
 * `assets` is every photograph imported. `canvas` is where they sit while the
 * sequence is still loose. `edits` are candidate orderings. `pages` is the
 * committed book — the output, not the working material.
 */
export interface Project {
  name: string
  pageSize: PageSize
  /** Stage one: every imported photograph. */
  assets: Asset[]
  /** Stage one: where those photographs sit on the light table. */
  canvas: CanvasState
  /** Stage two: candidate sequences. */
  edits: Edit[]
  /** Stage three: the committed book, in reading order, cover first. */
  pages: Page[]
  /** Base font size in points; every type step derives from this. */
  typeBaseSize: number
  typeRatio: number
}

/** What the layers panel and inspector are currently pointed at.
 *  `null` means nothing is selected, which is a meaningful state: the layers
 *  panel shows the book's page order instead of one page's contents. */
export type Selection =
  | { kind: 'page'; pageId: PageId }
  | { kind: 'element'; pageId: PageId; elementId: ElementId }
  | null
