import { NextResponse } from "next/server";

import { parseGitHubSlug } from "@/lib/repo-history/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RawRepo = { created_at: string };

async function fetchCreatedAt(owner: string, repo: string, timeoutMs = 10_000): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ef-hackathon-app",
  };
  const auth = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (auth) headers.Authorization = `Bearer ${auth}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
      { headers, signal: controller.signal, cache: "no-store" },
    );
    if (!res.ok) {
      throw new Error(`GitHub responded ${res.status}`);
    }
    const json = (await res.json()) as RawRepo;
    if (!json.created_at) throw new Error("GitHub response missing created_at");
    return json.created_at;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const repoUrl = url.searchParams.get("repoUrl");
  if (!repoUrl) {
    return NextResponse.json({ error: "missing repoUrl" }, { status: 400 });
  }
  const slug = parseGitHubSlug(repoUrl);
  if (!slug) {
    return NextResponse.json({ error: "not a GitHub URL" }, { status: 400 });
  }
  try {
    const createdAt = await fetchCreatedAt(slug.owner, slug.repo);
    return NextResponse.json(
      { owner: slug.owner, repo: slug.repo, createdAt },
      { headers: { "Cache-Control": "public, max-age=3600" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
