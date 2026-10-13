# Plan

The phase checklist for the MVP. Each item links to its GitHub issue, and each
issue carries a "done when" line that is a checkable condition. Tick an item
only once that condition has been verified — not when the PR opens.

## Phase 1 — fixes and design fidelity

Order matters: #8 and #7 change UI that #9 reviews, so #9 goes last.

- [x] [#5](https://github.com/Langbra24/loupe/issues/5) Verify the book name is editable from the top-left field — PR #11, `npm run verify:rename` 14/14
- [ ] [#6](https://github.com/Langbra24/loupe/issues/6) Feedback control: submissions land as GitHub issues — PR #12 merged, `npm run verify:feedback` 11/11; *final tick when the maintainer's token files one real issue*
- [ ] [#7](https://github.com/Langbra24/loupe/issues/7) Color picker matches Paper frame TF-0 — *blocked on `docs/design/paper/color-picker-TF-0.png`*
- [ ] [#8](https://github.com/Langbra24/loupe/issues/8) Image-selected sidebar matches Paper frame 1G2-0 — *blocked on `docs/design/paper/image-selected-1G2-0.png`*
- [x] [#14](https://github.com/Langbra24/loupe/issues/14) Text boxes: single click selects, double click edits — PR #16, `npm run verify:text-selection` 15/15
- [x] [#15](https://github.com/Langbra24/loupe/issues/15) Color picker: every focusable part shows a focus ring — PR #17, `npm run verify:picker-focus` 12/12
- [ ] [#21](https://github.com/Langbra24/loupe/issues/21) Color picker: arrow keys move the hue slider and saturation/value square
- [ ] [#9](https://github.com/Langbra24/loupe/issues/9) Whole-app UI review with `/emil-ui-review` → findings triaged into new issues

## Backlog (no issue yet)

- Export pads to a multiple of 4 pages (decide: pad with blanks, or warn and block). `npm run e2e` fails on this today.
- Export PDF records the trim size (TrimBox) inside the bleed. `npm run e2e` fails on this today.
