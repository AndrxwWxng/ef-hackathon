import fs from "node:fs/promises";
import path from "node:path";

import { runGit } from "./git";
import type { Window } from "./phase0";

/**
 * Phase 4: the deep read.
 *
 * Phases 1-3 describe the *shape* of the week (who, when, which paths, how many
 * lines). They never open a file, so anything downstream is guessing from commit
 * subjects. This phase reads the actual content: per-commit patches, the current
 * text of the files that changed most, the repo's own prose, and the route
 * surface. Everything is bounded so a large repo degrades into a smaller read
 * instead of an unbounded one.
 */

export type DiffFile = {
  path: string;
  oldPath?: string;
  status: "added" | "deleted" | "renamed" | "modified" | "binary";
  added: number;
  deleted: number;
  hunks: string;
  hunksTruncated: boolean;
};

export type CommitDiff = {
  sha: string;
  shaFull: string;
  date: string;
  author: string;
  subject: string;
  body: string;
  isMerge: boolean;
  files: DiffFile[];
  filesOmitted: number;
};

export type FileSnapshot = {
  path: string;
  changeCount: number;
  lines: number;
  bytes: number;
  head: string;
  truncated: boolean;
};

export type DocFile = {
  path: string;
  kind: "readme" | "doc" | "agent-instructions";
  text: string;
  truncated: boolean;
};

export type RouteEntry = {
  route: string;
  file: string;
  kind: "page" | "api" | "layout";
};

export type Phase4Deep = {
  diffs: CommitDiff[];
  keyFiles: FileSnapshot[];
  docs: DocFile[];
  routes: RouteEntry[];
  entryPoints: string[];
  budget: {
    patchBytes: number;
    patchTruncated: boolean;
    commitsRead: number;
    commitsSkipped: number;
  };
};

export type Phase4Limits = {
  /** Total bytes of `git log --patch` output we are willing to hold. */
  maxPatchBytes: number;
  /** Commits we read patches for (most recent first). */
  maxCommits: number;
  /** Files kept per commit. */
  maxFilesPerCommit: number;
  /** Diff lines kept per file. */
  maxDiffLinesPerFile: number;
  /** Source files we snapshot at HEAD. */
  maxKeyFiles: number;
  /** Lines kept per snapshot. */
  maxKeyFileLines: number;
  /** Docs read. */
  maxDocs: number;
  /** Lines kept per doc. */
  maxDocLines: number;
};

export const DEFAULT_PHASE4_LIMITS: Phase4Limits = {
  maxPatchBytes: 1_500_000,
  maxCommits: 60,
  maxFilesPerCommit: 14,
  maxDiffLinesPerFile: 140,
  maxKeyFiles: 14,
  maxKeyFileLines: 200,
  maxDocs: 10,
  maxDocLines: 220,
};

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".cs", ".php",
  ".sql", ".graphql", ".prisma",
  ".css", ".scss", ".html", ".svelte", ".vue",
  ".json", ".yml", ".yaml", ".toml",
  ".sh", ".md", ".mdx", ".txt",
]);

const SNAPSHOT_SKIP = /(^|\/)(node_modules|\.next|dist|build|vendor|coverage|__snapshots__)(\/|$)/;

/**
 * Record delimiters for the patch stream. Both sentinels sit alone on their own
 * line: every line of diff content is prefixed by `+`, `-`, or a space, so no
 * file content can ever produce a line that equals one of these exactly.
 */
const COMMIT_SENTINEL = "<<<REPO-HISTORY-COMMIT>>>";
const HEADER_END = "<<<REPO-HISTORY-HEADER-END>>>";
const FIELD_SEP = "~::~";

function excludeArgs(exclude: string[]): string[] {
  return exclude.map((pattern) => `:(exclude)${pattern}`);
}

function isTextPath(p: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(p).toLowerCase());
}

export async function collectPhase4(
  cloneDir: string,
  window: Window,
  exclude: string[],
  overrides: Partial<Phase4Limits> = {},
): Promise<Phase4Deep> {
  const limits: Phase4Limits = { ...DEFAULT_PHASE4_LIMITS, ...overrides };
  const diffResult = await collectDiffs(cloneDir, window, exclude, limits);
  const churnPaths = rankPathsByChurn(diffResult.diffs);
  const keyFiles = await snapshotKeyFiles(cloneDir, churnPaths, limits);
  const tracked = await listTracked(cloneDir);
  const docs = await readDocs(cloneDir, tracked, churnPaths, limits);
  const routes = inferRoutes(tracked);
  const entryPoints = inferEntryPoints(tracked);

  return {
    diffs: diffResult.diffs,
    keyFiles,
    docs,
    routes,
    entryPoints,
    budget: diffResult.budget,
  };
}

/**
 * One `git log --patch` invocation for the whole window. A single process keeps
 * the lazy blob fetch of a `--filter=blob:none` clone to one batched round trip
 * instead of one per commit.
 */
async function collectDiffs(
  cloneDir: string,
  window: Window,
  exclude: string[],
  limits: Phase4Limits,
): Promise<{ diffs: CommitDiff[]; budget: Phase4Deep["budget"] }> {
  const raw = await runGit(
    [
      "log",
      "--all",
      `--since=${window.from}`,
      `--until=${window.to}`,
      `--max-count=${limits.maxCommits}`,
      "--date=short",
      "--no-color",
      "--find-renames",
      "--patch",
      "--unified=2",
      "--no-textconv",
      `--format=%n${COMMIT_SENTINEL}%n%H${FIELD_SEP}%h${FIELD_SEP}%ad${FIELD_SEP}%an${FIELD_SEP}%s${FIELD_SEP}%b%n${HEADER_END}`,
      ".",
      ...excludeArgs(exclude),
    ],
    { cwd: cloneDir, timeoutMs: 180_000, maxBytes: limits.maxPatchBytes },
  );

  const chunks = raw.stdout.split(`\n${COMMIT_SENTINEL}\n`).slice(1);
  const diffs: CommitDiff[] = [];
  let skipped = 0;

  for (const chunk of chunks) {
    const endIdx = chunk.indexOf(`\n${HEADER_END}\n`);
    if (endIdx < 0) {
      // Truncation landed mid-header; nothing reliable to parse.
      skipped += 1;
      continue;
    }
    const header = chunk.slice(0, endIdx);
    const patch = chunk.slice(endIdx + HEADER_END.length + 2);
    const [shaFull = "", sha = "", date = "", author = "", subject = "", ...bodyParts] =
      header.split(FIELD_SEP);
    if (!shaFull) {
      skipped += 1;
      continue;
    }
    const { files, omitted } = parsePatch(patch, limits);
    diffs.push({
      sha,
      shaFull,
      date,
      author,
      subject,
      body: bodyParts.join(FIELD_SEP).trim(),
      isMerge: files.length === 0 && /^merge\b/i.test(subject),
      files,
      filesOmitted: omitted,
    });
  }

  diffs.sort((a, b) => a.date.localeCompare(b.date) || a.sha.localeCompare(b.sha));

  return {
    diffs,
    budget: {
      patchBytes: raw.stdout.length,
      patchTruncated: raw.truncated,
      commitsRead: diffs.length,
      commitsSkipped: skipped,
    },
  };
}

function parsePatch(patch: string, limits: Phase4Limits): { files: DiffFile[]; omitted: number } {
  const sections = patch.split(/^diff --git /m).slice(1);
  const files: DiffFile[] = [];
  let omitted = 0;

  for (const section of sections) {
    if (files.length >= limits.maxFilesPerCommit) {
      omitted += 1;
      continue;
    }
    const lines = section.split(/\r?\n/);
    const pathLine = lines[0] ?? "";
    const pathMatch = pathLine.match(/^a\/(.+?) b\/(.+)$/);
    const filePath = pathMatch?.[2] ?? pathLine.trim();
    const oldPath = pathMatch?.[1];

    let status: DiffFile["status"] = "modified";
    let added = 0;
    let deleted = 0;
    const hunkLines: string[] = [];
    let inHunk = false;
    let hunkTruncated = false;

    for (const line of lines.slice(1)) {
      if (line.startsWith("new file mode")) status = "added";
      else if (line.startsWith("deleted file mode")) status = "deleted";
      else if (line.startsWith("rename from") || line.startsWith("rename to")) status = "renamed";
      else if (line.startsWith("Binary files") || line.startsWith("GIT binary patch")) {
        status = "binary";
        break;
      }
      if (line.startsWith("@@")) inHunk = true;
      if (!inHunk) continue;
      if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
      if (line.startsWith("-") && !line.startsWith("---")) deleted += 1;
      if (hunkLines.length < limits.maxDiffLinesPerFile) {
        hunkLines.push(line);
      } else {
        hunkTruncated = true;
      }
    }

    files.push({
      path: filePath,
      oldPath: oldPath && oldPath !== filePath ? oldPath : undefined,
      status,
      added,
      deleted,
      hunks: status === "binary" ? "(binary file)" : hunkLines.join("\n"),
      hunksTruncated: hunkTruncated,
    });
  }

  return { files, omitted };
}

function rankPathsByChurn(diffs: CommitDiff[]): Array<{ path: string; count: number }> {
  const counts = new Map<string, number>();
  for (const commit of diffs) {
    for (const file of commit.files) {
      if (file.status === "deleted" || file.status === "binary") continue;
      counts.set(file.path, (counts.get(file.path) ?? 0) + file.added + file.deleted);
    }
  }
  return [...counts.entries()]
    .map(([p, count]) => ({ path: p, count }))
    .sort((a, b) => b.count - a.count);
}

async function snapshotKeyFiles(
  cloneDir: string,
  ranked: Array<{ path: string; count: number }>,
  limits: Phase4Limits,
): Promise<FileSnapshot[]> {
  const out: FileSnapshot[] = [];
  for (const entry of ranked) {
    if (out.length >= limits.maxKeyFiles) break;
    if (!isTextPath(entry.path) || SNAPSHOT_SKIP.test(entry.path)) continue;
    const full = path.join(cloneDir, entry.path);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > 400_000) continue;
    const raw = await fs.readFile(full, "utf8").catch(() => null);
    if (raw === null) continue;
    const lines = raw.split(/\r?\n/);
    const truncated = lines.length > limits.maxKeyFileLines;
    out.push({
      path: entry.path,
      changeCount: entry.count,
      lines: lines.length,
      bytes: stat.size,
      head: lines.slice(0, limits.maxKeyFileLines).join("\n"),
      truncated,
    });
  }
  return out;
}

async function listTracked(cloneDir: string): Promise<string[]> {
  const result = await runGit(["ls-files", "--full-name"], {
    cwd: cloneDir,
    timeoutMs: 30_000,
    maxBytes: 4_000_000,
  });
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

/**
 * The repo's own prose is the cheapest source of intent we have. Root README
 * first, then any README living in a directory that changed this window (those
 * describe the subsystem actually being worked on), then top-level docs.
 */
async function readDocs(
  cloneDir: string,
  tracked: string[],
  churn: Array<{ path: string; count: number }>,
  limits: Phase4Limits,
): Promise<DocFile[]> {
  const touchedDirs = new Set(churn.map((c) => path.dirname(c.path)));
  const candidates: Array<{ path: string; kind: DocFile["kind"]; rank: number }> = [];

  for (const file of tracked) {
    if (SNAPSHOT_SKIP.test(file)) continue;
    const base = path.basename(file);
    const dir = path.dirname(file);
    const depth = file.split("/").length;

    if (/^README(\.(md|txt|mdx))?$/i.test(base)) {
      const touched = touchedDirs.has(dir);
      candidates.push({
        path: file,
        kind: "readme",
        rank: (dir === "." ? 0 : 20) - (touched ? 15 : 0) + depth,
      });
      continue;
    }
    if (/^(CLAUDE|AGENTS)\.md$/i.test(base)) {
      candidates.push({ path: file, kind: "agent-instructions", rank: 5 + depth });
      continue;
    }
    if (/^(ARCHITECTURE|CONTRIBUTING|CHANGELOG|ROADMAP|SPEC|DESIGN)\.(md|mdx|txt)$/i.test(base)) {
      candidates.push({ path: file, kind: "doc", rank: 10 + depth });
      continue;
    }
    if (/^docs\//i.test(file) && /\.(md|mdx)$/i.test(base)) {
      candidates.push({ path: file, kind: "doc", rank: 30 + depth });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));

  const out: DocFile[] = [];
  for (const candidate of candidates) {
    if (out.length >= limits.maxDocs) break;
    const raw = await fs
      .readFile(path.join(cloneDir, candidate.path), "utf8")
      .catch(() => null);
    if (raw === null) continue;
    const lines = raw.split(/\r?\n/);
    out.push({
      path: candidate.path,
      kind: candidate.kind,
      text: lines.slice(0, limits.maxDocLines).join("\n"),
      truncated: lines.length > limits.maxDocLines,
    });
  }
  return out;
}

/**
 * Real user-visible surfaces, derived from the framework's file conventions.
 * Downstream this feeds both the writer ("the new digest view") and the
 * screenshot tool, which previously received manifest filenames.
 */
function inferRoutes(tracked: string[]): RouteEntry[] {
  const out: RouteEntry[] = [];
  const seen = new Set<string>();

  const push = (route: string, file: string, kind: RouteEntry["kind"]) => {
    const key = `${kind}:${route}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ route, file, kind });
  };

  for (const file of tracked) {
    if (SNAPSHOT_SKIP.test(file)) continue;

    // Next.js app router: app/**/page.tsx, app/**/route.ts
    const appMatch = file.match(/^(?:src\/)?app\/(.*)?(page|route|layout)\.(tsx|ts|jsx|js)$/);
    if (appMatch) {
      const segments = (appMatch[1] ?? "")
        .split("/")
        .filter(Boolean)
        // Route groups `(marketing)` and parallel routes `@modal` are not URL segments.
        .filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith("@"));
      const route = `/${segments.join("/")}`.replace(/\/+$/, "") || "/";
      const kind = appMatch[2] === "route" ? "api" : appMatch[2] === "layout" ? "layout" : "page";
      if (kind !== "layout") push(route, file, kind);
      continue;
    }

    // Next.js pages router
    const pagesMatch = file.match(/^(?:src\/)?pages\/(.*)\.(tsx|ts|jsx|js)$/);
    if (pagesMatch) {
      const raw = pagesMatch[1];
      if (/^_(app|document|error)$/.test(raw)) continue;
      const route = `/${raw.replace(/\/?index$/, "")}` || "/";
      push(route || "/", file, raw.startsWith("api/") ? "api" : "page");
    }
  }

  return out.sort((a, b) => a.route.localeCompare(b.route));
}

function inferEntryPoints(tracked: string[]): string[] {
  const patterns = [
    /^(?:src\/)?(main|index|server|app)\.(ts|tsx|js|jsx|py|go|rs)$/,
    /^(?:src\/)?app\/layout\.(tsx|jsx)$/,
    /^(Dockerfile|docker-compose\.ya?ml|Procfile|Makefile)$/,
    /^\.github\/workflows\/.+\.ya?ml$/,
  ];
  return tracked.filter((f) => patterns.some((re) => re.test(f))).slice(0, 20);
}

export function renderPhase4(deep: Phase4Deep): string {
  const lines: string[] = [];

  lines.push("=== deep read budget ===");
  lines.push(
    `patch bytes: ${deep.budget.patchBytes.toLocaleString()}${deep.budget.patchTruncated ? " (TRUNCATED)" : ""}`,
  );
  lines.push(`commits read: ${deep.budget.commitsRead}, skipped: ${deep.budget.commitsSkipped}`);
  lines.push("");

  lines.push("=== routes (user-visible surfaces) ===");
  if (deep.routes.length === 0) lines.push("(none detected)");
  for (const r of deep.routes) lines.push(`${r.kind.padEnd(4)}  ${r.route}  <- ${r.file}`);
  lines.push("");

  lines.push("=== entry points ===");
  if (deep.entryPoints.length === 0) lines.push("(none detected)");
  for (const e of deep.entryPoints) lines.push(e);
  lines.push("");

  lines.push("=== docs read ===");
  for (const doc of deep.docs) {
    lines.push("");
    lines.push(`--- ${doc.path} (${doc.kind})${doc.truncated ? " [truncated]" : ""} ---`);
    lines.push(doc.text);
  }
  lines.push("");

  lines.push("=== key files at HEAD ===");
  for (const file of deep.keyFiles) {
    lines.push("");
    lines.push(
      `--- ${file.path} (${file.lines} lines, ${file.changeCount} lines changed this window)${file.truncated ? " [head only]" : ""} ---`,
    );
    lines.push(file.head);
  }
  lines.push("");

  lines.push("=== per-commit patches ===");
  for (const commit of deep.diffs) {
    lines.push("");
    lines.push(`=== ${commit.sha} | ${commit.date} | ${commit.author} | ${commit.subject} ===`);
    if (commit.body) lines.push(commit.body);
    if (commit.files.length === 0) {
      lines.push("  (no tracked file changes; merge commit or excluded paths only)");
      continue;
    }
    for (const file of commit.files) {
      lines.push("");
      lines.push(
        `  ${file.status}: ${file.oldPath ? `${file.oldPath} -> ` : ""}${file.path} (+${file.added}/-${file.deleted})${file.hunksTruncated ? " [diff truncated]" : ""}`,
      );
      if (file.hunks) {
        for (const line of file.hunks.split("\n")) lines.push(`  ${line}`);
      }
    }
    if (commit.filesOmitted > 0) {
      lines.push(`  (+${commit.filesOmitted} more files omitted)`);
    }
  }

  return lines.join("\n");
}
