import { NextRequest, NextResponse } from "next/server";
import { generateTextDraft, getSource, type DraftRequest } from "../../../../lib/openai";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mood?: string;
      writingSamples?: string[];
    };
    const source = getSource();
    const text = await generateTextDraft({
      kind: "x",
      source,
      mood: body.mood,
      writingSamples: body.writingSamples,
    } satisfies DraftRequest);
    return NextResponse.json({ kind: "x", text, source: source.week });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
