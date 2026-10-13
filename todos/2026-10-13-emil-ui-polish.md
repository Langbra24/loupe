# Whole-app polish pass (`/emil-ui-polish`, issue #9)

Same scope, build, method and exclusions as [`2026-10-13-emil-ui-review.md`](2026-10-13-emil-ui-review.md). That report covers interaction, accessibility, motion and hierarchy. This one covers the invisible details: font rendering, layout shift, numbers, hit areas, stacking, empty states and flash on refresh. Findings in one report aren't repeated in the other.

Report only, with no app code changes. Screenshots are in [`2026-10-13-ui-shots/`](2026-10-13-ui-shots/).

## Verdict: **Approve with changes**

The base is sound:
- `antialiased` is on `<html>` (`apps/web/app/layout.tsx:19`), and fonts are subset to Latin.
- No control changes font weight on hover or selection.
- Hover transitions name their properties, apart from Button and Badge, which are reported as review S4.
- Decorative layers are `pointer-events-none` (`canvas-region.tsx:173`, `light-table.tsx:429`, `color-picker.tsx:397,421`).
- The page scrollbar is native, and the custom one is scoped to the side panels.

The misses are the classic ones:
- labels and numbers that change width;
- small hit areas;
- a faux italic;
- an empty project that flashes on every reload.

---

## Should fix

### P1. Every in-progress label changes the width of its button

**Where:**
- `apps/web/components/shell/export-dialog.tsx:196-197`: "Export" → spinner + "Exporting…".
- `apps/web/components/shell/feedback-control.tsx:166`: "Submit feedback" → "Sending…".
- `apps/web/components/sequence/import-photos.tsx:61`: "Import photos" → "Importing 3 of 6…", in the centred empty state.

**What's wrong:**
- The button resizes the moment it's pressed.
- The Export and Feedback buttons are right-aligned, so the button's left edge and its neighbour (Cancel) jump sideways.
- The import button is centred, so it grows in both directions on every progress tick.

**Fix:**
- Keep the label and show progress beside it or under it. Export already has a progress line at `:185`.
- Or give the button a `min-width` matching its widest state, and overlay the spinner without adding width.

### P2. Changing numbers aren't tabular

**Where:**
- `apps/web/components/sequence/canvas-controls.tsx:65`: zoom readout.
- `apps/web/components/shell/export-dialog.tsx:185`: "Rendering page n of m…".
- `apps/web/components/sequence/light-table.tsx:513`: "Importing n of m…".
- `apps/web/components/shell/number-field.tsx:83`: every margin and X/Y/W/H field.
- `apps/web/components/shell/color-picker.tsx:238`: RGB/CMYK channels.

**What's wrong:**
- The audit measured the zoom readout's text at 16.05 → 16.75 → 18.38px across 7%, 9% and 11%. It's centred, so the digits wobble on every zoom step.
- The channel fields and number fields re-render on every pointermove while you drag the square, hue slider or a stepper.
- The feedback counter (`feedback-control.tsx:159`) already uses `tabular-nums`; nothing else does.

**Fix:** `tabular-nums` on all five.

### P3. Hit areas under 40px, down to 10px

Desktop-only, so these are judged against the 40×40 desktop floor in `emil-ui-polish` §8, not the 44px touch floor. Sizes are from the audit's bounding boxes.

| Control | Where | Size |
| --- | --- | --- |
| Number-field steppers | `apps/web/components/shell/number-field.tsx:90-107` | **10×10** |
| Export "why blank pages" info button | `apps/web/components/shell/export-dialog.tsx:220` | 20×20 |
| Book name (rename) | `apps/web/components/shell/layers-panel.tsx:121` | 215×**20** |
| Import / Add text / Undo / Redo | `apps/web/components/sequence/light-table.tsx:474,541`, `import-photos.tsx:48` (`icon-xs`) | 24×24 |
| Dismiss: intro X, error banner, toast | `introduction.tsx:55`, `error-banner.tsx:37`, `ui/toast.tsx:156` | ≈24×24 |
| Canvas/Book tabs, alignment tabs | `apps/web/components/ui/tabs.tsx:57` | ×24 tall |
| Zoom out / in / fit, About | `canvas-controls.tsx:102`, `introduction.tsx:102` (`icon-sm`) | 28×28 |

**What's wrong:**
- The steppers are the outlier: two 10px targets stacked inside a 26px field, which also only appear on hover.
- The two canvas toolbars use different sizes for the same kind of button: the top-left pills are 24px, the bottom-right cluster 28px ([`page-selected.png`](2026-10-13-ui-shots/page-selected.png)).

**Fix:**
- Extend hit areas with a pseudo-element (`relative before:absolute before:-inset-2`). For the steppers, make each half of the field's right edge its own full-height target.
- Use one icon-button size for both canvas toolbars.

### P4. "Brandon Lang" is a faux italic

**Where:**
- `apps/web/components/shell/introduction.tsx:72` (`<em>`);
- `apps/web/lib/fonts.ts:31` (Geist loaded without an italic);
- `apps/web/app/globals.css:131-144` (no `font-synthesis` rule).

**What's wrong:**
- The production CSS has no `font-style: italic` `@font-face` at all; I checked every stylesheet the page links.
- The browser slants Geist upright to fake it ([`intro.png`](2026-10-13-ui-shots/intro.png)), on the one line that names the person who made the app.

**Fix:**
- Add `font-synthesis: none` to `body`, so a missing style fails visibly instead of being faked.
- Show emphasis with `text-foreground` alone, which it already has, or load an italic face.

### P5. A reload flashes the empty project and the intro

**Where:**
- `apps/web/components/shell/app-shell.tsx:36-42`: hydrates IndexedDB after mount.
- `apps/web/components/shell/introduction.tsx:110-116`: shows whenever the project looks empty.

**What's wrong:** the audit set up a book, reloaded, and sampled every animation frame. The first three frames (t = 44, 77 and 103ms) painted:
- the intro dialog;
- the "Bring in your photographs" empty state;
- "Pages 0" in the inspector;

and only then the real project.

The intro's focus effect (`introduction.tsx:40-42`) also fires during that flash, moving focus to "Get started" just before the button unmounts.

**Why it hurts:** every returning bookmaker sees an empty book for a beat. For a local-first app with no backup, "my book is gone" is the worst thing to suggest, even for 100ms.

**Fix:**
- Add a `hydrated` flag to the store, set when `hydrate()` resolves.
- Until it's set, render the shell frame without panel contents, empty state or intro.
- `emil-ui-polish` §13: render the real state on first paint, never default-then-correct.

---

## Nits

- **N1. No z-index scale.**
  - Where: `z-10` (`tabs.tsx:57`); `z-20` (toolbars, bottom-left controls); `z-30` (book setup, error banner, context-menu click-away); `z-40` (intro, context menus); `z-50` (every portal); and `z-[calc(1000-var(--toast-index))]` on toasts (`ui/toast.tsx:87`).
  - Fix: name the steps as tokens in `globals.css`, for example `--z-canvas-chrome`, `--z-overlay`, `--z-popover`, `--z-toast`.
  - Grounding: `emil-ui-polish` §7.
- **N2. No `text-wrap: balance` on headings.**
  - Where: intro `h1`, dialog and popover titles, the book-setup `h2` (`globals.css` base layer).
  - What: all short today, but cheap insurance.
  - Grounding: `emil-ui-polish` §5.
- **N3. Empty states don't offer the action they describe.**
  - Where: `apps/web/components/shell/canvas-region.tsx:57-60` and `apps/web/components/shell/layers-panel.tsx:197-200`.
  - What: both say "Set up the book…" with no button, and in the Book view the setup lives on the other tab.
  - Fix: add a "Go to canvas" action, or switch to the canvas automatically.
  - Grounding: `emil-ui-polish` §11.
- **N4. Truncated values have no way to read them in full.**
  - Where: image Name (`inspector-panel.tsx:420`), the book name (`layers-panel.tsx:121`, whose `title` is "Rename book", not the name), page rows (`layers-panel.tsx:245-246`).
  - Fix: `title={value}` on each.
- **N5. Press feedback is inconsistent.**
  - Where: shadcn `Button` nudges `translate-y-px` on `:active` (`ui/button.tsx:7`); the hand-rolled buttons (preset buttons, page rows, book-setup sizes, context-menu items) have no press state.
  - Fix: one treatment app-wide, `active:scale-[0.96]` per the skill.
  - Grounding: `emil-ui-polish` §6.
- **N6. Two scrollbar styles.**
  - Where: the side panels use the custom `ScrollArea` with a `bg-border` thumb (1.37:1 against the panel, so hard to find); the Book overview uses the native scrollbar (`canvas-region.tsx:36`).
  - Fix: pick one and give the thumb enough contrast.
  - Grounding: `emil-ui-polish` §10.
- **N7. Seven font files preloaded on first paint.**
  - Where: `apps/web/lib/fonts.ts`, with all variables on `<html>` in `app/layout.tsx:19`.
  - What: the served HTML has 7 `<link rel="preload" as="font">`, but the shell itself uses Lora and Geist.
  - Fix: set `preload: false` on the text-element-only families.
  - Grounding: `emil-performance`.
- **N8. A hex value typed in the picker loses its mono face.**
  - Where: the Color trigger shows the hex in mono (`color-picker.tsx:115`); the picker's own hex field (`:164`) is sans ([`color-picker.png`](2026-10-13-ui-shots/color-picker.png)).
  - Fix: use the same face for both.
