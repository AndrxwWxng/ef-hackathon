import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildMeta,
  cloneRepoForHistory,
  collectCounts,
  computeWindow,
  resolveBranch,
  type CloneResult,
  type Window,
} from "./phase0";
import { collectPhase1, renderPhase1, type Phase1Shape } from "./phase1";
import { collectPhase2, renderPhase2, type Phase2Structure } from "./phase2";
import { collectPhase3, renderPhase3, type Phase3Narrative } from "./phase3";
import { synthesizeAnalysis } from "./synthesize";
import type {
  RepoHistoryArtifacts,
  RepoHistoryInput,
  RepoHistoryMeta,
  RepoHistoryOptions,
  RepoHistoryResult,
} from "./types";
import { RepoHistoryError } from "./types";

const DEFAULT_EXCLUDE = [
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "dist/*",
  "build/*",
  "vendor/*",
  "*.min.*",
];

const MAX_LOGS = 400;

export async function generateRepoHistory(
  input: RepoHistoryInput,
  options: RepoHistoryOptions = {},
): Promise<RepoHistoryResult> {
  const repoUrl = input.repoUrl.trim();
  if (!repoUrl) throw new RepoHistoryError("init", "repoUrl is required", []);

  const exclude = options.exclude ?? DEFAULT_EXCLUDE;
  const windowDays = input.windowDays ?? 7;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new RepoHistoryError("init", "windowDays must be > 0", []);
  }
  const windowAnchor = input.windowAnchor ?? "last-commit";

  const maxLogs = options.maxLogs ?? MAX_LOGS;
  const logs: string[] = [];
  const log = (line: string) => {
    const clean = line.replace(/\r/g, "").trimEnd();
    if (!clean) return;
    logs.push(clean.length > 600 ? `${clean.slice(0, 600)}...` : clean);
    if (logs.length > maxLogs) logs.shift();
    input.onLog?.(clean);
  };

  const outDir = path.resolve(
    input.outDir ?? path.join(os.tmpdir(), "repo-history", repoNameSlug(repoUrl)),
  );
  await fs.mkdir(outDir, { recursive: true });

  const phaseTimers: Record<string, { started: number; ms: number }> = {};
  const recordPhase = (name: keyof RepoHistoryResult["phases"], fn: () => Promise<unknown>) => {
    phaseTimers[name] = { started: Date.now(), ms: 0 };
    return fn().finally(() => {
      phaseTimers[name].ms = Date.now() - phaseTimers[name].started;
    });
  };

  type Counts = Awaited<ReturnType<typeof collectCounts>>;

  let clone: CloneResult;
  let branch: string;
  let window: Window;
  let counts: Counts;
  let phase1: Phase1Shape;
  let phase2: Phase2Structure;
  let phase3: Phase3Narrative;

  try {
    clone = await recordPhase("clone", () =>
      cloneRepoForHistory(repoUrl, {
        cloneRoot: options.cloneRoot,
        fetchTimeoutMs: options.fetchTimeoutMs,
      }).then((result) => {
        log(`cloned to ${result.cloneDir} (shallow=${result.shallow})`);
        return result;
      }),
    );

    branch = await resolveBranch(clone.cloneDir, input.branch);
    log(`branch: ${branch}`);

    window = await computeWindow(clone.cloneDir, windowDays, windowAnchor);
    log(`window: ${window.from} -> ${window.to} (anchor=${windowAnchor})`);

    counts = await collectCounts(clone.cloneDir, window);

    phase1 = await recordPhase("shape", async () => {
      const value = await collectPhase1(clone!.cloneDir, window!, counts, exclude);
      log(`phase1: ${value.dayHistogram.length} day buckets, ${value.contributors.length} contributors, ${value.churn.length} churn rows`);
      return value;
    });

    phase2 = await recordPhase("structure", async () => {
      const value = await collectPhase2(clone!.cloneDir);
      log(`phase2: ${value.treeDepth2.length} top-level entries, ${value.manifestsPresent.length} manifests`);
      return value;
    });

    phase3 = await recordPhase("narrative", async () => {
      const value = await collectPhase3(clone!.cloneDir, window!, exclude);
      log(`phase3: ${value.commits.length} commits captured`);
      return value;
    });
  } catch (error) {
    log(`failed: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof RepoHistoryError) throw error;
    throw new RepoHistoryError("init", error, [...logs]);
  }

  const meta: RepoHistoryMeta = buildMeta({
    repoUrl,
    repoName: clone.repoName,
    branch,
    window,
    counts,
    shallow: clone.shallow,
    cloneDir: clone.cloneDir,
    outDir,
    generatedAt: new Date().toISOString(),
  });

  const metaJsonPath = path.join(outDir, "meta.json");
  const phase1Path = path.join(outDir, "phase1-shape.txt");
  const phase2Path = path.join(outDir, "phase2-structure.txt");
  const phase3Path = path.join(outDir, "phase3-narrative.txt");
  const analysisPath = path.join(outDir, "analysis.md");

  await fs.writeFile(metaJsonPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fs.writeFile(phase1Path, `${renderPhase1(phase1)}\n`, "utf8");
  await fs.writeFile(phase2Path, `${renderPhase2(phase2)}\n`, "utf8");
  await fs.writeFile(phase3Path, `${renderPhase3(phase3)}\n`, "utf8");

  let analysisBody = "";
  await recordPhase("synthesize", async () => {
    analysisBody = synthesizeAnalysis({ meta, shape: phase1, structure: phase2, narrative: phase3 });
  });
  await fs.writeFile(analysisPath, `${analysisBody}\n`, "utf8");
  log(`analysis written to ${analysisPath}`);

  const artifacts: RepoHistoryArtifacts = {
    metaJson: metaJsonPath,
    phase1: phase1Path,
    phase2: phase2Path,
    phase3: phase3Path,
    analysis: analysisPath,
  };

  return {
    meta,
    artifacts,
    phases: {
      clone: { ms: phaseTimers.clone.ms, detail: clone.cloneDir },
      shape: { ms: phaseTimers.shape.ms, detail: `${phase1.dayHistogram.length} day buckets` },
      structure: { ms: phaseTimers.structure.ms, detail: `${phase2.treeDepth2.length} entries` },
      narrative: { ms: phaseTimers.narrative?.ms ?? 0, detail: `${phase3.commits.length} commits` },
      synthesize: { ms: phaseTimers.synthesize.ms, detail: analysisPath },
    },
    logs: [...logs],
  };
}

function repoNameSlug(repoUrl: string): string {
  const tail = repoUrl
    .replace(/\.git$/i, "")
    .split("/")
    .pop() ?? "repo";
  return tail.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80) || "repo";
}