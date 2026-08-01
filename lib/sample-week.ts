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

export type WeeklySource = {
  week: string;
  project: string;
  commits: Commit[];
  pullRequests: PullRequest[];
  voiceNotes: VoiceNote[];
};

export const SAMPLE_WEEK: WeeklySource = {
  week: "Week 32 · Aug 4 – Aug 10",
  project: "Polar Relay (internal)",
  commits: [
    {
      sha: "a1f3c92",
      repo: "polar-relay/ingest",
      author: "M. Kapoor",
      message: "feat(ingest): batch webhooks into 250ms windows",
      date: "2026-08-04",
    },
    {
      sha: "b27de01",
      repo: "polar-relay/ingest",
      author: "M. Kapoor",
      message: "perf(ingest): drop redundant JSON parse on retry path",
      date: "2026-08-05",
    },
    {
      sha: "c83a44d",
      repo: "polar-relay/api",
      author: "J. Okafor",
      message: "fix(api): correct pagination cursor on /events tail",
      date: "2026-08-05",
    },
    {
      sha: "d9e1f7b",
      repo: "polar-relay/web",
      author: "R. Tanaka",
      message: "chore(web): quiet the empty-state on the digest inbox",
      date: "2026-08-06",
    },
    {
      sha: "e5b22c8",
      repo: "polar-relay/integrations",
      author: "S. Reyes",
      message: "fix(slack): retry on 429 with jittered backoff",
      date: "2026-08-07",
    },
    {
      sha: "f01c9a3",
      repo: "polar-relay/integrations",
      author: "S. Reyes",
      message: "fix(email): avoid double-send when webhook arrives twice",
      date: "2026-08-08",
    },
    {
      sha: "0aa71b4",
      repo: "polar-relay/api",
      author: "J. Okafor",
      message: "feat(api): add idempotency keys to POST /events",
      date: "2026-08-08",
    },
    {
      sha: "12bd39e",
      repo: "polar-relay/web",
      author: "R. Tanaka",
      message: "feat(web): mobile-first digest view, breakpoints at 480/768",
      date: "2026-08-09",
    },
    {
      sha: "3cf4e58",
      repo: "polar-relay/ops",
      author: "M. Kapoor",
      message: "chore(ops): switch staging to the new ingest path behind a flag",
      date: "2026-08-09",
    },
    {
      sha: "4e62a01",
      repo: "polar-relay/docs",
      author: "R. Tanaka",
      message: "docs: rewrite the changelog page so it reads like a digest",
      date: "2026-08-10",
    },
  ],
  pullRequests: [
    {
      number: 482,
      repo: "polar-relay/ingest",
      title: "Batch incoming webhooks into 250ms windows",
      author: "M. Kapoor",
      mergedAt: "2026-08-05",
      summary:
        "Collapses bursts of inbound webhooks into short windows before they hit the queue. Cuts write amplification by about 4x under load tests.",
    },
    {
      number: 487,
      repo: "polar-relay/integrations",
      title: "Slack delivery: jittered backoff + idempotency keys",
      author: "S. Reyes",
      mergedAt: "2026-08-08",
      summary:
        "Two long-standing partner complaints addressed together. Slack no longer double-posts on retries and rate-limit responses are handled cleanly.",
    },
    {
      number: 491,
      repo: "polar-relay/api",
      title: "POST /events accepts idempotency keys",
      author: "J. Okafor",
      mergedAt: "2026-08-08",
      summary:
        "Lets senders safely retry on network failures without creating duplicate events. Documented in the public API reference.",
    },
    {
      number: 493,
      repo: "polar-relay/web",
      title: "Mobile-first digest inbox view",
      author: "R. Tanaka",
      mergedAt: "2026-08-09",
      summary:
        "Re-laid the digest inbox for narrow screens. Read-time on a 375px viewport dropped from 6.2s to 2.4s in the Lighthouse mobile run.",
    },
  ],
  voiceNotes: [
    {
      id: "vn-001",
      durationSec: 64,
      transcript:
        "Quick note: the Slack double-post is fixed, and the new ingest path is on in staging. We should mention both to the partners on Friday. Also the digest inbox finally feels calm on mobile.",
    },
    {
      id: "vn-002",
      durationSec: 48,
      transcript:
        "Reminder to self: don't bury the idempotency-key feature in the changelog. Sponsors have been asking for it quietly for a quarter.",
    },
  ],
};

export function summarizeSource(source: WeeklySource): string {
  const lines: string[] = [];
  lines.push(`Week: ${source.week}`);
  lines.push(`Project: ${source.project}`);
  lines.push("");
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
