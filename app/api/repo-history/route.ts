import fs from "node:fs/promises";

import { NextResponse } from "next/server";

import { generateRepoHistory, RepoHistoryError } from "@/lib/repo-history/public";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RequestBody = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  outDir?: string;
  includeAnalysis?: boolean;
};

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const repoUrl = body.repoUrl?.trim();
  if (!repoUrl) {
    return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(repoUrl) && !/^[\w.-]+@/.test(repoUrl)) {
    return NextResponse.json(
      { error: "repoUrl must be an http(s) URL or an SSH-style git URL" },
      { status: 400 },
    );
  }

  try {
    const result = await generateRepoHistory({
      repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
      outDir: body.outDir,
    });

    const includeAnalysis = body.includeAnalysis ?? true;
    const analysis = includeAnalysis
      ? await fs.readFile(result.artifacts.analysis, "utf8").catch(() => "")
      : "";

    return NextResponse.json({
      meta: result.meta,
      artifacts: result.artifacts,
      phases: result.phases,
      analysis,
      logCount: result.logs.length,
    });
  } catch (error) {
    if (error instanceof RepoHistoryError) {
      return NextResponse.json(
        {
          error: error.message,
          stage: error.stage,
          logs: error.logs.slice(-50),
        },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    description:
      "POST { repoUrl, branch?, windowDays?, windowAnchor?, outDir?, includeAnalysis? } to run the repo-history playbook.",
    defaults: {
      windowDays: 7,
      windowAnchor: "last-commit",
      includeAnalysis: true,
    },
  });
}