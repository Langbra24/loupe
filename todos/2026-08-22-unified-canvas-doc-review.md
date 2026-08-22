# Unified Canvas — doc review findings

Reviewed: 2026-08-22. Document: `docs/plans/2026-08-22-001-feat-unified-canvas-plan.md`. Seven-persona `ce-doc-review` pass (coherence, feasibility, product-lens, design-lens, security-lens, scope-guardian, adversarial), Sonnet 5, cross-model pass skipped (no attested different-family CLI available).

## Applied to the plan this round

- R10 reworded to stop contradicting R14 (empty-selection book settings).
- R26 added — page-size change preserves normalized content position; aspect-mismatched photographs re-fit rather than distort; page-count reduction never silently drops a page holding content.
- R27 added — drag-reorder shows the landing position, including before-first and after-last.
- R28 added — canvas actions are undoable (reorder, move between frames, create/delete, text edit).
- R29 added — changing selection commits an in-progress edit rather than discarding it.
- R16 amended — `T` is inert while a text box has editing focus (was going to fire on every typed "t").
- R30 added — every drag-reachable canvas action is also keyboard-reachable.
- R31 added — selection outlines, frame edges, and the drag indicator stay visible against black + dot grid.
- R32 added — the introduction is reachable again from a persistent bottom-left control, next to feedback.
- The "introduction lives in the empty canvas" Key Decision corrected — no longer claims permanent disappearance.
- AE5 extended to cover placed content surviving a page-size change; AE7–AE9 added for the T-key guard, edit-commit-on-reselect, and intro re-access.

## Not applied — carried here for later triage

These were raised at anchor 75–100 (verified, will be hit in practice) but are either premise-level judgment calls or touch scope/architecture beyond a plan edit. Ordered by severity.

**Proposed fixes (concrete fix exists, needs a decision):**

1. **P1 — Feedback URL has no encoding or length rule.** `&`, `#`, newlines corrupt the query string; long feedback truncates or fails to open silently, with no backend to retry. *(feasibility, security-lens)*
2. **P1 — R13 presupposes the per-page/book-level print-property split that Outstanding Questions leaves open.** R13 is unimplementable until that split is resolved. *(coherence, scope-guardian)*
3. **P1 — Nothing bounds the feedback issue body to the user's own text.** A future "helpful" addition of filenames/project data would publish it to a public repo permanently. *(security-lens)*
4. **P1 — Migration has no non-destructive requirement.** No account, no backup, no export yet — a partial migration could silently destroy someone's only copy. *(security-lens)*
5. **P2 — "Position is order, without inference" contradicts its own mechanism.** Snap-to-flow is spatial inference constrained to discrete slots, not the absence of inference — worth fixing before this sentence becomes the new CLAUDE.md geometry rule. *(adversarial)*
6. **P2 — F3 has the bookmaker "press T" as immediate creation** while Outstanding Questions still lists that mechanism as undecided. *(coherence)*

**Decisions (judgment calls, no single correct fix):**

7. **P1 — The one-canvas fix may relocate, not resolve, the two-representations problem.** The pasteboard still holds unordered photographs. Narrowed to one screen, not removed. *(adversarial)*
8. **P1 — Dropping competing sequences cuts the only field-observed need in the project's history** (the brief's photobook-workshop observation), justified by one sentence, on a restructure that itself rests on zero observed usage. *(product-lens, adversarial)*
9. **P1 — The brief's engine-simplicity payoff (only Design renders live) is deleted with no replacement rule.** Every frame plus pasteboard now renders and hit-tests continuously. *(product-lens, adversarial)*
10. **P1 — No rule for the pasteboard–frame boundary** — a photo dropped on a frame edge or the seam between two frames. This is the exact interaction the two-object-class design depends on. *(adversarial)*
11. **P1 — No success signal for the one-canvas bet.** All 32 requirements can ship correctly with no way to tell whether it actually fixed the problem. *(product-lens)*
12. **P1 — 25+ requirements, no phasing, no minimum-viable subset.** All-or-nothing rewrite, no user-visible value until everything is simultaneously correct. *(scope-guardian)*
13. **P1 — The CLAUDE.md / build-brief rewrite is scoped in with no bound on which sections change or how completeness is checked.** *(scope-guardian)*

**FYI (verified but advisory):**

- "Open blockers: None" sits oddly next to the admittedly-unspecified migration path. *(scope-guardian)*
- R23–R25 (feedback loop) have no dependency on R1–R22 and could ship as an earlier, separate increment. *(scope-guardian)*
- The intro frames Loupe as an open community experiment; the $5/$15 paywall it never mentions arrives minutes later. *(product-lens)*
- The intro doesn't state that photos never leave the browser — the one moment the app has the user's attention to say so. *(security-lens)*
- The Figma-shaped interaction model is unweighed against the brief's secondary DIY-scrapbook audience. *(product-lens)*
- Which substrate hosts the unified canvas (extend Fabric.js, or a new DOM drag system) is still open — the largest technical unknown for planning.
- Whether R20's Canvas/Book left-panel toggle quietly reintroduces the mode-like navigation that R19 deletes.

## Why these weren't applied now

Item 6–13 stake out product and architecture positions (what Loupe's engine simplicity means now, whether losing competing sequences is acceptable, how big a bite this rewrite should be) that are the user's call, not a doc-review autofix. Items 1–5 are the closest to mechanical but each still commits to a specific behavior (a truncation UX, a print-property allocation, a migration failure mode) worth a deliberate decision rather than a silent edit. Surfacing them here keeps them from being lost without forcing a decision mid-review.
