import { runGit } from "./git";
import type { Window } from "./phase0";

export type CommitNumstatRow = {
  added: number | null;
  deleted: number | null;
  path: string;
};

export type CommitEntry = {
  sha: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  numstat: CommitNumstatRow[];
};

export type Phase3Narrative = {
  commits: CommitEntry[];
};

function excludeArgs(exclude: string[]): string[] {
  const out: string[] = [];
  for (const pattern of exclude) {
    out.push(`:(exclude)${pattern}`);
  }
  return out;
}

export async function collectPhase3(
  cloneDir: string,
  window: Window,
  exclude: string[],
): Promise<Phase3Narrative> {
  const pathspec = [".", ...excludeArgs(exclude)];
  const raw = await runGit(
    [
      "log",
      "--all",
      `--since=${window.from}`,
      `--until=${window.to}`,
      "--date=short",
      "--format=%n===BEGIN===%n%h|%ad|%an|%s|%b",
      "--numstat",
      ...pathspec,
    ],
    { cwd: cloneDir, timeoutMs: 60_000 },
  );

  const entries: CommitEntry[] = [];
  const chunks = raw.stdout.split("===BEGIN===");
  for (const chunk of chunks) {
    const trimmed = chunk.replace(/^\n+/, "");
    if (!trimmed) continue;
    const [header, ...rest] = trimmed.split(/\r?\n/);
    const parts = header.split("|");
    if (parts.length < 4) continue;
    const [sha, date, author, subject, ...bodyParts] = parts;
    const body = bodyParts.join("|").trim();
    const numstat: CommitNumstatRow[] = [];
    for (const line of rest) {
      const match = line.match(/^(-|\d+)\s+(-|\d+)\s+(.+)$/);
      if (!match) continue;
      const [, added, deleted, pathName] = match;
      numstat.push({
        added: added === "-" ? null : parseInt(added, 10),
        deleted: deleted === "-" ? null : parseInt(deleted, 10),
        path: pathName.trim(),
      });
    }
    entries.push({
      sha,
      date,
      author,
      subject,
      body,
      numstat,
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.sha.localeCompare(b.sha));
  return { commits: entries };
}

export function renderPhase3(narrative: Phase3Narrative): string {
  const lines: string[] = [];
  lines.push("=== per-commit numstat (window, excluding generated) ===");
  if (narrative.commits.length === 0) {
    lines.push("(no commits in window)");
    return lines.join("\n");
  }
  for (const commit of narrative.commits) {
    lines.push("");
    lines.push(`=== ${commit.sha} | ${commit.date} | ${commit.author} | ${commit.subject} ===`);
    if (commit.body) {
      for (const line of commit.body.split(/\r?\n/)) lines.push(`  ${line}`);
    }
    if (commit.numstat.length === 0) {
      lines.push("  (no tracked file changes)");
      continue;
    }
    for (const row of commit.numstat) {
      const a = row.added === null ? "-" : row.added.toString().padStart(4);
      const d = row.deleted === null ? "-" : row.deleted.toString().padStart(4);
      lines.push(`  ${a}\t${d}\t${row.path}`);
    }
  }
  return lines.join("\n");
}