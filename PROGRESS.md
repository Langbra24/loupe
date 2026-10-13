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

## 2026-10-13 — #54 book overview on white paper (`issue-54-book-overview-paper`)

- Fixes S6 from `todos/2026-10-13-emil-ui-review.md`. Book view page previews are `bg-white` (were `bg-card`, zinc-900), and text takes `element.color ?? DEFAULT_TEXT_COLOR`, as the canvas and `render-frame.ts` do. Both changes ship together: the color alone on a dark card would hide default ink. An image slot whose thumbnail hasn't loaded is `bg-zinc-100` (was `bg-muted`, dark) so it still reads as a placeholder on paper.
- Unchanged: bleed/margin overlays, selected outline, ring, page labels.
- `npm run verify:book-overview` (new): picks `#c2410c` for a caption, opens the Book view, checks the preview's computed background is `rgb(255, 255, 255)` and the caption's computed color is `rgb(194, 65, 12)`. Negative control on `main`: both fail (dark background, near-white text). New screenshot scene `book-overview`; the existing `book` scene ends on the canvas.
- Seen, not fixed: captions in the previews render at a 5px floor (`pointSize * 0.4`, not scaled to the preview width), so they are barely legible at review size.
