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
import {
  comprehendRepo,
  comprehensionAvailable,
  renderDigestMarkdown,
  type ComprehensionResult,
} from "./comprehend";
import { collectGitHubContext, renderGitHubContext, type GitHubContext } from "./github";
import { collectPhase1, renderPhase1, type Phase1Shape } from "./phase1";
import { collectPhase2, renderPhase2, type Phase2Structure } from "./phase2";
import { collectPhase3, renderPhase3, type Phase3Narrative } from "./phase3";
import { collectPhase4, renderPhase4, type Phase4Deep } from "./phase4";
import { synthesizeAnalysis } from "./synthesize";
import type {
  RepoHistoryArtifacts,
  RepoHistoryInput,
  RepoHistoryMeta,
  RepoHistoryOptions,
  RepoHistoryResult,
} from "./types";
import { RepoHistoryError } from "./types";

/**
 * Paths that are committed but not authored. Repos that vendor `node_modules`
 * or check in build output will otherwise spend the entire read budget on code
 * nobody wrote, which is what happened before these entries existed.
 *
 * Git pathspecs match with wildmatch by default, so a leading `*` is what makes
 * a pattern reach nested directories.
 */
const DEFAULT_EXCLUDE = [
  "*.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "bun.lock",
  "Cargo.lock",
  "poetry.lock",
  "Gemfile.lock",
  "composer.lock",
  "go.sum",
  "*node_modules/*",
  "*.next/*",
  "*dist/*",
  "*build/*",
  "*vendor/*",
  "*target/*",
  "*coverage/*",
  "*__pycache__/*",
  "*.venv/*",
  "*Pods/*",
  "*__snapshots__/*",
  "*.min.*",
  "*.map",
  "*.snap",
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

  const deepRead = input.deepRead !== false;
  const useGitHub = input.useGitHub !== false;
  const wantComprehension = input.comprehend !== false;

  const maxLogs = options.maxLogs ?? MAX_LOGS;
  const warnings: string[] = [];
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
  const recordPhase = <T,>(name: keyof RepoHistoryResult["phases"], fn: () => Promise<T>): Promise<T> => {
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
  let phase4: Phase4Deep | null = null;
  let github: GitHubContext | null = null;
  let comprehension: ComprehensionResult | null = null;

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

    if (deepRead) {
      phase4 = await recordPhase("deep", async () => {
        const value = await collectPhase4(clone!.cloneDir, window!, exclude, options.deepLimits);
        log(
          `phase4: read ${value.budget.commitsRead} patches (${value.budget.patchBytes.toLocaleString()} bytes${value.budget.patchTruncated ? ", truncated" : ""}), ` +
            `${value.keyFiles.length} key files, ${value.docs.length} docs, ${value.routes.length} routes`,
        );
        if (value.budget.patchTruncated) {
          warnings.push(
            "Patch output hit the read budget; the oldest commits in the window were not fully read.",
          );
        }
        return value;
      });
    } else {
      log("phase4: skipped (deepRead disabled)");
    }
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

  // GitHub and comprehension are enrichment: a failure in either degrades the
  // report rather than failing the run, because the git-only report is still
  // usable and a hackathon demo should not die on a rate limit.
  if (useGitHub) {
    try {
      github = await recordPhase("github", async () => {
        const ctx = await collectGitHubContext(repoUrl, {
          windowFrom: window.from,
          windowTo: window.to,
          enrichPullRequests: true,
        });
        if (!ctx) {
          log("github: not a GitHub URL, skipped");
        } else {
          log(
            `github: ${ctx.pullRequests.length} merged PRs, ${ctx.issues.length} issues, ${ctx.releases.length} releases (auth=${ctx.authenticated})`,
          );
          for (const err of ctx.errors) warnings.push(`GitHub: ${err}`);
        }
        return ctx;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`GitHub enrichment failed: ${message}`);
      log(`github: failed (${message})`);
      github = null;
    }
  }

  const canComprehend = wantComprehension && deepRead && phase4 !== null;
  if (canComprehend && !comprehensionAvailable()) {
    warnings.push("Comprehension skipped: OPENAI_KEY is not set. Drafts fall back to heuristics.");
    log("comprehend: skipped (no OPENAI_KEY)");
  } else if (canComprehend) {
    try {
      comprehension = await recordPhase("comprehend", () =>
        comprehendRepo({
          meta,
          shape: phase1,
          structure: phase2,
          deep: phase4!,
          github,
          batchSize: options.comprehendBatchSize,
          onLog: log,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`Comprehension failed: ${message}. Drafts fall back to heuristics.`);
      log(`comprehend: failed (${message})`);
      comprehension = null;
    }
  } else if (!canComprehend && wantComprehension) {
    warnings.push("Comprehension skipped: the deep read did not run.");
  }

  const metaJsonPath = path.join(outDir, "meta.json");
  const phase1Path = path.join(outDir, "phase1-shape.txt");
  const phase2Path = path.join(outDir, "phase2-structure.txt");
  const phase3Path = path.join(outDir, "phase3-narrative.txt");
  const phase4Path = path.join(outDir, "phase4-deep-read.txt");
  const githubPath = path.join(outDir, "github.txt");
  const digestPath = path.join(outDir, "digest.md");
  const analysisPath = path.join(outDir, "analysis.md");

  await fs.writeFile(metaJsonPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await fs.writeFile(phase1Path, `${renderPhase1(phase1)}\n`, "utf8");
  await fs.writeFile(phase2Path, `${renderPhase2(phase2)}\n`, "utf8");
  await fs.writeFile(phase3Path, `${renderPhase3(phase3)}\n`, "utf8");
  if (phase4) await fs.writeFile(phase4Path, `${renderPhase4(phase4)}\n`, "utf8");
  if (github) await fs.writeFile(githubPath, `${renderGitHubContext(github)}\n`, "utf8");
  if (comprehension) {
    await fs.writeFile(digestPath, `${renderDigestMarkdown(comprehension)}\n`, "utf8");
  }

  let analysisBody = "";
  await recordPhase("synthesize", async () => {
    analysisBody = synthesizeAnalysis({
      meta,
      shape: phase1,
      structure: phase2,
      narrative: phase3,
      deep: phase4,
      github,
      comprehension,
      warnings,
    });
  });
  await fs.writeFile(analysisPath, `${analysisBody}\n`, "utf8");
  log(`analysis written to ${analysisPath}`);

  const artifacts: RepoHistoryArtifacts = {
    metaJson: metaJsonPath,
    phase1: phase1Path,
    phase2: phase2Path,
    phase3: phase3Path,
    phase4: phase4 ? phase4Path : undefined,
    github: github ? githubPath : undefined,
    digest: comprehension ? digestPath : undefined,
    analysis: analysisPath,
  };

  return {
    meta,
    artifacts,
    data: {
      shape: phase1,
      structure: phase2,
      narrative: phase3,
      deep: phase4,
      github,
      comprehension,
    },
    phases: {
      clone: { ms: phaseTimers.clone.ms, detail: clone.cloneDir },
      shape: { ms: phaseTimers.shape.ms, detail: `${phase1.dayHistogram.length} day buckets` },
      structure: { ms: phaseTimers.structure.ms, detail: `${phase2.treeDepth2.length} entries` },
      narrative: { ms: phaseTimers.narrative?.ms ?? 0, detail: `${phase3.commits.length} commits` },
      deep: phase4
        ? {
            ms: phaseTimers.deep?.ms ?? 0,
            detail: `${phase4.budget.commitsRead} patches, ${phase4.keyFiles.length} files, ${phase4.docs.length} docs`,
          }
        : undefined,
      github: github
        ? {
            ms: phaseTimers.github?.ms ?? 0,
            detail: `${github.pullRequests.length} PRs, ${github.issues.length} issues`,
          }
        : undefined,
      comprehend: comprehension
        ? {
            ms: phaseTimers.comprehend?.ms ?? 0,
            detail: `${comprehension.commitUnderstandings.length} commits read by ${comprehension.model}`,
          }
        : undefined,
      synthesize: { ms: phaseTimers.synthesize.ms, detail: analysisPath },
    },
    warnings,
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