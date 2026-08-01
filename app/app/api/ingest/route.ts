import { NextResponse } from "next/server";

import { ingestSource, type IngestInput } from "@/lib/multimodal";
import { addSource, summarizeForStorage } from "@/lib/multimodal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 96 * 1024 * 1024;

type IngestBody =
  | { kind: "text"; label?: string; text: string; origin?: string }
  | { kind: "audio"; label?: string; dataUrl?: string; fileName?: string; origin?: string }
  | { kind: "video"; label?: string; dataUrl?: string; fileName?: string; origin?: string };

function decodeDataUrl(dataUrl: string): { buffer: Buffer; mimeType: string; fileName?: string } {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("dataUrl must be `data:<mime>;base64,<payload>`");
  const [, mimeType, payload] = match;
  const buffer = Buffer.from(payload, "base64");
  return { buffer, mimeType, fileName: undefined };
}

function ensureBufferSize(buffer: Buffer, kind: "text" | "audio" | "video") {
  const max = kind === "text" ? MAX_TEXT_BYTES : MAX_MEDIA_BYTES;
  if (buffer.byteLength > max) {
    throw new Error(`${kind} payload is ${(buffer.byteLength / 1024).toFixed(0)} KB; max is ${(max / 1024).toFixed(0)} KB`);
  }
}

export async function POST(req: Request) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch (err) {
    return NextResponse.json({ error: `invalid JSON body: ${err instanceof Error ? err.message : String(err)}` }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("kind" in body)) {
    return NextResponse.json({ error: "body must include `kind`" }, { status: 400 });
  }

  let input: IngestInput;
  try {
    if (body.kind === "text") {
      if (typeof body.text !== "string" || !body.text.trim()) {
        return NextResponse.json({ error: "text ingest needs non-empty `text`" }, { status: 400 });
      }
      ensureBufferSize(Buffer.from(body.text, "utf8"), "text");
      input = {
        modality: "text",
        label: body.label?.trim() || "Pasted note",
        text: body.text,
        origin: body.origin,
      };
    } else if (body.kind === "audio") {
      if (!body.dataUrl) {
        return NextResponse.json({ error: "audio ingest needs `dataUrl`" }, { status: 400 });
      }
      const decoded = decodeDataUrl(body.dataUrl);
      ensureBufferSize(decoded.buffer, "audio");
      input = {
        modality: "audio",
        label: body.label?.trim() || body.fileName || "Voice note",
        buffer: decoded.buffer,
        mimeType: decoded.mimeType,
        fileName: body.fileName,
        origin: body.origin,
      };
    } else if (body.kind === "video") {
      if (!body.dataUrl) {
        return NextResponse.json({ error: "video ingest needs `dataUrl`" }, { status: 400 });
      }
      const decoded = decodeDataUrl(body.dataUrl);
      ensureBufferSize(decoded.buffer, "video");
      input = {
        modality: "video",
        label: body.label?.trim() || body.fileName || "Video clip",
        buffer: decoded.buffer,
        mimeType: decoded.mimeType,
        fileName: body.fileName,
        origin: body.origin,
      };
    } else {
      return NextResponse.json({ error: `unknown kind: ${(body as { kind?: string }).kind}` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  try {
    const result = await ingestSource(input, {
      onLog: () => undefined,
      onStep: () => undefined,
    });
    const stored = await addSource(summarizeForStorage(result));
    return NextResponse.json({ result, sources: stored }, { status: 200 });
  } catch (err) {
    const stage = (err as { stage?: string })?.stage;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, stage }, { status: 422 });
  }
}

export async function GET() {
  return NextResponse.json({
    name: "multimail / api / ingest",
    methods: ["POST"],
    kinds: ["text", "audio", "video"],
    note: "Audio/video uses OpenAI Whisper when OPENAI_API_KEY is set; otherwise it falls back to a deterministic local mock so the pipeline shape stays the same.",
  });
}