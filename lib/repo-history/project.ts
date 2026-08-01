import type { Phase1Shape } from "./phase1";
import type { Phase2Structure } from "./phase2";
import type { Phase3Narrative } from "./phase3";
import type { CommitEntry } from "./phase3";
import type { RepoHistoryMeta } from "./types";
import type {
  Commit,
  FeatureItem,
  PullRequest,
  WhatChangedBeat,
  WeeklySource,
} from "../weekly-source";

export type { FeatureItem, WhatChangedBeat };
export type ProjectedSource = WeeklySource;

const MERGE_SUBJECT_RE = /^Merge(?:\s|pull\srequest\s|pull\s|pull\srequest\s)?#?(\d+)?/i;

function repoShortName(repoUrl: string): string {
  const cleaned = repoUrl.replace(/\.git$/i, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? cleaned;
}

function cleanSubject(subject: string): string {
  return subject.replace(/^\s*[\w/-]+(?:\([^)]+\))?:\s*/, "").trim();
}

function inferArea(filePath: string): string {
  if (!filePath) return "general";
  const segments = filePath.split("/").filter(Boolean);
  if (segments.length <= 1) return "root";
  if (segments[0] === "app" && segments[1] === "api") return "api";
  if (segments[0] === "app" && (segments[1] === "app" || segments[1] === "page.tsx")) return "ui";
  if (segments[0] === "lib") return segments[1] ?? "lib";
  if (segments[0] === "multipost") return "multipost";
  return segments[0];
}

function aggregateAreas(numstatPaths: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of numstatPaths) {
    const area = inferArea(p);
    counts[area] = (counts[area] ?? 0) + 1;
  }
  return counts;
}

function buildFeatureFromCommit(commit: CommitEntry): FeatureItem | null {
  const subject = cleanSubject(commit.subject);
  if (!subject) return null;
  const isMerge = MERGE_SUBJECT_RE.test(commit.subject);
  if (isMerge) return null;
  const isNoise =
    /^(merge|wip|init|intermediate|update|updates|tmp|cleanup|test bump|bump)\b/i.test(
      commit.subject,
    ) && commit.numstat.length <= 1;
  if (isNoise) return null;

  const featureWords =
    /\b(add|added|adds|implement|ship|launch|introduce|integrat|support|enable|new)\b/i;
  const isFeature =
    featureWords.test(commit.subject) ||
    /^(feat|feature)\b/i.test(commit.subject) ||
    (commit.numstat.length > 0 &&
      !/^(fix|chore|docs|test|build|ci|refactor|style|perf)\b/i.test(commit.subject) &&
      commit.numstat.some((r) => (r.added ?? 0) > 20));

  if (!isFeature) return null;

  const area =
    commit.numstat.length > 0
      ? inferArea(commit.numstat[0].path)
      : "general";

  const why = buildWhy(commit, subject, area);
  const evidence =
    commit.numstat.length > 0
      ? commit.numstat
          .slice(0, 4)
          .map((r) => `${r.path} (+${r.added ?? 0}/-${r.deleted ?? 0})`)
      : undefined;

  return {
    title: toTitleCase(subject),
    why,
    area,
    evidence,
  };
}

function buildWhy(commit: CommitEntry, subject: string, area: string): string {
  const audienceFrame = (s: string): string => {
    if (/integrat|integrations?\b/i.test(s)) {
      return `Brings ${matchGroup(s, /(\w[\w-]*\b)/) ?? "a new"} source into the product so users can pull content from where they already work.`;
    }
    if (/\bui\b|layout|landing|page|styling|design|preview|render/i.test(s)) {
      return `Improves how the app looks and feels for the people using it - ${area} work that lands the message faster.`;
    }
    if (/screenshot|sandbox|shot|capture/i.test(s)) {
      return `Lets the team see the actual output of the product, not just the code, so reviews stop being guesswork.`;
    }
    if (/\bhistory|repo|git\b|pull\b/i.test(s)) {
      return `Lets the team ingest a real codebase and turn it into a weekly update without manual copy-paste.`;
    }
    if (/\bimage|tool|agent|sdk\b/i.test(s)) {
      return `Expands what the assistant can do so it produces richer, more visual drafts without hand-holding.`;
    }
    return `Real, user-visible progress in ${area}: ${subject.toLowerCase()}.`;
  };

  return audienceFrame(subject);
}

function matchGroup(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  return m?.[1];
}

function toTitleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w[0]?.toUpperCase() + w.slice(1) : w.toLowerCase(),
    )
    .join(" ")
    .replace(/[.!?]+$/, "");
}

function dedupeFeatures(items: FeatureItem[]): FeatureItem[] {
  const seen = new Set<string>();
  const out: FeatureItem[] = [];
  for (const f of items) {
    const key = f.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function extractPRNumber(subject: string, body: string): number | undefined {
  const m1 = subject.match(/(?:#|pull request #)(\d+)/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = body.match(/pull\s*request\s*#?(\d+)/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = subject.match(/\(#(\d+)\)/);
  if (m3) return parseInt(m3[1], 10);
  return undefined;
}

function buildPullRequests(
  commits: CommitEntry[],
  meta: RepoHistoryMeta,
): PullRequest[] {
  const seen = new Set<number>();
  const out: PullRequest[] = [];
  for (const c of commits) {
    const num = extractPRNumber(c.subject, c.body);
    if (num === undefined || seen.has(num)) continue;
    seen.add(num);
    if (!MERGE_SUBJECT_RE.test(c.subject)) continue;
    out.push({
      number: num,
      repo: repoShortName(meta.repoUrl),
      title: cleanSubject(c.subject) || `PR #${num}`,
      author: c.author,
      mergedAt: c.date,
      summary: c.body ? c.body.split(/\r?\n/)[0] : `Merged via ${c.sha}`,
    });
  }
  return out.sort((a, b) => a.mergedAt.localeCompare(b.mergedAt));
}

function buildCommits(commits: CommitEntry[], meta: RepoHistoryMeta): Commit[] {
  return commits.map((c) => ({
    sha: c.sha,
    repo: repoShortName(meta.repoUrl),
    author: c.author,
    message: c.subject,
    date: c.date,
  }));
}

function buildFeatures(
  commits: CommitEntry[],
): FeatureItem[] {
  const fromCommits = commits
    .map(buildFeatureFromCommit)
    .filter((f): f is FeatureItem => f !== null);
  return dedupeFeatures(fromCommits).slice(0, 12);
}

function buildContributorSummary(shape: Phase1Shape): string {
  if (shape.contributors.length === 0) return "";
  const top = [...shape.contributors]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)
    .map((c) => `${c.name} (${c.count})`);
  return top.join(", ");
}

function buildStackHint(structure: Phase2Structure): string | undefined {
  const hints: string[] = [];
  const flat = (structure.treeDepth2 ?? []).join(" ").toLowerCase();
  const manifest = (structure.manifestsPresent ?? []).join(" ").toLowerCase();
  const blob = `${flat} ${manifest}`;
  if (blob.includes("next.config") || manifest.includes("next")) hints.push("Next.js");
  if (manifest.includes("react")) hints.push("React");
  if (manifest.includes("openai") || /openai/i.test(flat)) hints.push("OpenAI SDK");
  if (blob.includes("tailwind")) hints.push("Tailwind");
  if (blob.includes("prisma")) hints.push("Prisma");
  if (blob.includes("supabase")) hints.push("Supabase");
  return hints.length > 0 ? hints.join(", ") : undefined;
}

function buildWhatChanged(
  features: FeatureItem[],
  shape: Phase1Shape,
): WhatChangedBeat[] {
  const beats: WhatChangedBeat[] = [];
  const areaCounts = aggregateAreas(shape.churn.map((c) => c.path));
  const topArea = Object.entries(areaCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  if (features.length > 0) {
    const headline = features[0];
    beats.push({
      heading: "What we shipped",
      body: `${headline.title}. ${headline.why} ${
        features.length > 1
          ? `Across the week we also landed ${features.length - 1} more user-visible improvements.`
          : ""
      }`.trim(),
    });
  }

  if (topArea) {
    beats.push({
      heading: "Where the work happened",
      body: `Most of the activity landed in ${topArea}, which is where users see the product or where the team's automation runs.`,
    });
  }

  if (shape.contributors.length > 1) {
    beats.push({
      heading: "Who did the work",
      body: `${shape.contributors.length} people contributed this window. ${buildContributorSummary(shape)}.`,
    });
  } else if (shape.contributors.length === 1) {
    const only = shape.contributors[0];
    beats.push({
      heading: "Who did the work",
      body: `${only.name} carried the window solo this time.`,
    });
  }

  beats.push({
    heading: "What this means for partners",
    body: features.length > 0
      ? `The product is moving in the direction of being self-updating: more sources, more channels, less manual polish. Expect the next update to lean into multi-channel previews.`
      : `Quiet window in the diff, but the scaffolding for richer ingestion is in place. Next update should show a real feature landing.`,
  });

  return beats;
}

export function projectToWeeklySource(args: {
  meta: RepoHistoryMeta;
  shape: Phase1Shape;
  structure: Phase2Structure;
  narrative: Phase3Narrative;
}): WeeklySource {
  const { meta, shape, structure, narrative } = args;
  const features = buildFeatures(narrative.commits);
  const whatChanged = buildWhatChanged(features, shape);
  const pullRequests = buildPullRequests(narrative.commits, meta);
  const commits = buildCommits(narrative.commits, meta);
  const stackHint = buildStackHint(structure);

  return {
    week: `${meta.windowFrom} -> ${meta.windowTo}`,
    project: meta.repoName,
    commits,
    pullRequests,
    voiceNotes: [],
    features,
    whatChanged,
    contributorSummary: buildContributorSummary(shape),
    stackHint,
    repoUrl: meta.repoUrl,
    routes: structure.manifestsPresent,
  };
}