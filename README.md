# Sequence

A browser-based photobook and zine layout tool for photographers and DIY bookmakers — sequence, design, and print-impose a booklet without opening InDesign.

Sequence is narrow and deep rather than InDesign-broad. It wins one job:

1. **Sequence** — order the whole book fast, on a filmstrip with no editing chrome in the way.
2. **Design** — compose each spread as the reader actually sees it, as a facing-page pair.
3. **Print** — impose, check folds and bleed, validate page count, export.

Local-first: your project lives in your browser, not on a server. No accounts, no email capture, no cloud sync.

## Status

Early. The current build is the structural app shell — the three-mode frame with placeholder content. The canvas engine, export pipeline, and payment tiers are not built yet. See [`docs/plans/00-initial-build-brief.md`](docs/plans/00-initial-build-brief.md) for the full plan.

## Development

```bash
npm install
npm run dev
```

Then open http://localhost:3000. The app is desktop-only for now.

## Feedback setup

The bottom-left "Provide feedback" control files each submission as an issue on `Langbra24/sequence` through `apps/web/app/api/feedback/route.ts`. Until the token below is set, submitting shows "Feedback isn't set up on this server yet" and nothing is filed.

1. **Create the token.** Go to https://github.com/settings/personal-access-tokens/new and choose **Fine-grained token**.
   - Resource owner: `Langbra24`.
   - Expiration: your choice. When it expires, submissions fail and the server log says the token is invalid or expired.
   - Repository access: **Only select repositories** → `Langbra24/sequence`.
   - Permissions → Repository permissions → **Issues: Read and write**. Nothing else.
   - To get an email for each submission, create the token from a separate bot account that has access to the repo. GitHub doesn't notify you about issues filed with your own token.
2. **Local:** `cp apps/web/.env.example apps/web/.env.local`, paste the token after `GITHUB_FEEDBACK_TOKEN=`, and restart `npm run dev`.
3. **Deployed:** in the Vercel project, open Settings → Environment Variables. Add `GITHUB_FEEDBACK_TOKEN` for Production (and Preview if you want it there), with Sensitive turned on, then redeploy. Env changes only apply to new deployments.
4. **Check it:** submit a note from the app. The issue should appear at https://github.com/Langbra24/sequence/issues. If it doesn't, the server log (`npm run dev` output, or Vercel → Logs) has a `[feedback]` line naming the step to fix.

`npm run verify:feedback` exercises every success and failure path against a local stand-in for GitHub. It never needs the real token.

## Repo layout

| Path | What it is |
|---|---|
| `core/` | `@sequence/core` — data model, sequencing, typography, imposition math. Pure TypeScript, no UI framework. |
| `apps/web/` | The hosted Next.js app. |
| `docs/` | Plans, brainstorms, and accumulated solutions. |

## License

MIT. See [LICENSE](LICENSE).
