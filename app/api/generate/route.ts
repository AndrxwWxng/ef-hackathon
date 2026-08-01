import { NextResponse } from "next/server";
import { generateAll, getSource } from "../../../lib/openai";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      mood?: string;
      writingSamples?: string[];
    };
    const source = getSource();
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
