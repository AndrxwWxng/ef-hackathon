import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { repoNameFromUrl, runGit } from "./git";
import type { RepoHistoryMeta, RepoHistoryOptions, WindowAnchor } from "./types";

export type CloneResult = {
  cloneDir: string;
  repoName: string;
  shallow: boolean;
};

export type CloneOptions = {
  fetchTimeoutMs?: number;
  cloneRoot?: string;
};

export async function cloneRepoForHistory(
  repoUrl: string,
  options: CloneOptions = {},
): Promise<CloneResult> {
  const repoName = repoNameFromUrl(repoUrl);
  const cloneRoot = path.resolve(options.cloneRoot ?? path.join(os.tmpdir(), "repo-history-clones"));
  await fs.mkdir(cloneRoot, { recursive: true });
  const cloneDir = path.join(cloneRoot, repoName);

  const exists = await fs
    .stat(path.join(cloneDir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await runGit(
      ["clone", "--filter=blob:none", "--quiet", repoUrl, cloneDir],
      { cwd: cloneRoot, timeoutMs: options.fetchTimeoutMs ?? 120_000 },
    );
  }

  await runGit(["fetch", "--all", "--tags", "--quiet", "--prune"], {
    cwd: cloneDir,
    timeoutMs: options.fetchTimeoutMs ?? 180_000,
  });

  const shallowResult = await runGit(["rev-parse", "--is-shallow-repository"], {
    cwd: cloneDir,
    timeoutMs: 10_000,
  });
  const shallow = shallowResult.stdout.trim() === "true";
  if (shallow) {
    await runGit(["fetch", "--unshallow", "--quiet"], {
      cwd: cloneDir,
      timeoutMs: options.fetchTimeoutMs ?? 240_000,
    });
  }

  return { cloneDir, repoName, shallow: false };
}

export async function resolveBranch(
  cloneDir: string,
  requested: string | undefined,
): Promise<string> {
  if (requested && requested.trim()) return requested.trim();

  const remoteResult = await runGit(
    ["remote", "show", "origin"],
    { cwd: cloneDir, timeoutMs: 15_000 },
  );
  const headLine = remoteResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith("head branch:"));
  if (headLine) {
    const name = headLine.slice("HEAD branch:".length).trim();
    if (name) return name;
  }

  for (const fallback of ["main", "master", "trunk"]) {
    const probe = await runGit(
      ["rev-parse", "--verify", `--quiet`, `refs/heads/${fallback}`],
      { cwd: cloneDir, timeoutMs: 10_000 },
    );
    if (probe.exitCode === 0) return fallback;
  }
  throw new Error("Could not determine default branch");
}

export type Window = {
  from: string;
  to: string;
  anchorIso: string;
  mode: WindowAnchor;
  days: number;
};

export async function computeWindow(
  cloneDir: string,
  days: number,
  mode: WindowAnchor,
): Promise<Window> {
  let anchorIso: string;
  if (mode === "now") {
    anchorIso = new Date().toISOString();
  } else {
    const result = await runGit(
      ["log", "--all", "--format=%cI", "-n", "1"],
      { cwd: cloneDir, timeoutMs: 15_000 },
    );
    const head = result.stdout.trim();
    if (!head) throw new Error("Repository has no commits");
    anchorIso = head;
  }
  const anchor = new Date(anchorIso);
  const from = new Date(anchor.getTime() - days * 86_400_000);
  const to = new Date(anchor.getTime() + 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    anchorIso: anchor.toISOString(),
    mode,
    days,
  };
}

export type Counts = {
  totalCommits: number;
  totalMerges: number;
  weekCommits: number;
  weekMerges: number;
};

export async function collectCounts(
  cloneDir: string,
  window: Window,
): Promise<Counts> {
  const all = await runGit(["rev-list", "--all", "--count"], {
    cwd: cloneDir,
    timeoutMs: 30_000,
  });
  const allMerges = await runGit(["rev-list", "--all", "--merges", "--count"], {
    cwd: cloneDir,
    timeoutMs: 30_000,
  });
  const week = await runGit(
    ["rev-list", "--all", `--since=${window.from}`, `--until=${window.to}`, "--count"],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const weekMerges = await runGit(
    [
      "rev-list",
      "--all",
      "--merges",
      `--since=${window.from}`,
      `--until=${window.to}`,
      "--count",
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  return {
    totalCommits: parseInt(all.stdout.trim(), 10) || 0,
    totalMerges: parseInt(allMerges.stdout.trim(), 10) || 0,
    weekCommits: parseInt(week.stdout.trim(), 10) || 0,
    weekMerges: parseInt(weekMerges.stdout.trim(), 10) || 0,
  };
}

export function buildMeta(args: {
  repoUrl: string;
  repoName: string;
  branch: string;
  window: Window;
  counts: Counts;
  shallow: boolean;
  cloneDir: string;
  outDir: string;
  generatedAt: string;
}): RepoHistoryMeta {
  return {
    repoUrl: args.repoUrl,
    repoName: args.repoName,
    branch: args.branch,
    windowFrom: args.window.from,
    windowTo: args.window.to,
    windowAnchorIso: args.window.anchorIso,
    windowAnchorMode: args.window.mode,
    windowDays: args.window.days,
    totalCommits: args.counts.totalCommits,
    totalMerges: args.counts.totalMerges,
    weekCommits: args.counts.weekCommits,
    weekMerges: args.counts.weekMerges,
    shallow: args.shallow,
    cloneDir: args.cloneDir,
    outDir: args.outDir,
    generatedAt: args.generatedAt,
  };
}