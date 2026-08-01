import { NextResponse } from "next/server";
import { generateImage, imagePromptForSource } from "../../../../lib/openai";
import { generateRepoHistory, projectToWeeklySource } from "../../../../lib/repo-history/public";
import type { WeeklySource } from "../../../../lib/weekly-source";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["linkedin", "x", "newsletter"]);

type Body = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  kind?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const kindRaw = body.kind ?? "linkedin";
    if (!ALLOWED_KINDS.has(kindRaw)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!body.repoUrl) {
      return NextResponse.json({ error: "repoUrl is required" }, { status: 400 });
    }
    const kind = kindRaw as "linkedin" | "x" | "newsletter";
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
    const prompt = imagePromptForSource(source, kind);
    const image = await generateImage(prompt);
    return NextResponse.json({
      kind,
      mimeType: "image/png",
      data: image.base64,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
