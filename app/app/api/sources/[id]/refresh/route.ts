import { NextResponse } from "next/server";

import { ingestSource, type IngestInput } from "@/lib/multimodal";
import {
  addSource,
  getCredential,
  listSources,
  saveCredential,
  summarizeForStorage,
} from "@/lib/multimodal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RefreshBody = {
  token?: string;
  limit?: number;
  label?: string;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  let body: RefreshBody = {};
  try {
    body = (await req.json().catch(() => ({}))) as RefreshBody;
  } catch {
    body = {};
  }

  const [sources, credential] = await Promise.all([listSources(), getCredential(id)]);
  const source = sources.find((item) => item.id === id);
  if (!source || !source.connector) {
    return NextResponse.json(
      { error: "source is not a connector. Nothing to refresh." },
      { status: 404 },
    );
  }
  if (!credential) {
    return NextResponse.json(
      { error: "no saved credentials for this source. Reconnect to set a new token." },
      { status: 404 },
    );
  }

  const channelId = source.connector.channelId;
  if (!channelId) {
    return NextResponse.json(
      { error: "source is missing channel id. Reconnect to set it." },
      { status: 422 },
    );
  }

  const token = body.token?.trim() || credential.token;
  if (body.token?.trim()) {
    await saveCredential({
      sourceId: id,
      kind: credential.kind,
      token,
      workspace: credential.workspace,
    });
  }

  let input: IngestInput;
  if (credential.kind === "discord") {
    input = {
      modality: "discord",
      label: body.label?.trim() || source.label,
      token,
      channelId,
      limit: clampLimit(body.limit),
      origin: channelId,
    };
  } else {
    input = {
      modality: "slack",
      label: body.label?.trim() || source.label,
      token,
      channelId,
      workspace: credential.workspace,
      limit: clampLimit(body.limit),
      origin: channelId,
    };
  }

  try {
    const result = await ingestSource(input, { onLog: () => undefined, onStep: () => undefined });
    result.id = id;
    result.source.id = id;
    const stored = await addSource(summarizeForStorage(result));
    return NextResponse.json({ result, sources: stored });
  } catch (err) {
    const stage = (err as { stage?: string })?.stage;
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, stage }, { status: 422 });
  }
}

function clampLimit(value?: number): number {
  if (!value || Number.isNaN(value)) return 50;
  return Math.max(1, Math.min(200, Math.floor(value)));
}
