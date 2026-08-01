import OpenAI from "openai";

import type { DigestChange, RepoDigest } from "../weekly-source";
import type { GitHubContext } from "./github";
import type { Phase1Shape } from "./phase1";
import type { Phase2Structure } from "./phase2";
import type { CommitDiff, Phase4Deep } from "./phase4";
import type { RepoHistoryMeta } from "./types";

/**
 * Comprehension pass.
 *
 * Everything before this point collects evidence. This is where the evidence is
 * actually read. It runs map/reduce so the window survives a large week:
 *
 *   map    - batches of commits, each read *with its patch*, turned into a
 *            plain-language account of what that commit did and why it matters
 *   reduce - those accounts plus the repo's docs, structure, routes and GitHub
 *            prose, turned into one digest of the project and the window
 *
 * The hard rule in both prompts is that every claim must be traceable to a sha
 * or a path, and anything not visible in the evidence goes in `unknowns` rather
 * than being asserted. That constraint is the whole point: the previous version
 * of this pipeline invented the "why" from a lookup table.
 */

export const COMPREHEND_MODEL = process.env.REPO_COMPREHEND_MODEL ?? "gpt-5";

export type CommitUnderstanding = {
  sha: string;
  subject: string;
  kind: "feature" | "fix" | "refactor" | "docs" | "infra" | "test" | "chore" | "unclear";
  whatChanged: string;
  whyItMatters: string;
  userVisible: boolean;
  surfaces: string[];
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

export type ComprehensionResult = {
  digest: RepoDigest;
  commitUnderstandings: CommitUnderstanding[];
  model: string;
  batches: number;
  promptChars: number;
};

export type ComprehendOptions = {
  meta: RepoHistoryMeta;
  shape: Phase1Shape;
  structure: Phase2Structure;
  deep: Phase4Deep;
  github: GitHubContext | null;
  /** Commits per map call. Smaller batches read more carefully but cost more. */
  batchSize?: number;
  /** Cap on patch characters handed to a single map call. */
  maxBatchChars?: number;
  onLog?: (line: string) => void;
};

const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_MAX_BATCH_CHARS = 60_000;

function client(): OpenAI {
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) throw new Error("OPENAI_KEY is not set in the environment");
  return new OpenAI({ apiKey });
}

export function comprehensionAvailable(): boolean {
  return Boolean(process.env.OPENAI_KEY);
}

const GROUNDING_RULES = [
  "You are reading a real code diff. Base every statement on what the diff, the file contents, or the repo's own docs actually show.",
  "Every claim must be traceable to a commit sha or a file path, and you must list those in `evidence`.",
  "If you cannot tell what a change accomplishes, say so plainly and mark confidence \"low\". Never guess at intent to fill a field.",
  "Do not describe a change as user-facing unless you can point to a route, component, API surface, or copy change that a user would encounter.",
  "Do not invent metrics, partners, customers, testimonials, deadlines, or roadmap items.",
  "Renamed or moved code is not a new feature. Config, lockfile, and formatting churn is not a feature.",
  "Prefer the smallest true statement over an impressive-sounding one.",
].join("\n");

function renderCommitForPrompt(commit: CommitDiff, maxChars: number): string {
  const lines: string[] = [];
  lines.push(`### commit ${commit.sha} (${commit.date}, ${commit.author})`);
  lines.push(`subject: ${commit.subject}`);
  if (commit.body) lines.push(`body: ${commit.body}`);
  if (commit.files.length === 0) {
    lines.push("(no file changes captured: merge commit, or all paths excluded)");
    return lines.join("\n");
  }
  lines.push(
    `files: ${commit.files
      .map((f) => `${f.path} (${f.status}, +${f.added}/-${f.deleted})`)
      .join(", ")}${commit.filesOmitted ? ` (+${commit.filesOmitted} omitted)` : ""}`,
  );
  let used = lines.join("\n").length;
  for (const file of commit.files) {
    if (!file.hunks) continue;
    const block = `\n--- ${file.path} (${file.status}) ---\n${file.hunks}${file.hunksTruncated ? "\n[diff truncated]" : ""}`;
    if (used + block.length > maxChars) {
      lines.push(`\n[remaining diffs omitted to stay within the read budget]`);
      break;
    }
    lines.push(block);
    used += block.length;
  }
  return lines.join("\n");
}

const COMMIT_BATCH_SCHEMA = `{
  "commits": [
    {
      "sha": "string, the short sha exactly as given",
      "subject": "string, the commit subject as given",
      "kind": "feature | fix | refactor | docs | infra | test | chore | unclear",
      "whatChanged": "2-3 sentences describing concretely what the code now does that it did not before. Name the real functions, files, routes, or behaviors.",
      "whyItMatters": "1-2 sentences on the practical consequence. If the consequence is only internal, say that.",
      "userVisible": true,
      "surfaces": ["route, page, API path, or CLI command a person would touch; empty if none"],
      "confidence": "high | medium | low",
      "evidence": ["sha path/to/file.ts", "..."]
    }
  ]
}`;

async function readCommitBatch(
  openai: OpenAI,
  batch: CommitDiff[],
  maxBatchChars: number,
): Promise<CommitUnderstanding[]> {
  const perCommit = Math.max(2_000, Math.floor(maxBatchChars / Math.max(1, batch.length)));
  const body = batch.map((c) => renderCommitForPrompt(c, perCommit)).join("\n\n");

  const completion = await openai.chat.completions.create({
    model: COMPREHEND_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a staff engineer reading a colleague's commits so you can explain them accurately to someone who will not read the code.\n" +
          GROUNDING_RULES +
          "\nReturn ONLY JSON matching the requested shape. One entry per commit given, in the same order.",
      },
      {
        role: "user",
        content:
          `Read these ${batch.length} commits and their diffs.\n\n${body}\n\n` +
          `Return JSON of exactly this shape:\n${COMMIT_BATCH_SCHEMA}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) return [];
  const parsed = safeParse<{ commits?: unknown }>(raw);
  if (!parsed || !Array.isArray(parsed.commits)) return [];
  return parsed.commits
    .map((entry) => coerceCommitUnderstanding(entry))
    .filter((entry): entry is CommitUnderstanding => entry !== null);
}

const DIGEST_SCHEMA = `{
  "project": {
    "name": "string",
    "oneLiner": "one sentence a non-technical reader would understand",
    "whatItDoes": "3-4 sentences on how the product actually works, based on the code and docs you were given",
    "whoItIsFor": "one sentence, or \\"unclear from the repository\\"",
    "stack": ["observed technologies only"],
    "surfaces": ["real routes, pages, or commands"]
  },
  "window": {
    "headline": "the single most important thing that happened this window, in one line",
    "summary": "3-5 sentences on the arc of the window"
  },
  "features": [
    {
      "title": "string",
      "whatChanged": "concrete, names real behavior",
      "whyItMatters": "practical consequence for the reader",
      "audience": "user | developer | internal",
      "confidence": "high | medium | low",
      "evidence": ["sha or path"]
    }
  ],
  "fixes": [ "same shape as features" ],
  "infrastructure": [ "same shape as features" ],
  "themes": ["short phrases describing what the week was about"],
  "inProgress": [{ "title": "string", "signal": "the specific unfinished thing in the code that suggests it" }],
  "risks": ["only things visible in the code: TODOs, disabled tests, hardcoded values, missing error handling"],
  "unknowns": ["things a reader might expect to know that this evidence does not establish"],
  "notableNumbers": [{ "label": "string", "value": "string", "source": "where the number came from" }]
}`;

function renderProjectContext(options: ComprehendOptions): string {
  const { meta, shape, structure, deep, github } = options;
  const lines: string[] = [];

  lines.push(`Repository: ${meta.repoUrl} (branch ${meta.branch})`);
  lines.push(`Window: ${meta.windowFrom} to ${meta.windowTo} (${meta.windowDays} days)`);
  lines.push(
    `Commits in window: ${meta.weekCommits} (${meta.weekMerges} merges). Repo lifetime commits: ${meta.totalCommits}.`,
  );
  lines.push(
    `Contributors in window: ${shape.contributors.map((c) => `${c.name} (${c.count})`).join(", ") || "(none)"}`,
  );
  lines.push("");

  if (github?.info) {
    lines.push("GitHub metadata:");
    lines.push(`  description: ${github.info.description ?? "(none)"}`);
    lines.push(`  homepage: ${github.info.homepage ?? "(none)"}`);
    lines.push(`  topics: ${github.info.topics.join(", ") || "(none)"}`);
    lines.push(`  primary language: ${github.info.language ?? "(unknown)"}`);
    lines.push("");
  }

  if (github && github.pullRequests.length > 0) {
    lines.push(`Merged pull requests in window (${github.pullRequests.length}):`);
    for (const pr of github.pullRequests) {
      lines.push(`  #${pr.number} ${pr.title} (${pr.author})`);
      if (pr.body) lines.push(`    ${pr.body.split("\n").slice(0, 12).join("\n    ")}`);
    }
    lines.push("");
  }

  if (github && github.releases.length > 0) {
    lines.push(`Releases in window (${github.releases.length}):`);
    for (const rel of github.releases) {
      lines.push(`  ${rel.tag} ${rel.name}`);
      if (rel.body) lines.push(`    ${rel.body.split("\n").slice(0, 12).join("\n    ")}`);
    }
    lines.push("");
  }

  if (github && github.issues.length > 0) {
    lines.push(`Issues touched in window (${github.issues.length}):`);
    for (const issue of github.issues) {
      lines.push(`  #${issue.number} [${issue.state}] ${issue.title}`);
    }
    lines.push("");
  }

  if (deep.routes.length > 0) {
    lines.push("Routes detected in the codebase:");
    for (const route of deep.routes) lines.push(`  ${route.kind}  ${route.route}  (${route.file})`);
    lines.push("");
  }

  if (structure.packageJson) {
    lines.push("package.json dependencies:");
    lines.push(structure.packageJson.dependencies || "(none)");
    lines.push("");
  }

  lines.push("Top-level structure:");
  lines.push(structure.treeDepth2.slice(0, 60).join("\n"));
  lines.push("");

  for (const doc of deep.docs) {
    lines.push(`--- ${doc.path} (${doc.kind}) ---`);
    lines.push(doc.text);
    lines.push("");
  }

  for (const file of deep.keyFiles.slice(0, 8)) {
    lines.push(`--- current contents of ${file.path} (most-changed this window) ---`);
    lines.push(file.head);
    lines.push("");
  }

  return lines.join("\n");
}

async function reduceToDigest(
  openai: OpenAI,
  understandings: CommitUnderstanding[],
  options: ComprehendOptions,
): Promise<RepoDigest> {
  const commitBlock = understandings
    .map(
      (u) =>
        `- ${u.sha} [${u.kind}${u.userVisible ? ", user-visible" : ""}, confidence ${u.confidence}] ${u.subject}\n` +
        `    what: ${u.whatChanged}\n` +
        `    why: ${u.whyItMatters}\n` +
        `    evidence: ${u.evidence.join("; ") || "(none)"}`,
    )
    .join("\n");

  const completion = await openai.chat.completions.create({
    model: COMPREHEND_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a staff engineer writing the briefing that a newsletter author will work from. " +
          "You have already read every commit in this window; you are now consolidating.\n" +
          GROUNDING_RULES +
          "\nGroup related commits into one item rather than listing each commit. " +
          "Order features by how much they matter to a reader, not by commit order. " +
          "If the window contains no real user-facing feature, say that in the headline instead of promoting internal work. " +
          "Return ONLY JSON matching the requested shape.",
      },
      {
        role: "user",
        content:
          `Project context (docs, structure, routes, GitHub prose, current source of the most-changed files):\n\n` +
          renderProjectContext(options) +
          `\n\nPer-commit readings from this window (${understandings.length} commits):\n${commitBlock}\n\n` +
          `Return JSON of exactly this shape:\n${DIGEST_SCHEMA}`,
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) throw new Error("Comprehension reduce returned an empty response");
  const parsed = safeParse<Record<string, unknown>>(raw);
  if (!parsed) throw new Error("Comprehension reduce returned unparseable JSON");
  return coerceDigest(parsed, options.meta.repoName);
}

export async function comprehendRepo(options: ComprehendOptions): Promise<ComprehensionResult> {
  const openai = client();
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatchChars = options.maxBatchChars ?? DEFAULT_MAX_BATCH_CHARS;
  const log = options.onLog ?? (() => {});

  // Merge commits carry no patch of their own; their content is already covered
  // by the commits they merge, so reading them adds cost and no information.
  const readable = options.deep.diffs.filter((c) => c.files.length > 0);
  const batches: CommitDiff[][] = [];
  for (let i = 0; i < readable.length; i += batchSize) {
    batches.push(readable.slice(i, i + batchSize));
  }

  log(`comprehend: reading ${readable.length} commits in ${batches.length} batches`);

  const settled = await Promise.allSettled(
    batches.map((batch) => readCommitBatch(openai, batch, maxBatchChars)),
  );

  const commitUnderstandings: CommitUnderstanding[] = [];
  let failedBatches = 0;
  for (const result of settled) {
    if (result.status === "fulfilled") {
      commitUnderstandings.push(...result.value);
    } else {
      failedBatches += 1;
      log(`comprehend: batch failed: ${result.reason}`);
    }
  }
  if (failedBatches === batches.length && batches.length > 0) {
    throw new Error("Every comprehension batch failed");
  }
  log(`comprehend: understood ${commitUnderstandings.length} commits`);

  const digest = await reduceToDigest(openai, commitUnderstandings, options);
  log(
    `comprehend: digest has ${digest.features.length} features, ${digest.fixes.length} fixes, ${digest.infrastructure.length} infra items`,
  );

  return {
    digest,
    commitUnderstandings,
    model: COMPREHEND_MODEL,
    batches: batches.length,
    promptChars: readable.reduce(
      (sum, c) => sum + c.files.reduce((s, f) => s + f.hunks.length, 0),
      0,
    ),
  };
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Models occasionally wrap JSON in a fence despite json_object mode.
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const s = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

const CONFIDENCE = ["high", "medium", "low"] as const;
const AUDIENCE = ["user", "developer", "internal"] as const;
const KINDS = [
  "feature",
  "fix",
  "refactor",
  "docs",
  "infra",
  "test",
  "chore",
  "unclear",
] as const;

function coerceCommitUnderstanding(entry: unknown): CommitUnderstanding | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const sha = str(e.sha);
  if (!sha) return null;
  return {
    sha,
    subject: str(e.subject),
    kind: oneOf(e.kind, KINDS, "unclear"),
    whatChanged: str(e.whatChanged, "(not described)"),
    whyItMatters: str(e.whyItMatters, "(not described)"),
    userVisible: e.userVisible === true,
    surfaces: strArray(e.surfaces, 8),
    confidence: oneOf(e.confidence, CONFIDENCE, "low"),
    evidence: strArray(e.evidence, 8),
  };
}

function coerceChanges(value: unknown, limit = 10): DigestChange[] {
  if (!Array.isArray(value)) return [];
  const out: DigestChange[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const title = str(e.title);
    if (!title) continue;
    out.push({
      title,
      whatChanged: str(e.whatChanged),
      whyItMatters: str(e.whyItMatters),
      audience: oneOf(e.audience, AUDIENCE, "developer"),
      confidence: oneOf(e.confidence, CONFIDENCE, "low"),
      evidence: strArray(e.evidence, 8),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function coerceDigest(parsed: Record<string, unknown>, repoName: string): RepoDigest {
  const project = (parsed.project ?? {}) as Record<string, unknown>;
  const window = (parsed.window ?? {}) as Record<string, unknown>;
  const inProgressRaw = Array.isArray(parsed.inProgress) ? parsed.inProgress : [];
  const numbersRaw = Array.isArray(parsed.notableNumbers) ? parsed.notableNumbers : [];

  return {
    project: {
      name: str(project.name, repoName),
      oneLiner: str(project.oneLiner, `${repoName} (purpose not established by the evidence)`),
      whatItDoes: str(project.whatItDoes),
      whoItIsFor: str(project.whoItIsFor, "unclear from the repository"),
      stack: strArray(project.stack, 12),
      surfaces: strArray(project.surfaces, 12),
    },
    window: {
      headline: str(window.headline, "No single headline change in this window"),
      summary: str(window.summary),
    },
    features: coerceChanges(parsed.features),
    fixes: coerceChanges(parsed.fixes),
    infrastructure: coerceChanges(parsed.infrastructure),
    themes: strArray(parsed.themes, 8),
    inProgress: inProgressRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const e = entry as Record<string, unknown>;
        const title = str(e.title);
        if (!title) return null;
        return { title, signal: str(e.signal) };
      })
      .filter((e): e is { title: string; signal: string } => e !== null)
      .slice(0, 6),
    risks: strArray(parsed.risks, 8),
    unknowns: strArray(parsed.unknowns, 8),
    notableNumbers: numbersRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const e = entry as Record<string, unknown>;
        const label = str(e.label);
        const value = str(e.value);
        if (!label || !value) return null;
        return { label, value, source: str(e.source) };
      })
      .filter((e): e is { label: string; value: string; source: string } => e !== null)
      .slice(0, 8),
  };
}

export function renderDigestMarkdown(result: ComprehensionResult): string {
  const { digest } = result;
  const lines: string[] = [];
  const group = (label: string, changes: DigestChange[]) => {
    if (!changes.length) return;
    lines.push(`## ${label}`);
    for (const c of changes) {
      lines.push("");
      lines.push(`### ${c.title}`);
      lines.push(`- audience: ${c.audience} · confidence: ${c.confidence}`);
      lines.push(`- what changed: ${c.whatChanged}`);
      lines.push(`- why it matters: ${c.whyItMatters}`);
      if (c.evidence.length) lines.push(`- evidence: ${c.evidence.join("; ")}`);
    }
    lines.push("");
  };

  lines.push(`# ${digest.project.name} - comprehension digest`);
  lines.push("");
  lines.push(`_Model: ${result.model} · ${result.batches} commit batches · ${result.commitUnderstandings.length} commits read_`);
  lines.push("");
  lines.push("## Project");
  lines.push(`**${digest.project.oneLiner}**`);
  lines.push("");
  if (digest.project.whatItDoes) lines.push(digest.project.whatItDoes);
  lines.push("");
  lines.push(`- for: ${digest.project.whoItIsFor}`);
  if (digest.project.stack.length) lines.push(`- stack: ${digest.project.stack.join(", ")}`);
  if (digest.project.surfaces.length) lines.push(`- surfaces: ${digest.project.surfaces.join(", ")}`);
  lines.push("");
  lines.push("## This window");
  lines.push(`**${digest.window.headline}**`);
  lines.push("");
  if (digest.window.summary) lines.push(digest.window.summary);
  lines.push("");

  group("Features", digest.features);
  group("Fixes", digest.fixes);
  group("Infrastructure", digest.infrastructure);

  if (digest.themes.length) {
    lines.push("## Themes");
    for (const t of digest.themes) lines.push(`- ${t}`);
    lines.push("");
  }
  if (digest.inProgress.length) {
    lines.push("## In progress");
    for (const item of digest.inProgress) lines.push(`- **${item.title}**: ${item.signal}`);
    lines.push("");
  }
  if (digest.notableNumbers.length) {
    lines.push("## Numbers");
    for (const n of digest.notableNumbers) lines.push(`- ${n.label}: ${n.value} (${n.source})`);
    lines.push("");
  }
  if (digest.risks.length) {
    lines.push("## Risks");
    for (const r of digest.risks) lines.push(`- ${r}`);
    lines.push("");
  }
  if (digest.unknowns.length) {
    lines.push("## Not established by the evidence");
    for (const u of digest.unknowns) lines.push(`- ${u}`);
    lines.push("");
  }

  lines.push("## Per-commit readings");
  for (const c of result.commitUnderstandings) {
    lines.push("");
    lines.push(`### ${c.sha} - ${c.subject}`);
    lines.push(`- kind: ${c.kind} · user-visible: ${c.userVisible} · confidence: ${c.confidence}`);
    lines.push(`- what: ${c.whatChanged}`);
    lines.push(`- why: ${c.whyItMatters}`);
    if (c.surfaces.length) lines.push(`- surfaces: ${c.surfaces.join(", ")}`);
    if (c.evidence.length) lines.push(`- evidence: ${c.evidence.join("; ")}`);
  }

  return lines.join("\n");
}
