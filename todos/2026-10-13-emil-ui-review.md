# Whole-app UI review (`/emil-ui-review`, issue #9)

Reviewed on `main` @ `c37887e` (2026-10-13). This is a review only: no app code changes. The maintainer triages these findings into fix issues.

**Scope:**
- the shell: top nav, layers panel, all four inspector states, canvas toolbars;
- every dialog: intro, book setup, export, feedback;
- toasts and the color picker;
- the canvas's own chrome: selection, guides, frame grid, add-page buttons, context menus.

**Method:**
- I read every file under `apps/web/components` and `apps/web/app/globals.css`, plus the canvas chrome in `use-fabric-canvas.ts`.
- I captured all `npm run screenshot` scenes.
- I ran a Playwright audit against the production build covering:
  - a Tab walk in each state, recording where focus lands and how it shows;
  - the ARIA snapshot of the inspector in each state;
  - context-menu focus;
  - Escape on overlays;
  - reduced-motion emulation;
  - hit-area sizes;
  - WCAG contrast of the token pairs.
- Every claim below is either quoted from that run or read from the cited line. Where I'm inferring rather than measuring, the finding says so.

**Evidence:** screenshots are in [`2026-10-13-ui-shots/`](2026-10-13-ui-shots/). Scene captures come from `npm run screenshot`. `book-view.png` and `context-menu.png` come from the audit run.

**Companion report:** the invisible-details pass (layout shift, tabular numbers, hit areas, font rendering, flash on refresh) is in [`2026-10-13-emil-ui-polish.md`](2026-10-13-emil-ui-polish.md). Findings that belong there aren't repeated here.

**Desktop-only:** per CLAUDE.md, touch and mobile rules (44px targets, 16px inputs against iOS zoom) are judgment calls. None of the findings below rests on them.

**Not re-reported** (decided and recorded):
- full-width sidebar dividers (#25);
- left-aligned margin fields (#40);
- bleed always on (#30);
- single-click select / double-click edit (#14);
- right-click menus existing at all (user-directed, overriding the CLAUDE.md deferral);
- the stagger reveal on the Export and Feedback dialogs (user-directed);
- the Paper-referenced field shapes, mono page numbers and Lucide chevrons (the override is documented in `select.tsx`);
- whether the intro should be a true modal (open question on PR #46).

---

## Verdict: **Blocked**

Two findings break the accessibility floor:
1. Most inspector controls have no accessible name.
2. The canvas context menus are mouse-only, and one action they hold, *Set as cover*, has no other way in.

Everything else is craft work that can ship in any order.

---

## Blocking

### B1. Inspector controls and book-overview pages have no accessible name

**Where:**
- `apps/web/components/shell/inspector-panel.tsx:650-656`: `Section`'s `<h2>` labels nothing.
- `inspector-panel.tsx:310`: Text textarea.
- `:333`, `:340`, `:346`: Type, Size and Font selects.
- `:425`: Fit select.
- `:721`: Position select.
- `:361` with `:636-646`: Width `PercentField` has no label.
- `:284`: margin fields.
- `apps/web/components/shell/number-field.tsx:89-107`: the stepper buttons sit inside the wrapping `<label>`.
- `apps/web/components/shell/color-picker.tsx:105-118`: Color trigger.
- `apps/web/components/shell/canvas-region.tsx:84-94`: book-overview page buttons.

**What's wrong:** the audit's ARIA snapshots (each inspector state, after setup):
```
- combobox: body                 ← Type
- combobox: 24pt                 ← Size
- combobox: Lora                 ← Font
- combobox: cover                ← Fit
- combobox: Page 1               ← Position
- textbox: Ink                   ← Text
- button "#18181b"               ← Color
- spinbutton "% Increase Decrease": "27"        ← Width
- spinbutton "Top Increase Decrease": "35"      ← every margin / X / Y / W / H field
```
The book overview's ten page previews were reached by Tab as `button ""`: no name at all.

**Why it hurts:**
- A screen-reader user hears "combobox, body" with no idea it's the type role, and "button, empty" for every page in the book.
- The stepper names leak into every number field's label, so each one reads "Top Increase Decrease".
- This fails WCAG 4.1.2 / 1.3.1, the floor.

**Fix:**
- `Section` renders its title with an `id` and passes it down; each control gets `aria-labelledby`. For the textarea, `<label>` works too.
- In `NumberField`, put `aria-hidden="true"` on the stepper column. The steppers are already `tabIndex={-1}`, and the arrow keys step the input natively.
- Give the Width `PercentField` an `aria-label` when it has no visible label.
- Color trigger: `aria-label={\`Text color, ${value}\`}`.
- Book overview: `aria-label={\`Page ${frame.position + 1}\`}` on each preview button.

**Grounding:** `emil-touch-and-accessibility` (every control named), `emil-forms-and-inputs` (label association).

### B2. Canvas context menus are mouse-only, and "Set as cover" exists nowhere else

**Where:**
- `apps/web/components/sequence/light-table.tsx:273-335` (`ImagePresetMenu`);
- `:337-372` (`EmptyCanvasContextMenu`);
- `:380-425` (`FrameContextMenu`).

Screenshot: [`context-menu.png`](2026-10-13-ui-shots/context-menu.png).

**What's wrong:** after a right-click on a page, the audit found:
- no `role="menu"` or `menuitem` in the DOM (`menuRoles: 0`);
- `document.activeElement` still `BODY`;
- ArrowDown leaving focus on `body`.

The items are bare `<button>`s that Tab never reaches before the click-away layer.

`setFrameCover` is called only from these two menus (`rg setFrameCover` shows `light-table.tsx:220,236` and nothing else). "Add new page" at the end of the book lives only in the empty-canvas menu and on the canvas-drawn add-page buttons, which are Fabric objects and also mouse-only.

The menus are also placed at the raw click point (`style={{ left: target.x, top: target.y }}`) with no collision handling. A right-click near the canvas's bottom or right edge puts the menu partly off-screen. That last point comes from reading the code: the audit's edge click didn't open a menu, so it has no screenshot.

**Why it hurts:**
- A keyboard user can't mark a cover at all.
- They can't add a page except by copy-paste (Cmd/Ctrl+C, V).
- A screen reader announces these as a loose pair of buttons, not a menu.

**Fix:**
- Build all three menus on Base UI's `ContextMenu`/`Menu`. `apps/web/components/ui/dropdown-menu.tsx` already wraps Base UI Menu and is currently unused. That gives roles, focus moved into the menu, arrow-key navigation, Escape with focus return, and collision-aware positioning for free.
- Separately, give *Set as cover* and *Add page* a keyboard path. The shape of that is the maintainer's call: a frame-sidebar control, a shortcut, or the menu opened by Shift+F10 / the Menu key on the selected frame.

**Grounding:** `emil-touch-and-accessibility` (keyboard parity, menus), STANDARDS "Interaction correctness".

---

## Should fix

### S1. The focus ring is 1.77:1 against the shell, and there are two different focus treatments

**Where:**
- `apps/web/app/globals.css:46` (`--ring`) and `:133` (`outline-ring/50`);
- every `focus-visible:ring-ring/50` (Button `apps/web/components/ui/button.tsx:7`, Tabs, Select, fields).

**What's wrong:**
- The audit measured `--ring` at 50% over `--background` at **1.77:1**, below the 3:1 that WCAG 2.4.13 / 1.4.11 ask of a focus indicator.
- Controls without explicit focus styles fall back to the browser's `outline: auto` instead of the ring. Examples:
  - layers rows, `layers-panel.tsx:229`;
  - book-setup presets, `book-setup-dialog.tsx:73-99`;
  - book-overview previews, `canvas-region.tsx:84`;
  - context-menu items.
- So one Tab walk alternates between Chrome's two-tone outline and a faint grey glow. Compare Page 2's ring with Page 1's selection in [`book-view.png`](2026-10-13-ui-shots/book-view.png).

**Why it hurts:** keyboard users lose track of focus on the subtler ring, and two styles read as unfinished.

**Fix:**
- Raise the ring to ≥3:1. For example, use `--ring` at full opacity, or a lighter token near `--primary`. Neutral grey is right per `emil-ui-polish`; just make it stronger.
- Give the bare buttons the same `focus-visible:ring-*` treatment so there's one focus style app-wide.

**Grounding:** `emil-touch-and-accessibility`, `emil-color`.

### S2. Reduced motion is ignored by the shell, every popup and the canvas

**Where:**
- `apps/web/components/shell/app-shell.tsx:50`: grid column transition.
- Every `data-open:animate-in … zoom-in-95` popup, because `tw-animate-css` has no `prefers-reduced-motion` rule (checked: 0 occurrences in `node_modules/tw-animate-css/dist/*.css`):
  - export dialog backdrop and popup, `export-dialog.tsx:136,140`;
  - color picker, `color-picker.tsx:132`;
  - feedback, `feedback-control.tsx:112`;
  - selects, `ui/select.tsx:75`;
  - tooltips, `ui/tooltip.tsx:53`.
- Fabric frame tweens, `use-fabric-canvas.ts:1220`, `:1793`.

**What's wrong:** with `reducedMotion: "reduce"` emulated, the audit read the shell grid as still transitioning `grid-template-columns 0.2s`. The intro, stagger, tab rail, inspector fade and toasts do honour it; these don't.

**Why it hurts:** scale-and-slide motion is exactly what reduced-motion users opted out of. The frame snap happens on every reorder.

**Fix:**
- Add `motion-reduce:animate-none` (or a global `@media (prefers-reduced-motion: reduce)` override for the `animate-in`/`animate-out` utilities), keeping only the opacity fade.
- Use `motion-reduce:transition-none` on the grid.
- In the Fabric tweens, read `matchMedia("(prefers-reduced-motion: reduce)")` and `set` the end position directly.

**Grounding:** `emil-animations`.

### S3. The inspector delays every variant change by 150ms, with `ease-in`

**Where:** `apps/web/components/shell/inspector-panel.tsx:129-136`, `:150`.

**What's wrong:**
- Changing what's selected (frame → image → nothing) fades the old sidebar out over `150ms ease-in`, and only then swaps in the new one.
- This runs on high-frequency actions: every click on the canvas, `]` / `[` image cycling (keyboard), and Escape.

**Why it hurts:**
- The sidebar lags the canvas by 150ms on an action done hundreds of times a session. Keyboard-initiated changes in particular should be instant.
- `ease-in` on UI is called out in the standards.

**Fix:** swap the content immediately. If any motion stays, fade the incoming content in only, at ~150ms with `ease-out`. Never delay the swap.

**Grounding:** `emil-animations` (frequency rule, easing).

### S4. `transition: all` on every Button and Badge

**Where:** `apps/web/components/ui/button.tsx:7`, `apps/web/components/ui/badge.tsx:8`.

**What's wrong:** `transition-all` animates any property that changes: padding when an icon appears, width when a label changes (see polish P1), the press `translate-y-px`.

**Fix:** `transition-[color,background-color,border-color,box-shadow,transform]`.

**Grounding:** STANDARDS escalation trigger, `emil-ui-polish` §6.

### S5. The top nav's "Share" button does nothing

**Where:** `apps/web/components/shell/top-nav.tsx:19-22`. There's no `onClick` and no wrapper.

**What's wrong:** it's focusable, styled as a live action, and sits beside the primary Export. Clicking it does nothing.

**Why it hurts:** a dead control in the one frame that never changes teaches users the chrome can't be trusted.

**Fix:** remove it until sharing exists, or render it disabled with a tooltip ("Sharing is coming").

**Grounding:** `emil-design-foundations` (one clear primary action, no decoys).

### S6. Book overview draws pages as dark cards, not white paper, and ignores text colour

**Where:** `apps/web/components/shell/canvas-region.tsx:87` (`bg-card`), with text at `:142-151`.

Screenshot: [`book-view.png`](2026-10-13-ui-shots/book-view.png).

**What's wrong:**
- Every page preview is `bg-card` (zinc-900).
- On the canvas and in export a page is white paper, and a text element defaults to `#18181b` (`DEFAULT_TEXT_COLOR`, `inspector-panel.tsx:89`).
- `FrameElementBox` sets no `color`, so captions inherit the shell's light foreground and any colour picked in the inspector is dropped. Light-on-dark stays legible, but it's the inverse of the printed page.
- This comes from reading the code: the audit book had no text in it.

**Why it hurts:** the overview's whole point (see the comment at `canvas-region.tsx:19-30`) is seeing the real book front to back. Dark pages with recoloured text aren't the real book.

**Fix:** use `bg-white` for the page and apply `element.color ?? DEFAULT_TEXT_COLOR` to text, matching `render-frame.ts`. Both changes go together: honouring the colour on the dark card alone would make default text vanish.

**Grounding:** `emil-surfaces`, `emil-color`.

### S7. Canvas selection is barely visible on pages, and the canvas uses four unrelated blues

**Where:** `apps/web/components/sequence/use-fabric-canvas.ts`:
- frames set no `borderColor`, so they get Fabric's default ~1px light blue (frame rect `:1759`);
- images use `#6366f1` (`:1468`, `:2124`);
- text uses `#18a0fb` (`:64`);
- the margin guide also uses `#18a0fb` (`:1636`);
- the cover badge also uses `#18a0fb` (`:1678`);
- the drop indicator is cyan `#22d3ee` (`:671`);
- the frame stroke is slate `#94a3b8` (`:1759`), not the app's zinc.

Screenshots: [`page-selected.png`](2026-10-13-ui-shots/page-selected.png) shows page 1 selected with the border barely distinguishable. [`text-selected.png`](2026-10-13-ui-shots/text-selected.png) shows the text selection box in the same blue, crossing the same-blue margin guide.

**Why it hurts:**
- A selected page is hard to spot at fit zoom.
- Text selection and the margin guide are the same colour where they overlap, so it's unclear which line is which.
- Indigo vs blue for image vs text selection reads as a bug, not a distinction.

**Fix:**
- One selection colour for frames, images and text, at a stroke width set in screen pixels (Fabric's `borderScaleFactor`).
- Keep the guide colours (red bleed, blue margins) distinct from selection, and the cover badge distinct from the margin guide.
- Draw the frame stroke from the zinc scale.

**Grounding:** `emil-color`, `emil-surfaces`.

### S8. Add-page buttons and the cover badge shrink to a few pixels at normal zoom

**Where:** `apps/web/components/sequence/use-fabric-canvas.ts:916` (`size = 48`), `:1670` (`size = 36`).

**What's wrong:**
- Both are sized in scene units, and one scene unit is one source-image pixel (CLAUDE.md).
- At the fit zoom the screenshots open at (6–9%), the 48-unit add-page button renders as a ~4px black dot beside the selected page ([`page-selected.png`](2026-10-13-ui-shots/page-selected.png), x≈548 y≈289).
- The 36-unit cover badge is about 3px.

**Why it hurts:** the affordance for adding a page is effectively invisible, and too small to hit, at the zoom people actually work at.

**Fix:** size this chrome in screen pixels. Divide by `canvas.getZoom()` on every viewport change, the way `syncDotGrid` already decouples the dot grid from zoom, or draw it in a DOM overlay positioned from the frame's viewport rect.

**Grounding:** `emil-ui-polish` §8 (hit areas), `emil-design-foundations`.

### S9. Toasts cover the canvas zoom controls

**Where:** `apps/web/components/ui/toast.tsx:66` (`fixed right-4 bottom-4`) against `apps/web/components/sequence/canvas-controls.tsx:49` (`absolute right-3 bottom-3`).

Screenshot: [`feedback-error.png`](2026-10-13-ui-shots/feedback-error.png). The error toast sits over the zoom cluster.

**Why it hurts:** for the toast's lifetime the zoom controls are hidden and unclickable. Error toasts stay long enough to matter.

**Fix:** offset the viewport above the cluster (`bottom-16`), or move toasts to the top-right, under the nav.

**Grounding:** `emil-design-foundations` (layout), `emil-ui-polish` §7 (stacking).

### S10. The intro overlay ignores Escape

**Where:** `apps/web/components/shell/introduction.tsx:47-51`.

**What's wrong:** the audit pressed Escape with the intro up, and the intro was still showing (`introEscapeDismisses: false`). The X button and "Get started" both dismiss it, so Escape should too.

**Fix:** an `onKeyDown` handler for Escape that calls `dismissIntroduction`. This is independent of the open modality question on PR #46.

**Grounding:** STANDARDS "Escape dismisses overlays", `emil-touch-and-accessibility`.

### S11. An empty project's saddle-stitch line is styled as an error

**Where:** `apps/web/components/shell/inspector-panel.tsx:191-197`.

Screenshot: [`shell.png`](2026-10-13-ui-shots/shell.png). "Add pages to get started." is in destructive red on first run.

**Why it hurts:** a brand-new project greets the user with a red line before they've done anything wrong. It's an empty state, not a failure.

**Fix:** use `text-muted-foreground` when `frames.length === 0`. Keep red for a real count that can't be stitched.

**Grounding:** `emil-design-foundations` (empty and error states), `emil-ui-polish` §11.

### S12. Book setup: copy promises what the app can't do, and the form is half-wired

**Where:** `apps/web/components/sequence/book-setup-dialog.tsx`:
- `:63-65` copy;
- `:91-99` Custom button;
- `:104-118` custom inputs;
- `:122-124`, `:144-146` errors.

**What's wrong:**
- "You can change this later." Page size can't be changed later. Both inspector states show it read-only (`inspector-panel.tsx:185`, `:248`; the comment at `:673-675` says "a frame's page size is fixed once the book is set up").
- The preset buttons carry `aria-pressed`, but *Custom* doesn't.
- The custom width and height inputs use a different field style (`bg-background`, no focus ring) from the page-count field next to them.
- Validation messages aren't tied to their inputs (`aria-invalid`, `aria-describedby`).
- Choosing Custom grows the card 40px, and since it's vertically centred it jumps up 20px. The audit measured y 296 → 276, height 356 → 396.

**Why it hurts:** the copy sets up a wrong expectation for a decision that is in fact permanent. The rest makes the one required form feel unfinished.

**Fix:**
- Copy: "Page count can change later; page size is fixed for this book." (or whatever the maintainer intends).
- Add `aria-pressed` to Custom.
- Use the shared field classes.
- Wire `aria-invalid` and `aria-describedby`.
- Reserve the custom row's height, or anchor the card to the top instead of centring it.

**Grounding:** `emil-forms-and-inputs`, `emil-design-foundations` (copy).

### S13. Feedback textarea has no Cmd/Ctrl+Enter submit

**Where:** `apps/web/components/shell/feedback-control.tsx:144-154`.

**What's wrong:** the only way to submit is to Tab to the button or click it.

**Fix:** handle `(metaKey || ctrlKey) && key === "Enter"` in the textarea and call `handleSubmit`, and show the hint on the button's tooltip.

**Grounding:** `emil-forms-and-inputs` (Cmd+Enter submission).

### S14. State that sighted users see isn't exposed

**Where:**
- `apps/web/components/shell/inspector-panel.tsx:440-453`: image preset buttons.
- `apps/web/components/shell/layers-panel.tsx:229-247`: page rows.
- `apps/web/components/sequence/canvas-controls.tsx:60-66`: zoom readout.

**What's wrong:**
- The active layout preset is shown by fill only; there's no `aria-pressed`.
- The selected page row is shown by `bg-muted` only; there's no `aria-current` or `aria-pressed`. Its name also runs together: the audit read `button "Page 235/25/25/35mm margins"`.
- The zoom readout's accessible name is just `"7%"`; its action, *Reset to 100%*, is only in the tooltip (`aria-label` read `null`).

**Fix:**
- `aria-pressed={preset === activePreset}` on the preset buttons.
- On page rows, `aria-current` plus an `aria-label` like `Page 2, margins 35/25/25/35 mm`.
- On the zoom readout, `aria-label={\`Reset zoom to 100% (currently ${pct}%)\`}`.

**Grounding:** `emil-touch-and-accessibility`.

---

## Nits

- **N1. The inspector starts 56px lower than the layers panel.**
  - Where: `apps/web/components/shell/inspector-panel.tsx:148` (`pt-14`).
  - What: the left panel's first line sits at y≈68, the right's at y≈111 ([`shell.png`](2026-10-13-ui-shots/shell.png)). The two columns don't share a top edge.
  - Fix: align both to the same first baseline.
  - Grounding: `emil-design-foundations`.
- **N2. Inspector rows invert hierarchy.**
  - Where: `apps/web/components/shell/inspector-panel.tsx:661-663`.
  - What: the muted label is `text-sm` while its value is `text-xs`, so "Page size" outweighs "A5 Portrait" ([`shell.png`](2026-10-13-ui-shots/shell.png)).
  - Fix: same size for both, with hierarchy from colour.
  - Grounding: `emil-typography`.
- **N3. Placeholder rows ship in the product.**
  - Where: `apps/web/components/shell/inspector-panel.tsx:204-205`.
  - What: "Fold preview —" plus "…are placeholders."
  - Fix: hide them until the features exist.
  - Grounding: `emil-design-foundations` (restraint).
- **N4. The left panel repeats its own tab name as a heading.**
  - Where: `apps/web/components/shell/layers-panel.tsx:164`.
  - What: the "Canvas" tab is followed by a "Canvas" label.
  - Grounding: `emil-design-foundations`.
- **N5. Book-overview selection and focus look the same, and hover does nothing visible.**
  - Where: `apps/web/components/shell/canvas-region.tsx:86-89`.
  - What: selection and focus both use `outline`, so a focused selected page looks identical to an unfocused one. `hover:shadow-md` is invisible on the dark shell.
  - Fix: show selection with a ring and leave `outline` to focus; use a lighter border for hover.
  - Grounding: `emil-surfaces`.
- **N6. Toast enter and exit run 500ms.**
  - Where: `apps/web/components/ui/toast.tsx:89`.
  - What: the strong ease-out makes the entry feel shorter, but exits should be faster than entries (~200ms).
  - Grounding: `emil-animations`.
- **N7. The Export info tooltip covers the dialog's own description.**
  - Where: `apps/web/components/shell/export-dialog.tsx:226`.
  - What: `side="right"` overlaps "…with bleed." ([`export-dialog.png`](2026-10-13-ui-shots/export-dialog.png)).
  - Fix: `side="bottom"` or `"top"`.
- **N8. Panel collapse has an animation but no trigger.**
  - Where: `apps/web/components/shell/app-shell.tsx:50`.
  - What: the column transition is wired, but nothing calls `toggleLeftPanel` or `toggleRightPanel` (only `state/editor-store.ts:1132-1133` defines them).
  - Fix: either add the controls or drop the dead path.
- **N9. Alignment uses tab semantics for a value choice.**
  - Where: `apps/web/components/shell/inspector-panel.tsx:547`.
  - What: a `tablist` with no `tabpanel`s.
  - Fix: a radio group (or toggle group) announces it as a choice.
  - Grounding: `emil-touch-and-accessibility`.
- **N10. Field boundaries are faint.**
  - Where: `apps/web/app/globals.css:44-45`.
  - What: `--border` measures 1.37:1 and the `bg-input/30` fill 1.61:1 against the shell, under the 3:1 non-text contrast suggested for input boundaries. These follow the Paper references, so this is the maintainer's call.
  - Grounding: `emil-color`.
- **N11. Two icon families sit side by side in the canvas toolbar.**
  - Where: `apps/web/components/sequence/light-table.tsx:5` (Lucide `Type`, `Undo2`, `Redo2`, `Trash2`) next to Phosphor `Plus` (`import-photos.tsx:4`).
  - What: the Lucide override is documented for chevrons and checks in `select.tsx:14-17`, not for these. The stroke weights visibly differ within one pill ([`page-selected.png`](2026-10-13-ui-shots/page-selected.png), top left).
  - Grounding: `emil-design-foundations` (iconography).
