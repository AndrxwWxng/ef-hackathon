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
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.repoUrl) {
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }
    const history = await generateRepoHistory({
      repoUrl: body.repoUrl,
      branch: body.branch,
      windowDays: body.windowDays,
      windowAnchor: body.windowAnchor,
    });
    const source = requireSource(
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
    const { text, screenshots } = await runLinkedInAgent({
      source,
      mood: body.mood,
      writingSamples: body.writingSamples,
    });
    return NextResponse.json({
      kind: "linkedin",
      text,
      source: source.week,
      screenshots: screenshots ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
