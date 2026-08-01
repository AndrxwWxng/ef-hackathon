import { NextResponse } from "next/server";

import { runLinkedInAgent } from "../../../../lib/agents";
import { getSource } from "../../../../lib/openai";

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mood?: string;
      writingSamples?: string[];
    };
    const source = getSource();
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
