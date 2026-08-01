# lib/repo-history

Read-only analyzer that clones a GitHub repo and produces a structured
"past week" history report. Ported from the PowerShell playbook used during
research. Designed for an upstream agent that needs context about *what
changed recently* on a branch, not a full history dump.

It is intentionally not wired to any UI yet. Two ways to invoke:

1. **HTTP route** `POST /api/repo-history`
   ```json
   {
     "repoUrl": "https://github.com/owner/repo",
     "branch": "main",             // optional, defaults to remote HEAD
     "windowDays": 7,              // optional, default 7
     "windowAnchor": "last-commit",// or "now" - what anchors the window
     "outDir": "/custom/path",     // optional, defaults to os.tmpdir()/repo-history/<repo>
     "includeAnalysis": true       // optional, default true - inline the analysis.md
   }
   ```
   Response: `{ meta, artifacts: { metaJson, phase1, phase2, phase3, analysis }, phases, analysis, logCount }`.

2. **In-process** via `generateRepoHistory(input, options)` from `@/lib/repo-history/public`.

## Layout

| File | Role |
| --- | --- |
| `types.ts` | Public types, error class |
| `git.ts` | `spawn` wrapper for `git` with timeout + cwd safety |
| `phase0.ts` | Clone, fetch, branch resolution, window computation, counts |
| `phase1.ts` | Day histogram, contributors, branches, tags, churn, mainline narrative, merge ratio |
| `phase2.ts` | Top-level tree, manifest detection, README excerpt, package.json parsing |
| `phase3.ts` | Per-commit numstat for the window |
| `synthesize.ts` | Deterministic Phase 4 synthesis from collected data (no LLM) |
| `index.ts` | Orchestrator (clone -> fetch -> branch -> window -> counts -> phases -> synthesize) |
| `public.ts` | Barrel export |
| `smoke.ts` | Local smoke test against a real clone |

## Behavior

- `--filter=blob:none` clone into `$TMP/repo-history-clones/<repo>`; idempotent
  across calls so a re-run for the same repo skips the network on the clone step.
- Fetches `--all --tags --prune`, unshallows if needed.
- Window is bounded and computed from the most recent committer date
  (`windowAnchor: "last-commit"`, default) so re-running against the same
  clone returns the same range. Pass `windowAnchor: "now"` for wall-clock
  anchoring.
- Per the playbook's guardrails: never runs `git log -p` or `--stat`,
  excludes `*.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`,
  `bun.lock`, `bun.lockb`, `dist/*`, `build/*`, `vendor/*`, `*.min.*`.
- Sandbox is local isolation, not a security boundary - cloned repos run
  their own `postinstall` scripts on the next `npm install` step. The
  analyzer does not run installs.

## Output

Artifacts written to `outDir` (defaults to `$TMP/repo-history/<repo>`):

- `meta.json` - clone metadata, window, counts
- `phase1-shape.txt` - day histogram, contributors, branches, tags, churn, merge ratio
- `phase2-structure.txt` - tree depth 2, README excerpt, package.json scripts/deps
- `phase3-narrative.txt` - per-commit numstat for every commit in the window
- `analysis.md` - synthesized overview, timeline, ownership, uncertainties

The synthesized `analysis.md` is deterministic text derived from the
collected data; it does not call the LLM. This keeps the analyzer usable
without `OPENAI_KEY` and keeps its output reproducible.

## Operational notes

- Requires `git` on `PATH`. Set `GIT_BIN` to override.
- Long-running: a fresh clone plus per-commit `numstat` for a typical
  single-author repo takes ~10-20 s. Network-heavy repos with multi-GB
  histories scale with clone size even though blobs are filtered.
- No HTTP streaming / SSE. Clients should call the route synchronously and
  read `analysis` from the JSON response, or read the artifact files
  directly from `artifacts.analysis` if `includeAnalysis: false`.
- No persistent state between calls. Each call is a fresh clone (or
  fetch-update of an existing one).

## Smoke test

```
npx tsx ef-hackathon/lib/repo-history/smoke.ts https://github.com/<owner>/<repo>.git
```