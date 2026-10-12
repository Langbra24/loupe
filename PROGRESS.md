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
