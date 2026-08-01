import { NextResponse } from "next/server";
import { generateTextDraft, getSource } from "../../../../lib/openai";

export const runtime = "nodejs";

export async function POST() {
  try {
    const source = getSource();
    const text = await generateTextDraft("newsletter", source);
    return NextResponse.json({ kind: "newsletter", text, source: source.week });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
