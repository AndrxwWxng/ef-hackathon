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
};

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
  if (source.contributorSummary) {
    lines.push(`Contributors: ${source.contributorSummary}`);
  }
  lines.push("");
  if (source.features && source.features.length > 0) {
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
  if (source.whatChanged && source.whatChanged.length > 0) {
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
