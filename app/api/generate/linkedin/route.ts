import { NextResponse } from "next/server";

import { runLinkedInAgent } from "../../../../lib/agents";
import { generateRepoHistory, projectToWeeklySource } from "../../../../lib/repo-history/public";
import type { WeeklySource } from "../../../../lib/weekly-source";

export const runtime = "nodejs";
export const maxDuration = 600;

type Body = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  mood?: string;
  writingSamples?: string[];
};

function requireSource(source: WeeklySource | null): WeeklySource {
  if (!source) {
    throw new Error("repoUrl is required to generate a draft");
  }
  return source;
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const log = (...args: unknown[]) => console.log(`[linkedin ${requestId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[linkedin ${requestId}]`, ...args);
  log("POST /api/generate/linkedin received");
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    log("body parsed", {
      repoUrl: body.repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
      mood: body.mood,
      writingSampleCount: body.writingSamples?.length ?? 0,
    });
    if (!body.repoUrl) {
      log("missing repoUrl, returning 400");
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }
    log("generating repo history…");
    const history = await generateRepoHistory({
      repoUrl: body.repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
    });
    log("repo history ready", {
      phases: history.phases,
      meta: history.meta,
      structureKeys: Object.keys(history.data.structure ?? {}),
      narrativeKeys: Object.keys(history.data.narrative ?? {}),
    });
    const source = requireSource(
      projectToWeeklySource({
        meta: history.meta,
        shape: history.data.shape,
        structure: history.data.structure,
        narrative: history.data.narrative,
      }),
    );
    log("running linkedin agent…");
    const agentStarted = Date.now();
    const { text, screenshots } = await runLinkedInAgent({
      source,
      mood: body.mood,
      writingSamples: body.writingSamples,
    });
    log("linkedin agent finished", {
      durationMs: Date.now() - agentStarted,
      textLength: text.length,
      screenshots: screenshots
        ? {
            repoName: screenshots.repoName,
            repoUrl: screenshots.repoUrl,
            frameCount: screenshots.frames.length,
            routes: screenshots.routes,
            viewports: screenshots.viewports,
            theme: screenshots.theme,
          }
        : null,
    });
    return NextResponse.json({
      kind: "linkedin",
      text,
      source: source.week,
      screenshots: screenshots ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    const name = err instanceof Error ? err.name : undefined;
    logErr("POST /api/generate/linkedin failed", { name, message, stack });
    return NextResponse.json(
      { error: message, requestId, kind: "linkedin" },
      { status: 500 },
    );
  }
}
