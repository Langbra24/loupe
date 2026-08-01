# Loupe

A browser-based photobook and zine layout tool for photographers and DIY bookmakers — sequence, design, and print-impose a booklet without opening InDesign.

Loupe is narrow and deep rather than InDesign-broad. It wins one job:

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

## Repo layout

| Path | What it is |
|---|---|
| `core/` | `@loupe/core` — data model, sequencing, typography, imposition math. Pure TypeScript, no UI framework. |
| `apps/web/` | The hosted Next.js app. |
| `docs/` | Plans, brainstorms, and accumulated solutions. |

## License

MIT. See [LICENSE](LICENSE).
