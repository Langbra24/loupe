# [Working name: Loupe] — Build Brief for Claude Code

## One-liner
A browser-based photobook/zine layout tool for photographers and DIY bookmakers — sequence, design, and print-impose a booklet without opening InDesign. Free/open-source core, paid hosted + downloadable tiers.

## Name candidates (pending decision)
1. **Loupe** — the tool photographers use over a contact sheet/light table to review and sequence negatives. Top pick: specific, tactile, true to audience vocabulary.
2. **Signature** — bookbinding term for a folded group of pages; also reads as "artistic signature."
3. **Gathering** — bookbinding term for collating folded signatures into a book block.
4. **Quire** — old paper-craft term for a set of folded sheets. Quieter, more obscure.
5. **Chapbook** — historically a small, cheaply-bound pamphlet; maps directly to what a zine is.

## Glossary (bookmaking terms used throughout this brief)
- **Sequencing** — deciding the order of images/pages across the whole book (pacing, narrative rhythm). Whole-book task → Sequence view.
- **Spread** — a pair of facing pages as seen when the book is physically open; the actual unit a reader sees at once. Composition happens against the spread, not the single page → Design view.
- **Imposition** — the print-production step of arranging pages onto a physical press sheet in the order/rotation needed so folding and cutting/stapling lands pages back in correct reading order. Purely mechanical, not creative → Print/export view.

## Audience
Primary: working photographers and photobook-workshop attendees (Magnum-course network) making dummies/zines who know book-craft vocabulary and expect print-shop-grade output.
Secondary: DIY scrapbook makers (same tool, warmer/less jargon-heavy onboarding, later).

## Core product philosophy
- Narrow and deep, not InDesign-broad. Win the one job (sequence → design → impose/export) rather than competing on feature count.
- No accounts, no email capture, no backend beyond a thin serverless payment layer.
- Local-first: project state persists in IndexedDB, not cookies (cookies are wrong tool — too small, server-round-trip model, no server to round-trip to).
- Manual "export project file" (.json/.zine bundle) as backup/transfer, since there's no account/cloud sync.
- Honor-system licensing on paid tiers — no DRM, no phone-home validation. Consistent with the "own it forever" positioning.

## Three-tier pricing/distribution model
| Tier | Price | Delivery | Payment code present? |
|---|---|---|---|
| Hosted web app | $5 / export | Use in-browser, Stripe Checkout gates export button, per-project unlock | Yes — Stripe + serverless unlock token |
| Downloadable app | $15 one-time | Stripe Checkout → success redirect to a session-verified download page → grab zip, own forever | Yes, but only in the gated *download page*, not baked into the zip itself |
| GitHub source | Free, MIT | Clone/build yourself | No — zero payment code in the public repo |

Key implementation note: the $15 zip should NOT contain license-key validation logic. Gate the *download page* (verify Stripe session server-side before revealing the link), then ship a clean, fully-unlocked zip. Simpler to build than embedding a license-key screen, and functionally equivalent for a genuine buyer.

## Tech stack
- **Canvas engine:** Fabric.js (object model — selection, transform, layering, image/text objects; mature ecosystem, most prior art for design-editor use cases)
- **UI/design system:** shadcn, one consistent system reused across marketing site and product app
- **Collaborative design tooling:** Paper.design — code-native HTML/CSS canvas, MCP server integration so Claude Code can read/write design tokens and components directly. Used to design the chrome (site, panels, marketing page) — NOT a replacement for the Fabric.js in-product canvas.
- **Hosting:** Vercel — static/React app + serverless functions for Stripe webhook/session verification and unlock-token minting
- **Payments:** Stripe Checkout (hosted, no custom payment forms)
- **Font licensing:** OFL-licensed faces only (most of Google Fonts), since fonts get embedded in exported PDFs — commercial/desktop-only licenses often disallow this
- **Color management (stretch goal):** lcms-wasm (Little CMS compiled to WebAssembly) for soft-proof preview against bundled SWOP/FOGRA39 profiles; v1 ships plain sRGB-tagged export without full ICC conversion

## Repo structure (proposed)
```
/core                  — shared engine: Fabric canvas wrapper, sequencing logic,
                          imposition/export math, type-scale system
                          (this is the MIT-licensed, publicly shared code)
/apps
  /web                 — hosted Vercel app: imports /core, adds Stripe
                          Checkout + serverless unlock function
  /download-builder    — build script that packages /core into the
                          flat, dependency-free $15 zip (no payment code)
/marketing-site        — shadcn template-based site (separate concern,
                          designed collaboratively in Paper.design)
```

## Three-mode UI (the core UX insight)
Distinct modes for distinct cognitive tasks, Figma-style mode switching rather than one overloaded canvas:

1. **Sequence view** — fast, low-friction filmstrip/lightbox. Reorder pages, pair images into spreads, shuffle-and-compare. No typography or fine layout controls here — speed is the entire point (this was the explicitly broken workflow observed in the photobook workshop).
2. **Design view** — per-spread detail work: place/crop images, add captions, apply the type scale. Canvas-based (Fabric.js), scoped to one spread at a time.
3. **Print/export view** — imposition math, fold preview, bleed/margins, soft-proof (stretch), page-count validation (auto-insert blanks or warn for saddle-stitch multiples-of-4), final export.

Engineering payoff: Sequence view can be a lightweight state array (image refs + order), Design view is the only place doing real canvas rendering, Print view only reads final assembled state. Clean boundaries, not just better UX.

## Repo setup & multi-agent development workflow

**Step 1: create the GitHub repo** before any scaffolding begins — this is the actual first action, everything else builds on top of it.

**Compound Engineering plugin (EveryInc)** — install this for the plan → work → review → compound loop, since it's purpose-built for exactly the "multiple agents on multiple worktrees" workflow described:
```
claude /plugin marketplace add https://github.com/EveryInc/every-marketplace
claude /plugin install compound-engineering
```
This adds 23 workflow commands and 13 skills, including a dedicated **git-worktree** skill that manages isolated parallel development — creating, listing, switching, and cleaning up worktrees through one script rather than raw `git worktree` commands. Relevant behavior:
- `/workflows:work` — asks whether to use a parallel worktree or work live on a branch, every time
- `/workflows:review` — if not already on the target branch, offers an isolated worktree for review
- Worktree creation auto-copies `.env` files, so parallel agents don't need manual env setup per worktree

**Step 2: commit this brief into the repo and wire `CLAUDE.md` to it**, so every worktree's agent starts from the same shared context instead of drifting:
- Save this document as `docs/plans/00-initial-build-brief.md`
- In `CLAUDE.md`, explicitly reference it (e.g. "See `docs/plans/00-initial-build-brief.md` for full product context, tech stack, tier model, and open decisions before starting any work") so it's the first thing any agent — in any worktree — reads before touching code.


```
your-project/
├── CLAUDE.md            # agent instructions, preferences, patterns — this file
│                           should reference this build brief directly
├── docs/
│   ├── brainstorms/      # /workflows:brainstorm output
│   ├── solutions/        # /workflows:compound output (categorized)
│   └── plans/            # /workflows:plan output
└── todos/                # /triage and review findings, e.g.
    ├── 001-ready-p1-fix-auth.md
    └── 002-pending-p2-add-tests.md
```

**Suggested loop for building this specific project:** `/workflows:plan` against a section of this build brief → `/workflows:work` in an isolated worktree → `/workflows:review` (multi-agent code review) → `/workflows:compound` to fold learnings back into `docs/solutions/` so later work benefits from earlier fixes/patterns rather than repeating them. This matters especially for a project with several genuinely separable workstreams running in parallel (canvas engine, marketing site, payment layer, Paper.design token sync) — worktrees keep those from stepping on each other.



## Initial screen scaffold — for Claude Code to build first, to screenshot into Paper.design

Goal: the simplest possible working shell of the three-mode UI, styled with shadcn, so it can be captured as a screenshot and refined visually in Paper.design. Not the final design — a clean structural starting point.

### Fixed app shell (the outer frame, above/around everything else)
- **Top nav is fixed** — always visible, doesn't scroll or hide, regardless of mode.
  - **Top-left:** product name only. No other chrome here.
  - **Top-right:** two CTAs — a **Share** action, and a bold **primary Export** button (the button that ultimately gates on the $5/$15 payment flow depending on tier, though that logic isn't part of this initial shell).
- **Grounding principle:** the fixed top nav, the left layers panel, and the right design panel together form a stable frame the user is always oriented within — only the canvas region resizes/reflows as modes switch (per the earlier resize decision). Nothing about the outer shell should shift or disappear between Sequence/Design/Print modes except the panels' open/closed state itself.
- **Right-click/context-menu canvas interactions:** intentionally deferred. Worth having eventually (standard for any canvas builder — duplicate, delete, bring-to-front, etc.) but out of scope for this initial shell; revisit once in a more iterative/exploratory phase rather than locking in specifics now.


### Shared frame (all modes)
- Canvas fills the main viewport and **genuinely resizes/reflows** as panels toggle on/off — not a floating overlay on top of a fixed-size canvas. Confirmed against reference screenshots: Figma's own "presentation/collapsed panel" view (max canvas space, minimal chrome — the Sequence-mode analog) vs. its full editing layout with left Layers panel + right Design panel + resized canvas between them (the Design-mode analog). Canvas width/height are a function of which panels are open, not fixed.
- **Design tokens stream into Paper.design via the "from a codebase" MCP flow, not the reverse.** Source of truth lives in code (shadcn/Tailwind CSS variables — colors, spacing, radii, type scale). Per Paper's token docs: tokens are named CSS variables that map directly to Tailwind, and can currently only be created or updated via the MCP agent (no manual token UI in Paper yet). Workflow: Claude Code establishes the CSS-variable token set in the codebase first → points the Paper MCP agent at that codebase → agent generates matching tokens inside Paper. This keeps code as canonical and Paper as a mirror, avoiding two hand-maintained copies drifting apart. Manual fallback: Paper also supports copy-theme → paste into a CSS theme file directly, useful for spot-checking sync.

### Top-right: mode switcher (floating tab group)
- A small floating group of tabs (Sequence / Design / Print) positioned top-right, above the canvas.
- **Sequence mode:** tab group sits minimized/collapsed — just the tabs, no expanded panel. All other editing UI is hidden entirely; the canvas is the whole interface. This mirrors the "removed friction" goal from the workshop observation.
- **Design mode:** selecting this tab causes a right-side panel to grow directly out of that tab group, downward, filling the right edge of the screen with the design tooling (object properties, type controls, image crop/fit, etc.).
- **Print mode:** same growth pattern, right panel switches to imposition/export controls (fold preview, bleed/margins, page-count check, soft-proof toggle later).

### Left panel: simplified layers panel
- Present in Design mode (hidden or minimized in Sequence mode, consistent with "no editing chrome during sequencing").
- **Top-left of this panel:** file/project name only. Very plain — just the name, no toolbar clutter.
- **Selection-driven contents, standard layers-panel behavior:**
  - **No node/page selected:** panel lists the pages/spreads themselves as the top-level (parent) layers — i.e. the book's page order.
  - **A node/page is selected on the canvas:** panel switches to show the elements *inside* that page (images, text blocks) as the layer list — same drill-down pattern as any standard layers panel (Figma, Photoshop, etc.), just stripped down since the only element types are text and images.

### What NOT to build yet
- No visual polish, no final type scale, no branding/grain treatment — that comes after this shell is screenshotted into Paper.design and refined there.
- No print-mode controls beyond placeholders — flesh those out once Sequence/Design shell is validated.

## Typography system (MVP)
- Modular type scale derived from a single ratio (golden 1.618, or 1.5/1.333 if that's too dramatic at caption sizes) — every size (caption, credit line, title, folio number) derived from one base size.
- Margins/proportions borrowed from historical book-design canon (Van de Graaf canon / Villard's diagram) — legitimate, centuries-old golden-ratio-based systems for deriving page margins from aspect ratio. Worth naming explicitly in docs/marketing as "the same proportion system used in medieval manuscripts."
- 2–3 fonts max, OFL-licensed: one serious book serif for body/captions (e.g. Lora, Source Serif, EB Garamond), one clean sans for folios/credits. Fewer, better choices > a font picker.

## Branding direction
- Painterly/grain-textured photography backdrops (film grain, painted/atmospheric landscape or texture imagery) as the visual backbone — matches current trend seen in reference screenshots (Cursor landing page, mountain-photo card treatment).
- Clean glass/white UI cards floating over the textured backdrop for actual content/data (pricing, feature cards, stats).
- This aesthetic should carry across marketing site AND product app for consistency, per shadcn preset reuse.

## Marketing site — first-pass wireframe (for a background agent, in parallel worktree)

Goal: a structural wireframe only — real section order and shadcn components wired up, using shared tokens from `/core` — not final copy or visual polish. This is meant to be screenshotted/imported into Paper.design and refined there, same pattern as the app shell.

**Section order:**
1. **Hero** — product name (once decided) + one-line value prop ("own it forever, no subscription" angle). Hero visual is a real product shot (the full app shell — left layers panel, canvas, right design panel) sitting on top of the grain/painterly backdrop, per the established reference aesthetic. A video or interactive embedded demo are both options to explore later, but a static product screenshot is the baseline to wireframe now.
2. **Problem/positioning strip** — brief statement of who this is for (photographers, book-design workshop / DIY bookmakers) and the contrast with general tools like InDesign — narrow-and-deep positioning, not a feature dump.
3. **Feature highlights (3-4 cards)** — Sequence/Design/Print modes as the core story, plus soft-proof color preview as a "coming soon"/stretch mention if desired.
4. **Pricing tiers (3 cards)** — Hosted $5/export, Download $15 one-time, GitHub source free/MIT. Straightforward comparison layout, no dark-pattern upsell styling — matches the honest, small-audience tone established throughout this project.
5. **Embedded demo or screenshot placeholder** — actual embed can wait; reserve the section/layout slot now.
6. **Footer** — GitHub link, MIT license mention, contact.

**Explicitly deferred for this first pass:** final marketing copy, name/domain-dependent content, animation/interaction polish, real screenshots. Wireframe should use realistic placeholder text long enough to judge real layout behavior (not lorem ipsum, per the reference images which used generic filler — actual sentence-length placeholders are more useful for judging real card/text proportions).


## Open decisions before Claude Code starts scaffolding
0. **Mobile scope for the product app is unresolved — likely desktop-only for v1.** A canvas-based design tool (left/right panels + Fabric.js canvas) doesn't have an obvious mobile layout, and no responsive/breakpoint strategy for the *product* (not the marketing site, which should still be responsive) has been designed. Recommend explicitly scoping v1 as desktop-only for the app itself and noting this plainly rather than attempting a half-considered mobile squeeze. Revisit only if real demand shows up.
1. Final name (see candidates above — affects repo name, domain, branding assets)
2. Golden ratio (1.618) vs. more moderate ratio (1.5/1.333) for the type scale — needs a quick visual test at actual caption/title sizes before locking in
3. Whether download-builder zip is a fully static flat-HTML bundle (zero build step for end user) or requires any install — leaning fully static per earlier discussion
4. Marketing site section structure (hero, feature highlights, pricing tiers, embedded demo) — to be designed in Paper.design once name/branding is locked

Resolved: canvas resizes/reflows with panel state (not floating-overlay) — confirmed via Figma reference behavior.

## Secondary reference resource
**Tela** (github.com/search for "Tela local-first design canvas") — an open-source, local-first, self-hostable Figma/Canva-alternative design canvas with no account and no backend, built on React + Zustand + Tailwind. Worth studying (not forking) specifically for its state-persistence and no-backend architecture patterns, since that constraint match is rare — most canvas-editor reference projects assume a server-backed account model, which this project deliberately doesn't have. Its actual use case (social/ad graphics) differs enough from spreads/sequencing/imposition that adapting its code directly isn't recommended — read it for architecture, build the data model fresh.

## Explicitly out of scope for v1


- Accounts/login/email capture (Stripe Checkout's own optional receipt fields are sufficient signal)
- Hard DRM / license enforcement / phone-home validation
- Full ICC color management (ships as stretch goal, not v1 requirement)
- Any InDesign-parity features outside sequencing/typography/export (tables, long-document TOC, plugin ecosystem, print separations UI)
