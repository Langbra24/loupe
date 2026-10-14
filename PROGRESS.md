# Progress

A running log across sessions. **Every session reads this first and appends an
entry last**: date, issue, branch, what changed, how it was verified, and
anything the next session needs to know (blockers, half-finished work,
surprises). Newest entries at the bottom.

## 2026-10-12 — cloud-session setup (`claude/nice-turing-1hi5nc`)

- Added `npm test` / `verify` / `screenshot` / `e2e`, `scripts/verify/`, PLAN.md, this file, and CLAUDE.md's "Cloud sessions" rules. Labels `cloud-ok` / `local-only` created on GitHub.
- Merged `main` @ `bd2c87b` (export dialog, editable book name). `npm run verify` passes; `npm run screenshot` saves intro/shell/book.
- `npm run e2e` reaches a real PDF download and fails 2 of its checks — both real export gaps, not verifier bugs:
  - PDF has as many pages as the book (10), not padded to a multiple of 4.
  - Pages are trim + 3mm bleed (154×216mm) with no TrimBox, so the trim size isn't recorded in the file.
- Project board not created: Projects v2 needs GraphQL, blocked from cloud sessions. Must be made locally.

## 2026-10-13 — #5 verify the book name is editable (`issue-5-rename-verifier`)

- New verifier `scripts/verify/rename.mjs` (`npm run verify:rename`): Escape cancels, empty/whitespace refused, Enter and blur commit, `T` in the field types a T and leaves the text tool unarmed (canvas cursor stays `default`; pressing `T` on the canvas flips it to `text`, so the check is not vacuous), the name survives an immediate reload, and export downloads `field-notes-vol-2.pdf`.
- **Bug found and fixed: the `pagehide` flush never landed.** Any change made inside the 800ms save debounce was lost on reload or tab close. That included the rename and the whole book setup if you reloaded quickly. `flushPendingSave` awaited `getDb()` before writing, and Chromium drops that write during teardown. It now opens the transaction synchronously on the already-opened db (`getOpenedDb`) and calls `tx.commit()`. Commit alone without the sync open was not tested; the sync open alone was tested and still failed. Unit tests are in `project.test.ts`.
- Name field a11y (from `/emil-ui-review`): input labelled "Book name"; focus returns to the name after Enter/Escape; the button carries `title="Rename book"`.
- `npm run verify` passes; `npm run e2e` still fails only its 2 known checks.

## 2026-10-13 — #6 feedback submissions land as GitHub issues (`issue-6-feedback-issues`)

- **Reproduced on `main`:** with no token the route returns 500 "Feedback isn't configured on the server yet."; with a token GitHub rejects it returns 502. Either way the toast showed the same generic "Something went wrong on our end", because the client discarded the route's message. Without the deployed server's logs, there's no telling which of the two the live site hits. The new `[feedback]` log line will say.
- **Route:** missing or blank token → 503. GitHub 401/403/404/410 → a "setup problem on our side" message, with a log line naming the exact fix. A 403 or 429 with an exhausted rate limit → 503 "try again in a few minutes". 422 and network errors get their own messages. `GITHUB_API_URL` (server-only, default api.github.com) exists only so the verifier can stand in for GitHub.
- **Client:** the toast shows the route's message, or "Couldn't reach Loupe's server" when the browser can't reach it. The draft is kept on every failure. The popover fields now have accessible names.
- **Screenshot attachment:** removed deliberately before this PR (doc comment in `feedback-control.tsx`). The body is `{feedback, contact}`, which matches the route, so there's no body-size concern.
- **Verification:** 15 route tests. `npm run verify:feedback` (new) drives the real control and route against a local stand-in GitHub, 11/11 pass. Screenshot scene `feedback-error` added.
- **Not verified:** a real submission. No `GITHUB_FEEDBACK_TOKEN` exists in cloud sessions. The maintainer does the steps in README "Feedback setup" and confirms one issue lands.

## 2026-10-13 — #14 text boxes: single click selects, double click edits (`issue-14-text-selection`)

- Replaced the deliberate single-click-to-edit in `use-fabric-canvas.ts` with `SelectableTextbox` (`components/sequence/selectable-textbox.ts`). It's a `fabric.Textbox` subclass, because Fabric's own `IText` enters editing on any click on an already-selected box and selects a word on the double-click that starts editing. Once editing, double-click still selects a word.
- Escape while editing returns to selected with handles (Fabric's own behavior). A second Escape now deselects; the handler skips typing targets, so the first Escape doesn't do both.
- The `T` box still enters editing at once. `updateTextElement` no longer pushes an undo step when the content is unchanged; leaving editing always commits, so it used to add a junk step.
- Test hook: `window.__loupeCanvas`, only when built with `LOUPE_TEST_HOOKS=1`. It's inlined via `next.config.ts` `env`, so an ordinary build has no trace of it (checked by grepping `.next/static`). A `NEXT_PUBLIC_` var alone was NOT compiled out when unset; Next left a runtime `process.env` lookup.
- `npm run verify:text-selection` passes 15/15. Negative control: with Fabric's stock `Textbox` it fails 5 checks.
- New screenshot scene `text-selected`. It finds page 1 from the canvas pixels, since screenshot builds have no hooks.
- Open question for the maintainer: Enter on a selected text box to start editing (Figma does). Not built.

## 2026-10-13 — #15 color picker focus rings (`issue-15-picker-focus-rings`)

- `ColorChannelField` (R/G/B, C/M/Y/K) gets `NumberField`'s `focus-within` ring. The saturation/value square and hue slider were Tab-reachable with no focus style; they now get a `focus-visible` ring. The hex input already had a ring and now has an accessible name ("Hex color"). The RGB/CMYK tabs already had a ring.
- **Keyboard trap found and fixed.** Frame Tab-cycling (`useFrameKeyboardShortcuts`) swallowed every Tab whenever focus wasn't in a text field, so you couldn't Tab off any button, tab, or slider anywhere in the app once a book had frames. It now claims Tab only while focus is on the page body. **Still open:** from the body, Tab cycles frames and never reaches the UI. This is a product question, raised with the manager.
- The square and hue slider have `role="slider"` but no arrow-key handling. Noted, not built (per the issue).
- `npm run verify:picker-focus` (new) passes 12/12. Negative control on `main`'s components: 9 failures.
- New screenshot scene `color-picker-focus`. Shared helpers `firstPageCenter` / `openColorPicker` are in `scripts/verify/lib/app.mjs`. PR #16's `screenshot.mjs` has its own `firstPageCenter`; whichever merges second should import this one instead.

## 2026-10-13 — #19 `[` / `]` step through page images; Tab reaches the UI (`issue-19-bracket-frame-cycling`)

- First version (page cycling on `[`/`]`) was reworked on the same PR after the maintainer's direction change on #19: "it's the images that matter."
- `]` / `[` select the next / previous image placed in a page, in reading order (page position, then element order), wrapping. Pure helpers in `use-canvas-shortcuts.ts`: `pageImagesInReadingOrder` and `nextPageImage`.
- Selecting goes through `selectElementOnCanvas` (`use-fabric-canvas.ts`): `setActiveObject` fires the same selection events as a click, so the store and inspector follow. If the image isn't wholly in view, the viewport centers it and the zoom is unchanged. Nothing synced store → canvas before; the wiring moved from `app-shell.tsx` to `light-table.tsx`, where the canvas hook lives.
- `focusedFrameIndex` and its test hook are gone. Cmd/Ctrl+Arrow reorders the page holding the selection. Tab is never handled. The typing guard, the Ctrl/Cmd/Alt rule and the AltGr exception are unchanged.
- `npm run verify:image-cycling` (renamed from `verify:frame-cycling`) passes 11/11. Negative control with panning disabled: the off-screen check fails. 30 unit tests.

## 2026-10-13 — #20 Enter on a selected text box starts editing (`issue-20-enter-to-edit`)

- In `use-fabric-canvas.ts`, the key handler (`onEscape` → `onCanvasKey`) now also takes Enter: on a selected, non-editing text box, it calls `editAtEnd` (`selectable-textbox.ts`), which enters editing with a collapsed caret after the last character. It uses the same focus rule as Escape: only when focus is on the canvas or the page body.
- The Enter keydown is `preventDefault`ed. Without that, Chrome delivers the Enter to the textarea that just took focus, and the text gains a newline.
- While editing, Enter stays Fabric's newline, because that keydown targets the hidden textarea. Entering editing pushes no undo step (nothing does; the #14 store guard covers the exit).
- `verify:text-selection` gains 6a–6c plus a re-select after the reload, 20/20. Negative control with `main`'s canvas hook: 4 failures.

## 2026-10-13 — #21 arrow keys on the color picker's sliders (`issue-21-picker-arrow-keys`)

- `SaturationValuePicker` (`color-picker.tsx`): the hue slider takes ↑/→ +1°, ↓/← −1°, Shift ×10, and Home/End 0°/359° (clamped, no wrap). The square takes ←/→ for saturation and ↑/↓ for brightness, with the same steps, and Home/End set saturation 0/100. Handled keys are `preventDefault`ed.
- Keys commit through the same `onChange` as a drag. Color changes go through `updateTextElement({ color })`, which never pushes an undo step, so both drags and keys record none (the issue's "at most one per keystroke" holds).
- `aria-valuetext`: "Hue 165 degrees" and "Saturation 71%, brightness 78%". The hue's `aria-valuemax` is now 359, matching End. The square gained `aria-valuemin`/`aria-valuemax`.
- `npm run verify:picker-keys` (new) passes 13/13. Negative control on `main`'s picker: fails.

## 2026-10-13 — #25 full-width separators in the right sidebar (`issue-25-full-width-separators`)

- One rule on the inspector's content column (`inspector-panel.tsx`): horizontal `[data-slot=separator]` descendants get `-mx-3 w-auto`, so they bleed through the `px-3` in every state. The shared `ui/separator.tsx` is unchanged. Margins are horizontal only, so vertical spacing is identical; the before/after pairs line up row for row.
- `npm run verify:separators` (new) passes in all four states, with every divider at 1153–1440 (the panel's inner edges) and no horizontal scroll. Negative control on `main`'s inspector: all four fail (1165–1428).
- New screenshot scenes `page-selected` and `image-selected`, plus helpers `firstPhotoPoint`, `placePhotoOnFirstPage` and `placeTextOnFirstPage` in `lib/app.mjs`. They find the first pasteboard photo by its saturated pixels, so they need no test hooks.

## 2026-10-13 — end of day (manager)

- **Merged today:** #11 (#5 rename), #12 (#6 feedback errors), #16 (#14 text select/edit), #17 (#15 picker focus rings), #22 (#19 `[`/`]` cycle page images), #23 (#20 Enter to edit), #24 (#21 picker arrow keys), #26 (#25 full-width sidebar dividers), and #4 (emil skills). `main` @ 870b248: `npm run verify` green, all 8 verifiers pass, 8 screenshot scenes. `e2e` fails only its 2 known export checks.
- **Next up:** #27 (color undo), filed and not started. The executor session (`session_01Qfn3GngwN5fzJT6VYrzRkd`) is idle and can take it.
- **Blocked on the maintainer:** #7 and #8 need `docs/design/paper/color-picker-TF-0.png` and `image-selected-1G2-0.png`; #9 follows them. #6's final tick needs a real `GITHUB_FEEDBACK_TOKEN` submission. The export backlog needs a decision: pad to a multiple of 4 with blanks, or warn and block.
- **Known gap:** `verify:text-selection` and `verify:image-cycling` set `LOUPE_TEST_HOOKS=1` with POSIX syntax, so they don't run in a plain Windows shell.
- Merged branches are NOT deleted: the cloud proxy refuses branch deletion (API and `git push --delete` both 403). All 11 code branches are fully merged into `main`, and the 4 `pr-assets/*` branches hold only PR screenshots. Delete them from a local machine.


## 2026-10-13 — #30 record trim and bleed boxes in the PDF (`issue-30-trim-bleed-boxes`)

- Scope changed mid-issue: the maintainer dropped the bleed toggle. Bleed stays always on, as before, and no toggle work was committed. `pdf.ts` now sets each page's BleedBox to the full page (= MediaBox, trim + 3mm each side) and its TrimBox to the page size at 3mm offsets. The PNG zip is unchanged.
- `pdf-checks.mjs` checks one mode: MediaBox 154×216mm, an explicit TrimBox of 148×210mm at 3mm, and an explicit BleedBox equal to the MediaBox. Presence is checked first because pdf-lib's getters fall back to the MediaBox. There are 8 self-tests, one failing case per box.
- `npm run e2e`: all trim and bleed checks pass. Only the page-count check (#31) still fails.

## 2026-10-13 — #31 pad saddle-stitch books to a multiple of 4 at export (`issue-31-saddle-stitch-padding`, stacked on #30)

- The rule is in `core`: `padForSaddleStitch(frames)` in `sequence.ts`, beside `checkPageCount`, whose `blanksNeeded` it reuses. It returns the print sequence: pages in `position` order, then blanks, or blanks before the last page when that page `isCover` (more than one page). The project is never changed. There are 10 unit tests in `core/src/sequence.test.ts`.
- `renderExportPages` (`render-frame.ts`) yields canvases in print order. A blank is paper-white at the previous page's size, plus bleed. `pdf.ts` and `png-zip.ts` both use it, so blanks get the #30 trim/bleed boxes too.
- Dialog: "Adds 2 blank pages to reach 12" (real numbers, singular/plural) and an info button ("Why blank pages are added") whose tooltip opens on hover and keyboard focus. It opens to the right so it doesn't cover the dialog title.
- `npm run e2e` **passes fully** for the first time: 12 pages, every box right, pages 11–12 blank. A photo is placed on page 1 so the blank check can be seen to tell the difference. The dialog line and the keyboard tooltip are also checked. Both backlog lines in PLAN.md are now covered by #30/#31 and removed.

## 2026-10-13 — #34 feedback popup asks for context (`issue-34-feedback-copy`)

- The description line "Filed as a GitHub issue — no account needed." is now "The more detail, the better: what you were doing, what you expected, and what happened." It doesn't mention GitHub or screenshots (the maintainer decided against image storage for now).
- The textarea placeholder ("What's wrong, missing, or confusing?") stays: it asks *what*, the line asks for *detail*. The success toast is unchanged.
- New screenshot scene `feedback` (the open, empty popover). No verifier asserted the old copy; `verify:feedback` passes unchanged.

## 2026-10-13 — #27 color changes are undoable (`issue-27-color-undo`)

- `updateTextElement` pushes an undo step when `color` changes, through a `colorCommand` that sets the color back or forward. Re-setting the same color pushes nothing.
- Gestures: `beginTextColorGesture` / `endTextColorGesture` coalesce everything in between into one step, pushed at the end only if the color moved. They nest with a depth counter, because a press on the hue slider begins before the hex field it took focus from has blurred.
- Picker wiring (`color-picker.tsx`): a square or hue drag is a gesture (pointerdown → pointerup/pointercancel). The hex and channel fields are gestures from focus to blur, so typing a hex char by char is one step. Arrow keys: **one step per keypress**, not coalesced (a held key gives one step per repeat).
- Still not undoable: `role`, `align`, `fontSize` and `fontFamily` on text. Listed for the maintainer, not fixed here.
- Tests: 3 store tests (single change, coalesced gesture, no-op), each undone and redone. `npm run verify:color-undo` (new) passes 7/7: one undo reverts a 20-step drag, a second reverts the typed hex, and redo reapplies both. It fails on `main`.

## 2026-10-13 — #7 color picker matches the Paper reference (`issue-7-color-picker-paper`)

- Reference: `docs/design/paper/colorpicker.png` (698×761). Measured, it's the same 290px popover at ~2.297×: the square comes out at exactly 160px.
- Changes in `color-picker.tsx`:
  - the CMYK channel boxes overflowed the popover; fixed with `min-w-0` on each box;
  - 20px (was 8px) above the hex row and the channel row;
  - the hex field is 30px tall to match the swatch, in sans `text-sm` (was mono `text-xs`);
  - the segmented control has a visible track (`bg-input/70`, 3px inset, `rounded-sm` pill);
  - popover `rounded-xl` → `rounded-lg`; square `rounded-lg` → `rounded-md`.
- Kept: #15's focus rings, #21's arrow keys, all tokens. New scene `color-picker` (CMYK, #37bf7b) also saves the popover alone as `color-picker-popover.png`.

## 2026-10-13 — #40 left-align the page sidebar's fields (`issue-40-page-sidebar-paper`)

- Narrowed by the maintainer to one change: text in the page-selected sidebar's fields is left-aligned. Page size (`StaticFieldBox`, used only there) now uses `text-left`. The four Margin fields pass a new opt-in `align="left"` to the shared `NumberField`, whose default stays right, so the image sidebar's X/Y/W/H are unchanged. Position (a select) was already left-aligned.
- Nothing else changed: headings, the Bleed row, full-width dividers (#25), number formatting, copy.

## 2026-10-13 — make `npm run e2e` deterministic (`verify-e2e-deterministic`, no issue)

- 20 runs on `main` @ bbb88a6 gave 18 passes and 2 failures, both on "Tab reaches the info control … (never focused)". Logging focus after each Tab showed two causes. The Export dialog's initial focus is already on the info button, so the first Tab stepped past it. And Tab sometimes leaves the modal dialog into the page behind, so 12 presses landed somewhere different each run.
- Fix: focus the first format radio and press Shift+Tab once, a single keyboard step onto the info control. The assertion is unchanged. Same fix in the `export-dialog` screenshot scene. After the fix: 20/20.
- **Open app bug** (not fixed here, suggested as its own task): Tab escapes the modal Export dialog. It predates #31 and happens with the tooltip removed.

## 2026-10-13 — #45 dialog focus (`issue-45-dialog-focus-trap`)

- **Root cause of the Export dialog leak:** Base UI's modal trap redirects focus from its edge guards inside `requestAnimationFrame` (`enqueueFocus`). A Tab that arrives before the next frame (fast presses, or a main thread busy redrawing the canvas) leaves the guard for the page behind. Traced with focusin/`focus()`/rAF instrumentation: with 100ms between presses the trap held.
- **Fix:** `lib/focus-trap.ts` `trapTab` wraps Tab/Shift+Tab at the dialog's ends inside the same keydown, so the guards are never reached; it's wired on `Dialog.Popup`'s `onKeyDown`. Initial focus is now the selected format (`initialFocus` ref) instead of the info button, and the format cards show a ring when their sr-only radio has keyboard focus.
- **Intro and book setup aren't modal:** the top nav, and for book setup the side panels, stay usable by mouse. So they don't trap. Instead, what each one covers is `inert`: Tab can't reach what a click can't, and the uncovered UI stays reachable. Each focuses its main control on appear. Book setup gained `role="dialog"` and a label. The popovers (feedback, color picker) are non-modal by design and unchanged.
- `npm run verify:dialog-focus` (new): 40 back-to-back presses per dialog. Negative control on `main`: intro focus starts on body and walks into the covered panels; book setup isn't a dialog at all.

## 2026-10-13 — #9 whole-app UI review and polish pass (`issue-9-ui-review`)

- Two reports, no app code changes: `todos/2026-10-13-emil-ui-review.md` (verdict **Blocked**: 2 Blocking, 14 Should fix, 11 Nits) and `todos/2026-10-13-emil-ui-polish.md` (verdict **Approve with changes**: 5 Should fix, 8 Nits). Evidence screenshots are in `todos/2026-10-13-ui-shots/`.
- **Blocking:** (1) most inspector controls and every book-overview page button have no accessible name; (2) the canvas context menus are mouse-only, not real menus, and *Set as cover* has no other entry point.
- **Method:** code read of every UI file, every screenshot scene, and a Playwright audit of the production build. The audit covered Tab walks per state, inspector ARIA snapshots, context-menu focus, Escape, reduced-motion emulation, hit areas, token contrast, and a frame-by-frame reload capture (an empty project flashes for ~100ms on every reload).
- Excluded as already decided: #25, #40, #30, #14, user-directed menus and stagger, Paper-referenced field styling, and the intro-modality question open on #46. The maintainer triages findings into issues.

## 2026-10-13 — #58 remove the dead Share button (`issue-58-remove-share`)

- The top nav's Share button had no handler (review finding S5). Removed until sharing exists; Export is the only top-right action. The now-unused `ArrowSquareOutIcon` and `Button` imports and the wrapper `div` went with it.
- Nothing else named the button: no verifier, screenshot scene or CLAUDE.md text. The build brief's original "Share + Export" description in `docs/plans/` is left as history.
- `npm run verify:top-nav` (new): the banner holds exactly one button, named "Export".

## 2026-10-13 — #54 book overview on white paper (`issue-54-book-overview-paper`)

- Fixes S6 from `todos/2026-10-13-emil-ui-review.md`. Book view page previews are `bg-white` (were `bg-card`, zinc-900), and text takes `element.color ?? DEFAULT_TEXT_COLOR`, as the canvas and `render-frame.ts` do. Both changes ship together: the color alone on a dark card would hide default ink. An image slot whose thumbnail hasn't loaded is `bg-zinc-100` (was `bg-muted`, dark) so it still reads as a placeholder on paper.
- Unchanged: bleed/margin overlays, selected outline, ring, page labels.
- `npm run verify:book-overview` (new): picks `#c2410c` for a caption, opens the Book view, checks the preview's computed background is `rgb(255, 255, 255)` and the caption's computed color is `rgb(194, 65, 12)`. Negative control on `main`: both fail (dark background, near-white text). New screenshot scene `book-overview`; the existing `book` scene ends on the canvas.
- Seen, not fixed: captions in the previews render at a 5px floor (`pointSize * 0.4`, not scaled to the preview width), so they are barely legible at review size.

## 2026-10-13 — #57 book setup dialog (`issue-57-book-setup`)

- Finding S12 from `todos/2026-10-13-emil-ui-review.md`. Copy now reads "Page count can change later; page size is set for this book." — the old "You can change this later" promised something the app can't do (both inspector states show page size read-only).
- *Custom* gained `aria-pressed`; one `FIELD_CLASS` (the page-count field's Paper FL-0 style, plus `aria-invalid:border-destructive`) now styles the custom width, custom height and page-count inputs, focus ring included; both validation messages are wired to their inputs with `aria-invalid` + `aria-describedby` (`useId`).
- **No-jump:** the card is anchored from the top (`top-[max(1.5rem,calc(50%-12rem))]`) instead of vertically centred, so the custom row and the error lines only ever grow it downward. 12rem ≈ half the preset-state card, so in that state it still sits where centring put it. Reserving the custom row's height instead would leave an empty band under the presets for every book that uses a preset — which is most of them.
- `npm run verify:book-setup` (new, `scripts/verify/book-setup.mjs`) passes 23/23: copy, `aria-pressed`, identical computed field style and focus ring on all three inputs after Tab, `aria-invalid`/`aria-describedby` pointing at the visible message, and 0px top-edge movement on Custom on/off and on an error appearing (while the card itself grows 36px, so the check isn't vacuous). On `main` it fails 15 of those.
- New screenshot scene `book-setup` (Custom chosen, width 0 → error). `npm run verify` and every other verifier pass.

## 2026-10-13 — #55 canvas selection color and screen-sized chrome (`issue-55-canvas-chrome`)

- **S7:** one selection color, `#4176f6` — `--sidebar-primary`'s hue at oklch lightness 0.6 (the token itself is 2.6:1 on the pasteboard). It measures 4.34:1 on the `--canvas` pasteboard and 4.08:1 on a white page. Frames, images, text (incl. `editingBorderColor`), shift-click groups, the marquee and the frame-drag insertion indicator all use it, borders 2 screen px (`borderScaleFactor`). The indicator stroke is now `strokeUniform`. Print guides keep red bleed / sky-blue margin; the cover badge moved off the margin blue to `--primary`'s zinc; the frame stroke is zinc-400 instead of slate.
- **S8:** the add-page buttons (28px) and cover badge (22px glyph) are sized in screen pixels. Each carries a scene anchor plus a screen-pixel offset, and a `before:render` handler rescales them by 1/zoom, so every pan/zoom path is covered. The badge now sits above the bleed line, not on it.
- `npm run verify:canvas-chrome` (new, test-hooks build): at 10/50/100% the button measures 26×26px of solid fill and the badge 16×19px; selection-outline contrast is computed from drawn pixels; hover and click on the button still work at 10%.

## 2026-10-13 — #50 name every inspector control (`issue-50-a11y-names`)

- **Section headings label their controls.** `Section` gives its `<h2>` an id and provides it through `section-label.ts`. The Text, Type, Size, Font, Fit and Width controls and the Color trigger read it via `aria-labelledby`. The Color trigger is named "Color #18181b" (heading plus its own value). Position labels itself from its own visible "Position".
- **`NumberField`:** the hover steppers and the unit are `aria-hidden`. They were being read into every wrapping label ("Top Increase Decrease"). The input's own arrow keys still step it.
- **Selected state is exposed:**
  - the active image preset is `aria-pressed`;
  - page rows are named "Page N", described by their margins, and `aria-current` when selected;
  - book-overview previews are named "Page N" and `aria-current` when selected;
  - the zoom readout is "Zoom N%, reset to 100%".
- `npm run verify:a11y-names` (new) passes. Negative control on main's app code fails: the readout is named "9%", and the rows can't be found as "Page 3". The three color-picker verifiers now find the trigger as `Color #…`.

## 2026-10-13 — wave 1 of Phase 2 merged (manager)

- PRs #61 (#58), #62 (#54), #63 (#57), #64 (#55), #65 (#50) merged in that order, each after merging `main` into its branch. Append conflicts in `package.json`, `CLAUDE.md` and `PROGRESS.md` kept both sides; `screenshot.mjs` kept both new scenes.
- Combined, two verifiers broke on #65's renames: `book-overview.mjs` looked for the Color trigger as `#…` and `canvas-chrome.mjs` for the zoom readout as `N%`. Both now use the new names ("Color #…", "Zoom N%…"), committed on #65.
- On the combined tree (identical to `main` after the merges): `npm run verify` passes; all 17 verifiers, including e2e 3/3, pass; all 13 screenshot scenes render.

## 2026-10-13 — #56 four small fixes (`issue-56-small-fixes`)

- **S9:** toasts moved to the top-right, 8px under the top nav (`top-14`), clear of the zoom controls and canvas toolbars. The shadcn stack math is mirrored: `top-0`/`origin-top`, peek and expanded offsets grow downward, enter/exit at `translateY(-150%)` with a fade (150% of a toast's height doesn't clear the screen from up there), `swipeDirection={["up", "right"]}`.
- **S10:** Escape on the intro overlay dismisses it, like its X. Handled on the overlay's keydown, so Escape in the (still live) top nav is left alone.
- **S11:** the empty project's "Add pages to get started." is muted, not destructive; an unstitchable count is still red.
- **S13:** Cmd/Ctrl+Enter in the feedback textarea submits (respects `canSubmit`). The Submit button shows `⌘ ↵`/`Ctrl ↵` in a `<kbd>`; "Sending…" shares a grid cell with the idle label, so the button no longer changes width while sending.
- `npm run verify:small-fixes` (new) passes; on main's app code it fails 8 checks across all four fixes.

## 2026-10-13 — #52 honour reduced motion, drop the inspector's 150ms delay, no transition-all (`issue-52-motion`)

- **S2:** one unlayered `@media (prefers-reduced-motion: reduce)` rule in `globals.css` resets tw-animate's `--tw-enter-*`/`--tw-exit-*` scale, translate, rotate and blur variables to identity, so every popup (Export dialog and backdrop, Color picker, Feedback, Select, Tooltip, DropdownMenu) keeps its opacity fade and loses its zoom/slide. The shell grid is `motion-reduce:transition-none`. Fabric frame snaps go through `snapFrameTo`, which reads `matchMedia` at tween time and sets the end position in one render under reduced motion.
- **S3:** `InspectorPanel` renders the new variant in the same commit; the `phase`/`displayed` state and its 150ms `setTimeout` are gone. A wrapper keyed by variant replays `.inspector-fade-in` (150ms, opacity only, none under reduced motion), and the first render doesn't fade.
- **S4:** Button transitions `color, background-color, border-color, box-shadow, opacity, translate` (`translate`, not `transform`: Tailwind v4's `translate-y-px` press nudge writes the `translate` property). Badge transitions its colors and shadow. No `transition-all` left anywhere in `apps/web/components`.
- `npm run verify:motion` (new, test-hooks build) passes 22/22. It slows Chrome's animation clock to 2%, seeks each running animation to its start and compares the target's geometry with its end, so it judges what is drawn, not class names; the normal-motion half checks the same popups *do* move, so the reduced half can't pass vacuously. On `main` it fails 12.

## 2026-10-13 — #53 one focus ring app-wide (`issue-53-focus-ring`)

- Finding S1 from `todos/2026-10-13-emil-ui-review.md`. Focus is now one treatment: a 2px solid `--focus-ring` outline, 2px outside the control. `--focus-ring` is new (zinc-400, `oklch(0.705 0.015 286.067)`). `--ring` keeps its job for *selection* (chosen preset/format borders, `data-popup-open:border-ring`, the selected Book preview).
- Measured WCAG ratios, recorded in `globals.css`: 5.66:1 on `--background`, 6.74:1 on `--card`/`--popover`, 4.83:1 on `--muted`, 4.20–6.01:1 on `bg-input/30`. The old ring (`--ring`/50) was 1.75:1. On white it would be 2.63:1. The offset keeps it off the paper: Book previews get it on `--background`, outside the page.
- Shared utilities in `globals.css`: `focus-ring` (control), `focus-ring-within` (`:has(:focus-visible)`, for NumberField, channel fields and export cards), and `focus-ring-inset` (only the scroll viewport, which its panel clips). The base layer drops `outline-ring/50` and gives every element the ring's color, width and offset up front, so focus only flips `outline-style`. Nothing falls back to Chrome's `outline: auto` any more, and no `transition-*` animates the ring in. Every `focus-visible:ring-3 ring-ring/50`/`border-ring` string is replaced. The bare buttons get `focus-ring`: page rows, presets/Custom, previews, context-menu items. Destructive buttons no longer swap in a red ring.
- Book preview selection moved from `outline-2 outline-ring` to `ring-2 ring-ring` (box-shadow on the paper's edge), so a focused selected page shows both.
- `npm run verify:focus-ring` (new) keyboard-focuses 11 controls across nav, panels, inspector, popover, both dialogs and the Book view. It checks for one identical ring and ≥ 3:1 against the real surface under each. On main: 14 failures (4 distinct ring styles, 1.65–1.87:1). `color-picker-focus.mjs` and `book-setup.mjs` now accept an outline as the ring. New screenshot scene `focus-ring`.

## 2026-10-13 — #51 Set as cover from the sidebar, by keyboard (`issue-51-cover-toggle`)

- **Cover checkbox** in the page inspector's Layout section, under Position. It calls `setFrameCover`, the same action as the right-click menu (which keeps its item). Checking it sets `isCover` and moves the page to the front; unchecking clears the flag and leaves the page where it is. Either way it's one undo step, and undo puts the page back at its old index. A native `<input type="checkbox">`, because the canvas's window-level Space handler (hold to pan) skips inputs but swallows Space on buttons.
- **Add page** button in the nothing-selected Book settings: `addFrame(pageSize)`, the empty-canvas menu's "Add new page".
- Every other context-menu action already had a non-mouse route: image presets → the sidebar's Layout preset buttons; Delete page → Backspace/Delete on a selected page.
- `npm run verify:cover-toggle` (new, test-hooks build) selects page 3, toggles Cover and adds a page using only the keyboard. It checks the stored order, the Position field, the Book list, the canvas badge and Ctrl+Z. It fails on main's app code (no Cover checkbox). `verify:a11y-names` now also expects "Cover" and "Add page".
- Known gaps, not fixed here: Ctrl+Z does nothing while focus is on the checkbox itself (the undo shortcut leaves every `<input>` to the browser). Space can't press any button, app-wide (the pan handler). After a page is selected, the keyboard has no way back to nothing selected.

## 2026-10-13 — wave 2 of Phase 2 merged (manager)

- PRs #74 (#56), #68 (#52), #69 (#53), #67 (#51) merged in that order. `ui/button.tsx`, `ui/badge.tsx`, `ui/toast.tsx` and `feedback-control.tsx` conflicted between the behaviour PRs and #69. Resolution: keep #74's toast position, Cmd+Enter handler and #68's transition lists, with #69's `focus-ring` in place of the old ring classes. #67's Cover checkbox and Add page button were switched to `focus-ring` too; `verify:focus-ring` doesn't cover them.
- `verify:cover-toggle` failed 5 checks on the combined tree. It took its baseline from IndexedDB before the debounced save had stored the new book, so `page3Id` was undefined. It now waits for all 8 pages to be stored (3/3 passes after).
- On the combined tree (identical to `main` after the merges): `npm run verify` passes (118 core / 97 web tests); every verifier passes, including e2e; all screenshot scenes render.
- Filed from the executor's notes on #67: #75 (Space is swallowed on focused buttons by the hold-to-pan handler) and #76 (no keyboard route back to "nothing selected"). #70–#72 (the maintainer's answers) are with the executor.

## 2026-10-13 — #72 add-page buttons sit outside a spread (`issue-72-add-page-spread`)

- **Canvas:** the two "+" buttons go on the outer edges of the selected frame's row: a solo frame's own edges, or a spread's section box for either of its pages. The left one calls `addPairedPage(leftPage, "before")`, the right one `addPairedPage(rightPage, "after")`, so nothing lands in the gutter. New pure helper `addPageAnchors` in `frame-grid.ts` (unit-tested) reuses `layoutRows`. Screen-sized chrome and hover fill unchanged.
- **Sidebar:** a new "Pages" section after Layout (not inside it, so #67's Cover checkbox doesn't collide) with "Add page before" / "Add page after", styled like the image Layout preset buttons. They insert next to the selected page, so they can split a spread on purpose. Both are one undo step through `addPairedPage`.
- `npm run verify:add-page` (new, test-hooks build) passes 19/19 on an 8-page book with a cover. Against main's app code it fails 10 checks (buttons across the spread, wrong insert positions, no sidebar control). `verify:a11y-names` now expects the two new buttons. `verify:canvas-chrome` unchanged: it uses the cover, a solo row.
- After merging wave 2: the new buttons use #53's `focus-ring`; `npm run verify` and all 20 verifiers pass on a test-hooks build. Space on these buttons is still swallowed by hold-to-pan (#75); Enter works.

## 2026-10-13 — #71 Book setup dialog, centre it again (`issue-71-book-setup-centred`)

- Maintainer's call, reversing one part of #57: the book-setup card is vertically centred again (overlay `flex items-center justify-center`, card in normal flow), and the card shifts up by half a row when Custom or an error line grows it. No transition added. Everything else from #57 is unchanged: the copy, `aria-pressed`, `FIELD_CLASS`, `aria-invalid`/`aria-describedby`, and the DOM depth `dialog-focus.mjs` relies on.
- `verify:book-setup` now checks that the card is centred in its overlay (within 1px) with a preset chosen, with Custom chosen, with one and with both error lines showing, and after toggling Custom off and on. It no longer checks that the top edge stays put. Against main's top-anchored card it fails 6 checks (off by -3px with a preset chosen, up to 35px with both errors showing).

## 2026-10-13 — #70 Feedback: drop the Name field, keep Email (`issue-70-feedback-email-only`)

- The feedback popover's only contact field is now **Email (optional)**, same style, same stagger slot. The filed issue is public, so it asks for no more than a reply needs (maintainer's call).
- `composeFeedbackBody` writes only an `Email:` line; `/api/feedback` reads only `contact.email`. A `contact.name` from a tab opened before this change is ignored, not rejected. Unit tests cover that it never reaches the body.
- `npm run verify:feedback` now asserts the popover has no textbox named like "Name" and that an entered email reaches the issue body the stand-in GitHub receives. On main's app code it fails: "no Name field (found 1)".

## 2026-10-14 — #70, #71, #72 merged (manager)

- PRs #80 (#72), #78 (#71), #79 (#70) merged in that order. `feedback-control.tsx` conflicted between #79's email-only field and #74/#69. Resolution: keep #79's single Email field and comments, plus #74's Cmd/Ctrl+Enter paragraph, handler and `<kbd>` hint, and #69's `focus-ring`.
- Settled with the maintainer as-is: page 1 sits solo only when it's marked as the cover, so without a cover pages 1–2 are a normal spread with outer-edge "+" buttons. The Email placeholder carries no "public" note. The maintainer knows the repo, and so its issues, is public.
- On the combined tree (identical to `main` after the merges): `npm run verify` passes (118 core / 100 web tests); every verifier passes, including `add-page` and e2e; all screenshot scenes render.

## 2026-10-14 — #75 Space activates focused buttons; hold-Space pan only from the canvas (`issue-75-space-keys`)

- The hold-Space pan listener in `use-fabric-canvas.ts` now arms only when the keydown's target is `document.body` or inside the canvas container (`spaceCanPan`). Anywhere else Space keeps its native behaviour, so it activates focused buttons and Select triggers again. Before, it cancelled every non-typing Space keydown, which swallowed the keyup activation. The typing-target, editing-text-box and armed-placement guards are unchanged. The Cover checkbox from #67 is unchanged.
- Checked in a real run: after a click on empty canvas, `document.activeElement` is `body`. No Fabric element is focusable, and the hidden textarea exists only while editing and is appended to `body`. So the body rule alone keeps hold-to-pan working after a click; the container check is a backstop.
- The keyup path was fine: it does nothing unless the keydown armed the pan, and it never calls `preventDefault`. No handler in `use-canvas-shortcuts.ts` touches Space or Enter (they handle Ctrl/Cmd zoom, `[`/`]`, Ctrl/Cmd+arrows, `T`, Ctrl/Cmd+C/V/Z/Y and Backspace/Delete). `onCanvasKey`'s Enter only acts with focus on body or the canvas.
- New `npm run verify:space-keys`: Tab plus Space on Export, the Book/Canvas tabs, a Book row, "Add page after", the Position Select and the Cover checkbox; then a Space+drag pan from a page after a click on empty canvas. Against main it fails 3 checks: Export, "Add page after" and the Position Select. The tabs, the Book row and the checkbox already passed there, because base-ui tabs act on keydown, the Book tab unmounts the canvas, and a checkbox is an `<input>`.

## 2026-10-14 — #76 Escape steps the selection back out to Book settings (`issue-76-escape-selection`)

- **Escape steps out one level:** a text box being edited leaves editing first (Fabric, unchanged); a selected text or image element goes to its page; a page goes to nothing, which is Book settings. New `useEscapeSelection` + pure `escapeStep` in `use-canvas-shortcuts.ts` (unit-tested). Each step goes through Fabric the way the matching click does (`selectFrameOnCanvas` sets the frame as the active object, `clearCanvasSelection` discards it), so store, add-page buttons, sidebar and Book-view `aria-current` follow the existing `notifyFrameSelection` / `selection:cleared` paths. A page selected from the Book view (no Fabric active object) clears through the same `onSelectFrame(null)` handler.
- **Escape belongs to whatever has it first:** the step-out skips an Escape that is `defaultPrevented`, from a typing target, while editing text, with `T` armed, or while any `dialog`/`alertdialog`/`listbox`/`menu` without `data-closed` is in the DOM (Base UI keeps a closed Select's listbox mounted). Base UI popups already `stopPropagation` at the document. The canvas context menus now take their Escape in the window capture phase and `preventDefault` it. This also fixes a bug on main: with a selection, Escape left an open context menu stuck, because the deselect re-render swapped its listener out mid-dispatch. Disarming `T` now `preventDefault`s too.
- The old "Escape deselects only when focus is on the canvas or body" rule is gone for Escape (Enter keeps it), so Escape also works with focus on a sidebar control that isn't a text field.
- `npm run verify:escape-selection` (new, test-hooks build) passes 34/34: image and text step-out, Color popover, Font listbox, page context menu, Export dialog, armed `T`. Against main's app code it fails 10 checks before timing out on the stuck context menu. `verify:text-selection` now expects a second Escape to select the box's page and a third to deselect. No other verifier relied on Escape deselecting.
- Not covered: Escape in the Book panel view (the canvas is unmounted there, so it does nothing yet).

## 2026-10-14 — #75, #76 merged (manager)

- PRs #82 (#75) and #83 (#76) merged in that order. They edit different functions in `use-fabric-canvas.ts`; only append lines conflicted.
- On the combined tree (identical to `main` after the merges): `npm run verify` passes (118 core / 104 web tests); all 21 verifiers pass, including the new `space-keys` and `escape-selection`, plus e2e; all screenshot scenes render.
- The maintainer answered yes to both follow-ups: Figma-style Space pan when a control holds focus from a mouse click (#85), and Escape in the Book view (#86).

## 2026-10-14 — #85 Space pans when a mouse-clicked control holds focus (`issue-85-space-mouse-focus`)

- Hold-Space pan now also arms when focus is on a control that took it from a mouse click (no `:focus-visible`), Figma-style. A control reached by keyboard still gets Space's native activation (#75). Typing targets, an editing text box, an armed `T`, and any open dialog/popover/listbox/menu (`hasOpenPopup`, now exported from `use-canvas-shortcuts.ts`) still keep Space. The Book view has no canvas, so nothing changed there.
- Chromium makes a focused element match `:focus-visible` on any keydown, before listeners run, so `:focus-visible` is read at `focusin` (and on canvas mount for whatever already has focus) rather than on the Space keydown.
- On a mouse-focused control the Space keydown is cancelled and stopped in the window capture phase (before React/Base UI see it), and the control is blurred, so the keyup that would click a native button or checkbox lands on the page, and Chromium's keydown focus ring never appears. Focus ends where a canvas click leaves it.
- Native checkboxes and radios count as controls for this rule only (`isToggleInput` beside `spaceCanPan`); `isTypingTarget` and its other call sites are unchanged.
- `npm run verify:space-keys` extended: a mouse click, then a Space press, and a fresh click, then Space+drag, on "Add page after", Export, the Canvas tab (Book would unmount the canvas) and Cover: pans, doesn't activate, no ring. Clicked text fields (inspector Text, feedback) still type a space. Against main's app code it fails 11 checks.

## 2026-10-14 — #86 Escape steps the selection out in the Book view too (`issue-86-escape-book-view`)

- `useEscapeSelection` now takes the two step targets (`stepToFrame`, `stepToNothing`). The canvas-only guards (`isTextEditing`, `isTextToolArmed`, `hasCanvasSelection`) are optional and default to false. `LightTable` passes its Fabric paths. `BookOverview` passes the store's `selectFrame` / `clearSelection` (the store-only path, since no canvas is mounted). `escapeStep` stays the one rule. `CanvasRegion` renders either `LightTable` or `BookOverview`, never both, so only one listener is ever registered. The `defaultPrevented`, typing-target and `hasOpenPopup` guards are the same code.
- The selection survives switching to the Book tab (the store keeps it, and unmounting the canvas doesn't clear it), so an image or text box selected on the canvas stays selected there. A text box's Color popover opens from the inspector in the Book view, and Escape closes only the popover.
- `npm run verify:escape-selection` adds cases 8–10 for the Book view. 8: page 3's row, Escape gives Book settings with no `aria-current` anywhere. 9: an image (`]`) then the Book tab; Escape selects its page (row and preview both current), Escape again gives Book settings. 10: the text box then the Book tab with Color open; Escape closes only the popover, Escape again selects its page. All checks pass. Against main's app code it fails 6 checks in cases 8–10.
- Case 3 (Color popover on the canvas) flaked once in a full verifier run under load: the popover's close animation outlasted the 200ms wait. Cases 3 and 10 now wait up to 2s for the popover to hide before calling it stuck open.

## 2026-10-14 — #59 Polish: stable widths, tabular numbers, hit areas, no faux italic, no reload flash (`issue-59-polish`)

- **P1:** Export → "Exporting…" uses the feedback Submit's shared grid cell (#56), so the button holds the busy label's width (106px idle and busy; was 61 → 106). The empty state's "Import photos" reserves an invisible "Importing 888 of 888…" in the same cell, so it is the same width idle and through every tick. The hidden busy cell holds a same-size blank in place of the spinner at rest, so no infinite spin runs off-screen (it broke `verify:motion`'s `finish()`). That is a wider button at rest (156px, was 106). An import of 1,000+ photos would still grow the button once when it starts. Feedback left as is.
- **P2:** `tabular-nums` on the zoom readout, export and import progress text, `NumberField` inputs, the colour channel fields, and the inspector's `Row` values and saddle-stitch line.
- **P3:** the NumberField chevrons stay 10px. Each one's pseudo-element target is 24×24, reaching 11px above or below the field. Targets are live only while that field is hovered, so two fields' targets are never live at once. The Position X/Y/W/H stack got 12px between fields (was 8) so a hovered field's targets stop short of the next field. Margins already had 20px. Info button 20 → 28, rename 20 → 36 tall (truncation moved to an inner span so `overflow: hidden` doesn't clip the target), dismiss buttons 24 → 32. Both canvas toolbars now use `icon-sm` (28px), with the pills' padding cut to `p-0.5` so they stay 34px tall.
- **P4:** `font-synthesis: none` on body; the intro's name is `not-italic font-medium text-foreground`. Audit: no other `italic`, `font-bold` or `font-semibold` in the app. Lora and Geist load as variable fonts, so `font-medium` (500) is real. Fabric text sets no weight or style.
- **P5:** the store already had `hydrated`, set in both branches of `hydrate()`. Until it's set, the shell renders no intro (`useIntroductionShowing`), canvas empty state or toolbars, panel contents, book name, or Book overview. The top nav, tabs and zoom cluster stay.
- New `npm run verify:polish`: PASS 40/40. Against main's app code it fails 23 checks, including 4 of 61 frames showing the intro and the empty canvas on reload, and focus landing on "Get started".

## 2026-10-14 — #85, #86, #59 merged; Phase 2 complete (manager)

- PRs #89 (#85), #88 (#86) and #90 (#59) merged in that order. In `canvas-region.tsx`, #88's Book-view `useEscapeSelection` and #90's `hydrated` gate were both kept; the hook runs before the `!hydrated` early return.
- On the combined tree (identical to `main` after the merges): `npm run verify` passes (118 core / 104 web tests); all 22 verifiers pass, plus e2e; all screenshot scenes render.
- Every Phase 2 item is ticked. Keyboard work is paused at the maintainer's request (see PLAN backlog). The one open product question is the Import button's resting width (PLAN backlog). The executor is idle.
