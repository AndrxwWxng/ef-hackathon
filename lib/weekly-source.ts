export type Commit = {
  sha: string;
  repo: string;
  author: string;
  message: string;
  date: string;
};

export type PullRequest = {
  number: number;
  repo: string;
  title: string;
  author: string;
  mergedAt: string;
  summary: string;
};

export type VoiceNote = {
  id: string;
  durationSec: number;
  transcript: string;
};

export type FeatureItem = {
  title: string;
  why: string;
  area?: string;
  evidence?: string[];
};

export type WhatChangedBeat = {
  heading: string;
  body: string;
};

/**
 * A change the model actually understood, traced back to the code that proves
 * it. `evidence` entries are `sha path` or `path` strings; the writer is told to
 * trust these over commit subjects, and reviewers can check any claim.
 */
export type DigestChange = {
  title: string;
  whatChanged: string;
  whyItMatters: string;
  audience: "user" | "developer" | "internal";
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

/**
 * The output of reading the repo, as opposed to counting it. Produced by the
 * comprehension pass in lib/repo-history/comprehend.ts.
 */
export type RepoDigest = {
  project: {
    name: string;
    oneLiner: string;
    whatItDoes: string;
    whoItIsFor: string;
    stack: string[];
    surfaces: string[];
  };
  window: {
    headline: string;
    summary: string;
  };
  features: DigestChange[];
  fixes: DigestChange[];
  infrastructure: DigestChange[];
  themes: string[];
  inProgress: Array<{ title: string; signal: string }>;
  risks: string[];
  unknowns: string[];
  notableNumbers: Array<{ label: string; value: string; source: string }>;
};

export type WeeklySource = {
  week: string;
  project: string;
  commits: Commit[];
  pullRequests: PullRequest[];
  voiceNotes: VoiceNote[];
  features?: FeatureItem[];
  whatChanged?: WhatChangedBeat[];
  contributorSummary?: string;
  stackHint?: string;
  repoUrl?: string;
  routes?: string[];
  /**
   * Present when the deep read + comprehension pass ran. When set it is the
   * primary material for a draft; the commit list below it is corroboration.
   */
  digest?: RepoDigest;
  /** Set when comprehension was skipped or failed, so drafts stay honest. */
  digestNote?: string;
};

function renderChangeGroup(label: string, changes: DigestChange[], lines: string[]): void {
  if (changes.length === 0) return;
  lines.push(`${label} (${changes.length}):`);
  for (const change of changes) {
    lines.push(`- ${change.title} [audience: ${change.audience}, confidence: ${change.confidence}]`);
    lines.push(`    what changed: ${change.whatChanged}`);
    lines.push(`    why it matters: ${change.whyItMatters}`);
    if (change.evidence.length > 0) {
      lines.push(`    evidence: ${change.evidence.join("; ")}`);
    }
  }
  lines.push("");
}

function renderDigest(digest: RepoDigest, lines: string[]): void {
  lines.push("## Deep read of the codebase");
  lines.push(
    "(Derived by reading the actual diffs, the current source files, and the repo's own docs. " +
      "Prefer these explanations over the raw commit titles further down.)",
  );
  lines.push("");
  lines.push(`What this project is: ${digest.project.oneLiner}`);
  if (digest.project.whatItDoes) lines.push(`How it works: ${digest.project.whatItDoes}`);
  if (digest.project.whoItIsFor) lines.push(`Who it is for: ${digest.project.whoItIsFor}`);
  if (digest.project.stack.length) lines.push(`Stack: ${digest.project.stack.join(", ")}`);
  if (digest.project.surfaces.length) {
    lines.push(`User-visible surfaces: ${digest.project.surfaces.join(", ")}`);
  }
  lines.push("");
  lines.push(`Headline for this window: ${digest.window.headline}`);
  lines.push(`Window summary: ${digest.window.summary}`);
  lines.push("");

  renderChangeGroup("Features shipped", digest.features, lines);
  renderChangeGroup("Fixes and corrections", digest.fixes, lines);
  renderChangeGroup("Infrastructure and internals", digest.infrastructure, lines);

  if (digest.themes.length) {
    lines.push(`Themes: ${digest.themes.join(", ")}`);
    lines.push("");
  }
  if (digest.inProgress.length) {
    lines.push("In progress / likely next (grounded in unfinished work):");
    for (const item of digest.inProgress) {
      lines.push(`- ${item.title}: ${item.signal}`);
    }
    lines.push("");
  }
  if (digest.notableNumbers.length) {
    lines.push("Concrete numbers you may cite (do not invent others):");
    for (const n of digest.notableNumbers) {
      lines.push(`- ${n.label}: ${n.value} (from ${n.source})`);
    }
    lines.push("");
  }
  if (digest.risks.length) {
    lines.push(`Risks / caveats: ${digest.risks.join("; ")}`);
  }
  if (digest.unknowns.length) {
    lines.push(
      `Not established by the code (do NOT assert these as facts): ${digest.unknowns.join("; ")}`,
    );
  }
  lines.push("");
}

export function summarizeSource(source: WeeklySource): string {
  const lines: string[] = [];
  lines.push(`Week: ${source.week}`);
  lines.push(`Project: ${source.project}`);
  if (source.stackHint) {
    lines.push(`Stack hint: ${source.stackHint}`);
  }
  if (source.repoUrl) {
    lines.push(`App repo: ${source.repoUrl}`);
  }
  if (source.routes && source.routes.length > 0) {
    lines.push(`App routes: ${source.routes.join(", ")}`);
  }
  if (source.contributorSummary) {
    lines.push(`Contributors: ${source.contributorSummary}`);
  }
  lines.push("");

  if (source.digest) {
    renderDigest(source.digest, lines);
    lines.push("## Corroborating raw history");
    lines.push("");
  } else if (source.digestNote) {
    lines.push(`Note: ${source.digestNote}`);
    lines.push("");
  }

  // With a digest present these two blocks are the same material in a weaker
  // form, so they are only rendered when comprehension did not run.
  if (!source.digest && source.features && source.features.length > 0) {
    lines.push(`Features shipped this window (${source.features.length}):`);
    for (const f of source.features) {
      const area = f.area ? ` [${f.area}]` : "";
      lines.push(`- ${f.title}${area}: ${f.why}`);
      if (f.evidence && f.evidence.length > 0) {
        for (const e of f.evidence) lines.push(`    evidence: ${e}`);
      }
    }
    lines.push("");
  }
  if (!source.digest && source.whatChanged && source.whatChanged.length > 0) {
    lines.push(`What changed (plain language):`);
    for (const beat of source.whatChanged) {
      lines.push(`- ${beat.heading}: ${beat.body}`);
    }
    lines.push("");
  }
  lines.push(`Pull requests merged (${source.pullRequests.length}):`);
  for (const pr of source.pullRequests) {
    lines.push(`- #${pr.number} ${pr.title} (${pr.author}) - ${pr.summary}`);
  }
  lines.push("");
  lines.push(`Commits (${source.commits.length}, recent first):`);
  for (const c of source.commits) {
    lines.push(`- ${c.sha} ${c.message} - ${c.author} (${c.date})`);
  }
  if (source.voiceNotes.length) {
    lines.push("");
    lines.push(`Voice notes (${source.voiceNotes.length}):`);
    for (const v of source.voiceNotes) {
      lines.push(`- (${v.durationSec}s) ${v.transcript}`);
    }
  }
  return lines.join("\n");
}
