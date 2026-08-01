import { runGit } from "./git";
import type { Window } from "./phase0";

export type ChurnRow = { path: string; count: number };

export type Phase1Shape = {
  dayHistogram: Array<{ date: string; count: number }>;
  contributors: Array<{ name: string; email: string; count: number }>;
  branches: Array<{ date: string; ref: string; author: string; subject: string }>;
  tags: Array<{ date: string; ref: string; subject: string }>;
  churn: ChurnRow[];
  mainline: Array<{ date: string; sha: string; author: string; subject: string }>;
  mergeRatio: { allMerges: number; allCommits: number; weekMerges: number; weekCommits: number };
};

function excludeArgs(exclude: string[]): string[] {
  const out: string[] = [];
  for (const pattern of exclude) {
    out.push(`:(exclude)${pattern}`);
  }
  return out;
}

function parseCountedLines(raw: string): Array<{ value: string; count: number }> {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) return null;
      return { count: parseInt(match[1], 10) || 0, value: match[2].trim() };
    })
    .filter((row): row is { value: string; count: number } => row !== null);
}

export async function collectPhase1(
  cloneDir: string,
  window: Window,
  counts: { totalCommits: number; totalMerges: number; weekCommits: number; weekMerges: number },
  exclude: string[],
): Promise<Phase1Shape> {
  const pathspec = [".", ...excludeArgs(exclude)];

  const daysRaw = await runGit(
    [
      "log",
      "--all",
      `--since=${window.from}`,
      `--until=${window.to}`,
      "--date=short",
      "--format=%ad",
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const dayBuckets = new Map<string, number>();
  for (const line of daysRaw.stdout.split(/\r?\n/)) {
    const date = line.trim();
    if (!date) continue;
    dayBuckets.set(date, (dayBuckets.get(date) ?? 0) + 1);
  }

  const shortlog = await runGit(
    [
      "shortlog",
      "-sne",
      "--all",
      `--since=${window.from}`,
      `--until=${window.to}`,
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const contributors = parseCountedLines(shortlog.stdout).map((row) => {
    const match = row.value.match(/^(.*?)\s*<([^>]+)>$/);
    return {
      name: match?.[1]?.trim() ?? row.value,
      email: match?.[2] ?? "",
      count: row.count,
    };
  });

  const branchesRaw = await runGit(
    [
      "for-each-ref",
      "--sort=-committerdate",
      "refs/remotes",
      "--format=%(committerdate:short)|%(refname:short)|%(authorname)|%(contents:subject)",
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const branches = branchesRaw.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, ref, author, subject = ""] = line.split("|");
      return { date, ref, author, subject };
    });

  const tagsRaw = await runGit(
    [
      "tag",
      "--sort=-creatordate",
      "--format=%(creatordate:short)|%(refname:short)|%(subject)",
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const tags = tagsRaw.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, ref, subject = ""] = line.split("|");
      return { date, ref, subject };
    });

  const churnRaw = await runGit(
    [
      "log",
      "--all",
      `--since=${window.from}`,
      `--until=${window.to}`,
      "--format=",
      "--name-only",
      ...pathspec,
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const churnBuckets = new Map<string, number>();
  for (const line of churnRaw.stdout.split(/\r?\n/)) {
    const value = line.trim();
    if (!value) continue;
    churnBuckets.set(value, (churnBuckets.get(value) ?? 0) + 1);
  }
  const churn: ChurnRow[] = [...churnBuckets.entries()]
    .map(([pathName, count]) => ({ path: pathName, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);

  const mainlineRaw = await runGit(
    [
      "log",
      "--first-parent",
      "HEAD",
      "--date=short",
      `--since=${window.from}`,
      `--until=${window.to}`,
      "--format=%ad|%h|%an|%s",
    ],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );
  const mainline = mainlineRaw.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [date, sha, author, subject = ""] = line.split("|");
      return { date, sha, author, subject };
    });

  return {
    dayHistogram: [...dayBuckets.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    contributors,
    branches,
    tags,
    churn,
    mainline,
    mergeRatio: {
      allMerges: counts.totalMerges,
      allCommits: counts.totalCommits,
      weekMerges: counts.weekMerges,
      weekCommits: counts.weekCommits,
    },
  };
}

export function renderPhase1(shape: Phase1Shape): string {
  const lines: string[] = [];
  lines.push("=== day histogram (window) ===");
  if (shape.dayHistogram.length === 0) {
    lines.push("(none)");
  } else {
    for (const row of shape.dayHistogram) lines.push(`${row.count}\t${row.date}`);
  }
  lines.push("");
  lines.push("=== contributors (window) ===");
  if (shape.contributors.length === 0) lines.push("(none)");
  for (const c of shape.contributors) lines.push(`${c.count}\t${c.name} <${c.email}>`);
  lines.push("");
  lines.push("=== branches, recently active ===");
  if (shape.branches.length === 0) lines.push("(none)");
  for (const b of shape.branches)
    lines.push(`${b.date}  ${b.ref}  ${b.author}  ${b.subject}`);
  lines.push("");
  lines.push("=== tags ===");
  if (shape.tags.length === 0) lines.push("(none)");
  for (const t of shape.tags) lines.push(`${t.date}  ${t.ref}  ${t.subject}`);
  lines.push("");
  lines.push("=== churn hotspots (window, excluding generated) ===");
  if (shape.churn.length === 0) lines.push("(none)");
  for (const row of shape.churn) lines.push(`${row.count}\t${row.path}`);
  lines.push("");
  lines.push("=== mainline narrative (--first-parent) ===");
  if (shape.mainline.length === 0) lines.push("(none)");
  for (const m of shape.mainline) lines.push(`${m.date}  ${m.sha}  ${m.author}  ${m.subject}`);
  lines.push("");
  lines.push("=== merge ratio ===");
  lines.push(
    `all merges: ${shape.mergeRatio.allMerges} / all commits: ${shape.mergeRatio.allCommits}`,
  );
  lines.push(
    `window merges: ${shape.mergeRatio.weekMerges} / window commits: ${shape.mergeRatio.weekCommits}`,
  );
  return lines.join("\n");
}