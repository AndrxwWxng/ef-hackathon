# lib/repo-shot

Backend module that clones a GitHub repository, boots the project, takes per-route screenshots across viewports, and frames them in a "Screen Studio"-style window. Ported from the sibling `repo-shot` app and adapted to the Next.js/TypeScript stack.

It is intentionally not wired to any route handler, server action, or UI in `app/` yet — calling `generateRepoShots` from a future post pipeline is the only thing needed to turn it on.

## Layout

| File | Role |
| --- | --- |
| `types.ts` | Shared types, viewport presets, themes |
| `detect.ts` | Detect Node / static / Python projects, port + package manager |
| `sandbox.ts` | Repo URL normalization, git clone, dependency install, app boot, readiness probe, static fallback server |
| `capture.ts` | One Chromium process, per-viewport contexts, parallel route capture |
| `frame.ts` | Renders HTML, screenshots `#stage`, runs frames in parallel via shared context |
| `index.ts` | Orchestrator (clone → detect → install → boot → capture → frame) |
| `smoke.ts` | Local static-repo smoke test (uses `skipCloneFrom`) |

## Public API

```ts
import { generateRepoShots, detectProject, THEMES, VIEWPORT_PRESETS } from "@/lib/repo-shot";

const result = await generateRepoShots(
  { repoUrl: "https://github.com/vercel/next.js", routes: ["/"], viewports: ["desktop", "mobile"], theme: "midnight" },
  { outputRoot: "./public/shots", captureConcurrency: 3, frameConcurrency: 3 },
);
```

`result.shots` contains raw (`rawPath`) and framed (`framedPath`) PNGs under `outputRoot/<id>/`. Each call also returns `steps`, `logs`, and `detected`.

`RepoShotOptions` lets you override timeouts, output/work roots, or pass a shared `browser` to amortize Chromium across calls. `skipCloneFrom` skips `git clone` and uses a pre-checked-out directory (used by the smoke test).

## How it's faster than the original

- One Chromium process per call instead of two (capture + frame share the same browser).
- Viewport contexts run in parallel; routes within a viewport share a `Page`.
- Frame render uses `setContent` with a `data:image/png;base64,…` payload — no temporary HTML file on disk.
- Capture uses `domcontentloaded` + a 4 s `networkidle` cap instead of a 30 s `networkidle`-first wait; settle time is configurable.
- Custom static fallback server replaces `express` to keep dependencies at `playwright` only.

## Operational notes

- Requires `git` on `PATH` and `playwright install chromium` (run `npx playwright install chromium` once).
- Sandbox is local isolation, not a security boundary — cloned repos run their own `postinstall` scripts.
- Outputs go to `<repoRoot>/.repo-shot/shots` by default; ignored via `.gitignore`.
- No HTTP API, no SSE, no UI — everything is in-process and async.
