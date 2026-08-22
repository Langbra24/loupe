# Loupe — agent instructions

**Read [`docs/plans/00-initial-build-brief.md`](docs/plans/00-initial-build-brief.md) before starting any work.** It holds the full product context, tech stack, tier model, UX rationale, and open decisions. This file only records the rules that follow from it.

## What this is

A browser-based photobook/zine layout tool for photographers and DIY bookmakers: sequence, design, and print-impose a booklet without opening InDesign. Free/open-source core, paid hosted + downloadable tiers.

## Repo layout

```
core/                   @loupe/core — data model, sequencing, typography, imposition math.
                        Pure TypeScript. MIT, publicly shared. This is the licensing boundary.
apps/web/               Next.js hosted app. Imports @loupe/core. Payment code lives HERE, never in core/.
apps/download-builder/  (not built yet) packages core/ into the flat $15 zip. No payment code.
marketing-site/         (not built yet) shadcn-based marketing site.
docs/plans/             planning docs, incl. the build brief
docs/brainstorms/       /workflows:brainstorm output
docs/solutions/         /workflows:compound output
todos/                  triage and review findings
```

## Hard rules

- **`core/` imports nothing from React, Next, Fabric.js, or Stripe.** It is pure TypeScript with no DOM assumptions. This is what makes the MIT-core / paid-app split real rather than aspirational. If something in `core/` needs the DOM, it belongs in `apps/web/` instead.
- **No payment code in `core/`.** The $15 download is gated at the *download page*, not by license-key logic inside the shipped bundle — see the brief. Do not add license validation, phone-home checks, or DRM anywhere.
- **No accounts, no backend** beyond thin serverless functions for Stripe. Project state is local-first (IndexedDB, not cookies).
- **Fonts must be OFL-licensed.** Fonts get embedded in exported PDFs; commercial/desktop-only licenses often forbid that. Currently: Lora (heading/serif) + Geist (sans), both OFL.
- **Design tokens flow code → Paper.design, never the reverse.** The CSS variables in `apps/web/app/globals.css` are the source of truth; Paper mirrors them via its MCP agent. Never hand-maintain a second copy.

## Scope decisions already made

- **The product app is desktop-only for v1.** A canvas tool with left/right panels has no sensible mobile layout, and no breakpoint strategy has been designed. The app renders a plain notice below 1024px. The *marketing site* must still be responsive.
- **Canvas reflows, it does not float.** Panels are grid columns that collapse to zero width; the canvas region genuinely resizes. Never implement panels as overlays on a fixed-size canvas.
- **The shell frame is stable.** The top nav never moves or hides.
- Right-click / context-menu canvas interactions are deferred, deliberately.
- Type-scale ratio (1.618 vs 1.5 vs 1.333) is **not** locked in — `core/src/typography.ts` keeps it configurable pending a visual test at real caption/title sizes.

## The canvas and the book

Superseded the three-mode structure (Sequence / Design / Print) and the Sequence funnel (Canvas → Edits → Book) documented here through mid-2026 — see `docs/plans/2026-08-22-001-feat-unified-canvas-plan.md` for the full rationale and the Product Contract that replaced them. What follows is the model that plan produced.

There are two places now, not three modes and not a three-stage funnel inside one of them:

1. **The canvas** — one infinite Fabric.js surface. Imported photographs sit on a pasteboard, positioned freely, exactly as before. `Frame`s — pages-in-progress — sit in a snap-to-flow grid on the same surface: a frame's position in that grid *is* its position in the book's reading order, set by dragging the frame, never by anything else. Dragging a photograph off the pasteboard onto a frame's bounds moves it into that frame's elements; dragging it back out returns it to the pasteboard. Text is created directly on a frame with the `T` key.
2. **The book overview** — a left-panel list of every frame in reading order, each row carrying a thumbnail and its print-margin summary. Selecting a row (or a frame/element on the canvas itself) drives the one persistent contextual sidebar: nothing selected shows book-level settings (page size, count, saddle-stitch validation); a frame shows its margins; an element shows its own properties.

**Position is order, for frames — never inferred, for anything else.** A frame's grid position determines its page number, full stop; this is the one and only place geometry decides sequence. A photograph's position on the pasteboard means nothing beyond where it happens to be — moving it around never changes reading order, and it only affects the book at all once it crosses into a frame.

The old `Edit` type — ordered lists of asset ids, promoted by right-click, comparable side by side — is gone. There is one canvas and one ordering; competing candidate sequences are not currently representable, a known and accepted loss, not an oversight (see the plan's Scope Boundaries and `todos/2026-08-22-unified-canvas-doc-review.md`).

## Data model notes

- `Asset` is metadata only. Pixels live in IndexedDB (`originals` and `thumbnails` stores) addressed by asset id.
- `CanvasPlacement.x/y` is the placement's **center**, matching Fabric v7's `originX`/`originY` default of `'center'`.
- One scene unit is one pixel of the original image. The canvas scales thumbnails up to that size on draw, and divides the factor back out when reading a placement's scale — otherwise every drag would persist the rendering factor as user intent.
- `Frame.position` is the one place geometry is allowed to mean order: a frame's slot in the snap-to-flow grid is its page number. This does not extend to anything else on the canvas — a pasteboard photograph's `CanvasPlacement.x/y` never means order, only where it happens to sit, until it moves into a frame.
- Converting a pasteboard photograph into a frame's `ImageElement` is lossy on purpose: `ImageElement` has no rotation or scale field, only a normalized `Box` and a `fit` mode, so a rotated or zoomed placement resets to upright and full-bleed the moment it joins a frame. See the comment on `moveToFrame` in `editor-store.ts`.
- Spreads stay derived from page order; they are never stored. (`Page`/`Spread`/`toSpreads` still exist in `core/` for the committed-book concept and for migrating old projects, but nothing currently commits a `Frame` into a `Page` — see the plan's Scope Boundaries.)

## Storage rules

- The project record addresses the blobs, so it is flushed **immediately** after an import commits and on `pagehide`. Only placement and edit mutations use the debounce.
- Load reconciles blob stores against the asset list and deletes orphans.
- `navigator.storage.persist()` is requested on first import. IndexedDB is evicted LRU, and with no account and no backup that is silent total data loss. A denial degrades quietly — it is a browser policy the user cannot change. The real answer is the deferred project export.

## Fabric.js v7 gotchas

Most published examples are v5/v6 and will not work as written.

- `getPointer()` is gone — use `getScenePoint()` / `getViewportPoint()`.
- `setWidth()`/`setHeight()` are gone — use `setDimensions()`. The panel-collapse resize path depends on this.
- `originX`/`originY` default to `'center'`.
- `fireRightClick` and `stopContextMenu` default to `true`, but set them explicitly — the context menu depends on them entirely.
- The canvas must observe a dedicated `overflow-hidden` wrapper, never a scrollable ancestor, or a growing canvas summons a scrollbar and re-fires its own `ResizeObserver`.

## Stack notes

- Next.js 16 (App Router) + React 19. **This is not the Next.js you may know** — read `apps/web/node_modules/next/dist/docs/` before writing framework code. See `apps/web/AGENTS.md`.
- shadcn `base-nova` style on `@base-ui/react`, Phosphor icons, Tailwind v4. Components land in `apps/web/components/ui/`.
- Zustand for editor state (`apps/web/state/editor-store.ts`).
- Fabric.js is DOM-only and must be dynamically imported client-side when it's added. `CanvasRegion` already isolates that boundary.

## Commands

```bash
npm install          # root — workspaces
npm run dev          # apps/web dev server
npm run build        # apps/web production build
npm run typecheck    # all workspaces
npm run lint         # all workspaces
npm test --workspace=@loupe/core   # Vitest
```

Core purity gates (both must return nothing):

```bash
rg "from ['\"](react|next|fabric|stripe)" core/src
rg "document\.|window\.|localStorage|navigator" core/src
```
