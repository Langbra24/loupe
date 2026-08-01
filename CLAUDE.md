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
- **The shell frame is stable across modes.** The top nav never moves or hides. Only panel open/closed state changes between Sequence / Design / Print.
- Right-click / context-menu canvas interactions are deferred, deliberately.
- Type-scale ratio (1.618 vs 1.5 vs 1.333) is **not** locked in — `core/src/typography.ts` keeps it configurable pending a visual test at real caption/title sizes.

## Three modes, three cognitive tasks

1. **Sequence** — whole-book ordering. Filmstrip/lightbox, no editing chrome, speed is the entire point. Lightweight state array, no canvas rendering.
2. **Design** — per-spread composition against the facing-page pair. The only place doing real canvas rendering (Fabric.js, once it lands).
3. **Print** — imposition, fold preview, bleed/margins, page-count validation. Read-only against assembled state.

Keep these boundaries in the code, not just the UI — they are why the engine stays simple.

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
```
