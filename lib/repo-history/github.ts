/**
 * Optional GitHub enrichment.
 *
 * A clone gives us code and commit messages. It does not give us the prose
 * humans wrote *around* the code: PR descriptions, review discussion, issue
 * titles, release notes, the repo's own one-line description. That prose is
 * usually the clearest statement of intent available, so we pull it when we can.
 *
 * Everything here is best-effort. No token, a private repo, or a rate limit all
 * degrade to `null` fields plus a note in `errors`; nothing throws into the
 * pipeline.
 */

export type GitHubRepoInfo = {
  fullName: string;
  description: string | null;
  homepage: string | null;
  topics: string[];
  language: string | null;
  stars: number;
  openIssues: number;
  defaultBranch: string;
  license: string | null;
  pushedAt: string | null;
};

export type GitHubPullRequest = {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  mergedAt: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  url: string;
};

export type GitHubIssue = {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  closedAt: string | null;
  updatedAt: string;
  url: string;
};

export type GitHubRelease = {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  url: string;
};

export type GitHubContext = {
  owner: string;
  repo: string;
  authenticated: boolean;
  info: GitHubRepoInfo | null;
  pullRequests: GitHubPullRequest[];
  issues: GitHubIssue[];
  releases: GitHubRelease[];
  errors: string[];
};

const API = "https://api.github.com";
const BODY_LIMIT = 2_000;

export function parseGitHubSlug(repoUrl: string): { owner: string; repo: string } | null {
  const cleaned = repoUrl.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  const httpMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/]+)$/i);
  if (httpMatch) return { owner: httpMatch[1], repo: httpMatch[2] };
  const shorthand = cleaned.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };
  return null;
}

function truncate(value: string | null | undefined, limit = BODY_LIMIT): string {
  const text = (value ?? "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n...[truncated]`;
}

function token(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;
}

async function apiGet<T>(pathname: string, timeoutMs: number): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ef-hackathon-repo-history",
  };
  const auth = token();
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${pathname}`, { headers, signal: controller.signal });
    if (!res.ok) {
      const remaining = res.headers.get("x-ratelimit-remaining");
      const hint =
        res.status === 403 && remaining === "0"
          ? " (rate limited; set GITHUB_TOKEN to raise the limit)"
          : res.status === 404
            ? " (not found or private; set GITHUB_TOKEN for private repos)"
            : "";
      throw new Error(`GET ${pathname} -> ${res.status}${hint}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

type RawPull = {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  html_url: string;
  user?: { login?: string };
  labels?: Array<{ name?: string }>;
  additions?: number;
  deletions?: number;
  changed_files?: number;
};

type RawIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  closed_at: string | null;
  updated_at: string;
  html_url: string;
  pull_request?: unknown;
  labels?: Array<{ name?: string } | string>;
};

type RawRelease = {
  tag_name: string;
  name: string | null;
  body: string | null;
  published_at: string | null;
  html_url: string;
  draft?: boolean;
};

export type CollectGitHubOptions = {
  windowFrom: string;
  windowTo: string;
  timeoutMs?: number;
  maxPullRequests?: number;
  maxIssues?: number;
  /** Spend extra API calls to get additions/deletions per PR. */
  enrichPullRequests?: boolean;
};

export async function collectGitHubContext(
  repoUrl: string,
  options: CollectGitHubOptions,
): Promise<GitHubContext | null> {
  const slug = parseGitHubSlug(repoUrl);
  if (!slug) return null;

  const { owner, repo } = slug;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxPulls = options.maxPullRequests ?? 20;
  const maxIssues = options.maxIssues ?? 20;
  const errors: string[] = [];

  const from = new Date(`${options.windowFrom}T00:00:00Z`).getTime();
  const to = new Date(`${options.windowTo}T23:59:59Z`).getTime();
  const inWindow = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isFinite(t) && t >= from && t <= to;
  };

  const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  const infoP = apiGet<{
    full_name: string;
    description: string | null;
    homepage: string | null;
    topics?: string[];
    language: string | null;
    stargazers_count: number;
    open_issues_count: number;
    default_branch: string;
    license?: { spdx_id?: string; name?: string } | null;
    pushed_at: string | null;
  }>(base, timeoutMs)
    .then<GitHubRepoInfo>((raw) => ({
      fullName: raw.full_name,
      description: raw.description,
      homepage: raw.homepage || null,
      topics: raw.topics ?? [],
      language: raw.language,
      stars: raw.stargazers_count,
      openIssues: raw.open_issues_count,
      defaultBranch: raw.default_branch,
      license: raw.license?.spdx_id ?? raw.license?.name ?? null,
      pushedAt: raw.pushed_at,
    }))
    .catch((err) => {
      errors.push(`repo info: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });

  const pullsP = apiGet<RawPull[]>(
    `${base}/pulls?state=closed&sort=updated&direction=desc&per_page=60`,
    timeoutMs,
  )
    .then((raw) =>
      raw
        .filter((pr) => inWindow(pr.merged_at))
        .slice(0, maxPulls)
        .map<GitHubPullRequest>((pr) => ({
          number: pr.number,
          title: pr.title,
          body: truncate(pr.body),
          author: pr.user?.login ?? "unknown",
          labels: (pr.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
          mergedAt: pr.merged_at as string,
          url: pr.html_url,
        })),
    )
    .catch((err) => {
      errors.push(`pull requests: ${err instanceof Error ? err.message : String(err)}`);
      return [] as GitHubPullRequest[];
    });

  const issuesP = apiGet<RawIssue[]>(
    `${base}/issues?state=all&since=${options.windowFrom}T00:00:00Z&sort=updated&direction=desc&per_page=60`,
    timeoutMs,
  )
    .then((raw) =>
      raw
        // The issues endpoint returns PRs too; they are covered separately.
        .filter((issue) => !issue.pull_request)
        .slice(0, maxIssues)
        .map<GitHubIssue>((issue) => ({
          number: issue.number,
          title: issue.title,
          body: truncate(issue.body, 800),
          state: issue.state,
          labels: (issue.labels ?? [])
            .map((l) => (typeof l === "string" ? l : l.name ?? ""))
            .filter(Boolean),
          closedAt: issue.closed_at,
          updatedAt: issue.updated_at,
          url: issue.html_url,
        })),
    )
    .catch((err) => {
      errors.push(`issues: ${err instanceof Error ? err.message : String(err)}`);
      return [] as GitHubIssue[];
    });

  const releasesP = apiGet<RawRelease[]>(`${base}/releases?per_page=20`, timeoutMs)
    .then((raw) =>
      raw
        .filter((r) => !r.draft && inWindow(r.published_at))
        .map<GitHubRelease>((r) => ({
          tag: r.tag_name,
          name: r.name ?? r.tag_name,
          body: truncate(r.body),
          publishedAt: r.published_at as string,
          url: r.html_url,
        })),
    )
    .catch((err) => {
      errors.push(`releases: ${err instanceof Error ? err.message : String(err)}`);
      return [] as GitHubRelease[];
    });

  const [info, pullRequests, issues, releases] = await Promise.all([
    infoP,
    pullsP,
    issuesP,
    releasesP,
  ]);

  if (options.enrichPullRequests && pullRequests.length > 0) {
    await Promise.all(
      pullRequests.slice(0, 10).map(async (pr) => {
        try {
          const detail = await apiGet<RawPull>(`${base}/pulls/${pr.number}`, timeoutMs);
          pr.additions = detail.additions;
          pr.deletions = detail.deletions;
          pr.changedFiles = detail.changed_files;
        } catch {
          // Detail is a nice-to-have; the PR itself is already useful.
        }
      }),
    );
  }

  return {
    owner,
    repo,
    authenticated: Boolean(token()),
    info,
    pullRequests,
    issues,
    releases,
    errors,
  };
}

export function renderGitHubContext(ctx: GitHubContext | null): string {
  if (!ctx) return "=== github ===\n(not a GitHub URL; skipped)";
  const lines: string[] = [];
  lines.push("=== github ===");
  lines.push(`repo: ${ctx.owner}/${ctx.repo} (authenticated: ${ctx.authenticated})`);
  if (ctx.info) {
    lines.push(`description: ${ctx.info.description ?? "(none)"}`);
    lines.push(`homepage: ${ctx.info.homepage ?? "(none)"}`);
    lines.push(`topics: ${ctx.info.topics.join(", ") || "(none)"}`);
    lines.push(`primary language: ${ctx.info.language ?? "(unknown)"}`);
    lines.push(`stars: ${ctx.info.stars} · open issues: ${ctx.info.openIssues}`);
  }
  lines.push("");

  lines.push(`--- merged pull requests in window (${ctx.pullRequests.length}) ---`);
  if (ctx.pullRequests.length === 0) lines.push("(none)");
  for (const pr of ctx.pullRequests) {
    lines.push("");
    lines.push(`#${pr.number} ${pr.title} — ${pr.author}, merged ${pr.mergedAt}`);
    if (pr.labels.length) lines.push(`labels: ${pr.labels.join(", ")}`);
    if (pr.changedFiles !== undefined) {
      lines.push(`size: +${pr.additions ?? 0}/-${pr.deletions ?? 0} across ${pr.changedFiles} files`);
    }
    if (pr.body) lines.push(pr.body);
  }
  lines.push("");

  lines.push(`--- issues touched in window (${ctx.issues.length}) ---`);
  if (ctx.issues.length === 0) lines.push("(none)");
  for (const issue of ctx.issues) {
    lines.push(
      `#${issue.number} [${issue.state}] ${issue.title}${issue.labels.length ? ` (${issue.labels.join(", ")})` : ""}`,
    );
    if (issue.body) lines.push(`  ${issue.body.split("\n").slice(0, 6).join("\n  ")}`);
  }
  lines.push("");

  lines.push(`--- releases in window (${ctx.releases.length}) ---`);
  if (ctx.releases.length === 0) lines.push("(none)");
  for (const rel of ctx.releases) {
    lines.push(`${rel.tag} ${rel.name} (${rel.publishedAt})`);
    if (rel.body) lines.push(rel.body);
  }

  if (ctx.errors.length) {
    lines.push("");
    lines.push("--- github fetch notes ---");
    for (const err of ctx.errors) lines.push(`! ${err}`);
  }

  return lines.join("\n");
}
