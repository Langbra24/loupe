# Plan

The phase checklist for the MVP. Each item links to its GitHub issue, and each
issue carries a "done when" line that is a checkable condition. Tick an item
only once that condition has been verified — not when the PR opens.

## Phase 1 — fixes and design fidelity

#9 goes last: it reviews the whole app once the feedback token (#6) works.

- [x] [#5](https://github.com/Langbra24/loupe/issues/5) Verify the book name is editable from the top-left field — PR #11, `npm run verify:rename` 14/14
- [ ] [#6](https://github.com/Langbra24/loupe/issues/6) Feedback control: submissions land as GitHub issues — PR #12 merged, `npm run verify:feedback` 11/11; *final tick when the maintainer's token files one real issue*
- [x] [#7](https://github.com/Langbra24/loupe/issues/7) Color picker matches Paper frame TF-0 — PR #41, matched against `docs/design/paper/colorpicker.png`
- ~~[#8](https://github.com/Langbra24/loupe/issues/8) Image-selected sidebar matches Paper frame 1G2-0~~ — closed, not planned (no reference; maintainer's call)
- [x] [#14](https://github.com/Langbra24/loupe/issues/14) Text boxes: single click selects, double click edits — PR #16, `npm run verify:text-selection` 15/15
- [x] [#15](https://github.com/Langbra24/loupe/issues/15) Color picker: every focusable part shows a focus ring — PR #17, `npm run verify:picker-focus` 12/12
- [x] [#19](https://github.com/Langbra24/loupe/issues/19) `[` / `]` step through the images in pages; Tab reaches the UI — PR #22, `npm run verify:image-cycling` 11/11
- [x] [#20](https://github.com/Langbra24/loupe/issues/20) Text boxes: Enter on a selected box starts editing, caret at the end — PR #23, `npm run verify:text-selection` 20/20
- [x] [#21](https://github.com/Langbra24/loupe/issues/21) Color picker: arrow keys move the hue slider and saturation/value square — PR #24, `npm run verify:picker-keys` 13/13
- [x] [#25](https://github.com/Langbra24/loupe/issues/25) Right sidebar: separators run the full width of the panel — PR #26, `npm run verify:separators` 4/4 states
- [x] [#27](https://github.com/Langbra24/loupe/issues/27) Color changes are undoable (one step per drag or edit) — PR #37, `npm run verify:color-undo` 9/9
- [x] [#30](https://github.com/Langbra24/loupe/issues/30) Export: record trim and bleed boxes in the PDF — PR #33, `npm run e2e` box checks
- [x] [#31](https://github.com/Langbra24/loupe/issues/31) Export pads saddle-stitch books to a multiple of 4, explained in the dialog — PR #35, `npm run e2e` PASS (first full pass)
- [x] [#34](https://github.com/Langbra24/loupe/issues/34) Feedback popup asks for more context instead of mentioning GitHub — PR #39
- [x] [#40](https://github.com/Langbra24/loupe/issues/40) Page-selected sidebar: left-align the field text — PR #42
- [x] [#45](https://github.com/Langbra24/loupe/issues/45) Dialog focus: Tab never escapes the Export dialog or reaches what an overlay covers — PR #46, `npm run verify:dialog-focus`
- [ ] [#9](https://github.com/Langbra24/loupe/issues/9) Whole-app `/emil-ui-review` + `/emil-ui-polish` → findings triaged into new issues — *after #6's token works*

## Backlog (no issue yet)

- Nothing queued. Export padding and trim/bleed boxes moved to #31 and #30.
