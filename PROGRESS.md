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

## 2026-10-13 — #6 feedback submissions land as GitHub issues (`issue-6-feedback-issues`)

- **Reproduced on `main`:** with no token the route returns 500 "Feedback isn't configured on the server yet."; with a token GitHub rejects it returns 502. Either way the toast showed the same generic "Something went wrong on our end", because the client discarded the route's message. Without the deployed server's logs, there's no telling which of the two the live site hits. The new `[feedback]` log line will say.
- **Route:** missing or blank token → 503. GitHub 401/403/404/410 → a "setup problem on our side" message, with a log line naming the exact fix. A 403 or 429 with an exhausted rate limit → 503 "try again in a few minutes". 422 and network errors get their own messages. `GITHUB_API_URL` (server-only, default api.github.com) exists only so the verifier can stand in for GitHub.
- **Client:** the toast shows the route's message, or "Couldn't reach Loupe's server" when the browser can't reach it. The draft is kept on every failure. The popover fields now have accessible names.
- **Screenshot attachment:** removed deliberately before this PR (doc comment in `feedback-control.tsx`). The body is `{feedback, contact}`, which matches the route, so there's no body-size concern.
- **Verification:** 15 route tests. `npm run verify:feedback` (new) drives the real control and route against a local stand-in GitHub, 11/11 pass. Screenshot scene `feedback-error` added.
- **Not verified:** a real submission. No `GITHUB_FEEDBACK_TOKEN` exists in cloud sessions. The maintainer does the steps in README "Feedback setup" and confirms one issue lands.
