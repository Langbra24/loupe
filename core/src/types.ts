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

export interface Project {
  name: string
  pageSize: PageSize
  /** Reading order, cover first. */
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
