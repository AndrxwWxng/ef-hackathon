import { NextResponse } from "next/server";

import { runAllTargets, type DraftRunResult } from "../../../../lib/agents";
import { generateRepoHistory, projectToWeeklySource } from "../../../../lib/repo-history/public";
import type { WeeklySource } from "../../../../lib/weekly-source";

export const runtime = "nodejs";
export const maxDuration = 600;

type Target = "newsletter" | "linkedin" | "x";

type Body = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  mood?: string;
  writingSamples?: string[];
  targets?: Target[];
};

const ALLOWED_TARGETS: Target[] = ["newsletter", "linkedin", "x"];

function ensureSource(source: WeeklySource | null): WeeklySource {
  if (!source) {
    throw new Error("repoUrl is required to generate drafts");
  }
  return source;
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const log = (...args: unknown[]) => console.log(`[all ${requestId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[all ${requestId}]`, ...args);
  log("POST /api/generate/all received");
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    log("body parsed", {
      repoUrl: body.repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
      mood: body.mood,
      writingSampleCount: body.writingSamples?.length ?? 0,
      targets: body.targets,
    });
    if (!body.repoUrl) {
      log("missing repoUrl, returning 400");
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }
    const targets = (body.targets?.length ? body.targets : ALLOWED_TARGETS).filter(
      (t): t is Target => (ALLOWED_TARGETS as string[]).includes(t),
    );
    if (targets.length === 0) {
      return NextResponse.json(
        { error: "Pick at least one artifact to generate." },
        { status: 400 },
      );
    }

    log("generating repo history (once, shared across targets)…");
    const history = await generateRepoHistory({
      repoUrl: body.repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
    });
    log("repo history ready", {
      phases: history.phases,
      meta: history.meta,
    });
    const source = ensureSource(
      projectToWeeklySource({
        meta: history.meta,
        shape: history.data.shape,
        structure: history.data.structure,
        narrative: history.data.narrative,
        deep: history.data.deep,
        github: history.data.github,
        comprehension: history.data.comprehension,
      }),
    );

    log("running all targets", {
      targets,
      appRepoScreenshottable: source.repoUrl ?? null,
    });
    const agentStarted = Date.now();
    const { drafts, screenshot, video } = await runAllTargets({
      source,
      targets,
      mood: body.mood,
      writingSamples: body.writingSamples,
    });
    log("all targets finished", {
      durationMs: Date.now() - agentStarted,
      drafted: Object.keys(drafts),
      screenshot: screenshot
        ? {
          repoName: screenshot.repoName,
          frameCount: screenshot.frames.length,
          routes: screenshot.routes,
        }
        : null,
      video: video
        ? {
          repoName: video.repoName,
          outputPath: video.outputPath,
          durationMs: video.durationMs,
        }
        : null,
    });

    return NextResponse.json({
      kind: "all",
      source: source.week,
      drafts: Object.fromEntries(
        Object.entries(drafts).map(([k, v]) => [k, serializeDraft(k, v as DraftRunResult)]),
      ),
      screenshot: screenshot ?? undefined,
      video: video ?? undefined,
      grounding: {
        commitsRead: history.data.comprehension?.commitUnderstandings.length ?? 0,
        deepRead: history.data.deep !== null,
        github: history.data.github !== null,
        warnings: history.warnings,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    const name = err instanceof Error ? err.name : undefined;
    logErr("POST /api/generate/all failed", { name, message, stack });
    return NextResponse.json(
      { error: message, requestId, kind: "all" },
      { status: 500 },
    );
  }
}

function serializeDraft(kind: string, draft: DraftRunResult) {
  return {
    kind,
    text: draft.text,
    screenshots: draft.screenshots ?? undefined,
    video: draft.video ?? undefined,
  };
}
