import { NextResponse } from "next/server";
import { generateImage, getSource, imagePromptForSource } from "../../../../lib/openai";

export const runtime = "nodejs";

const ALLOWED_KINDS = new Set(["linkedin", "x", "newsletter"]);

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: string };
    const kindRaw = body.kind ?? "linkedin";
    if (!ALLOWED_KINDS.has(kindRaw)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    const kind = kindRaw as "linkedin" | "x" | "newsletter";
    const source = getSource();
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
