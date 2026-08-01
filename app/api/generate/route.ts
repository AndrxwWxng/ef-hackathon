import { NextResponse } from "next/server";
import { generateAll } from "../../../lib/openai";
import { generateRepoHistory, projectToWeeklySource } from "../../../lib/repo-history/public";
import type { WeeklySource } from "../../../lib/weekly-source";

export const runtime = "nodejs";

type Body = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  mood?: string;
  writingSamples?: string[];
};

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
    const source: WeeklySource = projectToWeeklySource({
      meta: history.meta,
      shape: history.data.shape,
      structure: history.data.structure,
      narrative: history.data.narrative,
    });
    const result = await generateAll({
      source,
      mood: body.mood,
      writingSamples: body.writingSamples,
    });
    return NextResponse.json({
      source: source.week,
      newsletter: result.newsletter,
      linkedin: result.linkedin,
      x: result.x,
      linkedinImage: result.linkedinImage
        ? { mimeType: "image/png", data: result.linkedinImage.base64 }
        : undefined,
      xImage: result.xImage
        ? { mimeType: "image/png", data: result.xImage.base64 }
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
