import { NextResponse } from "next/server";

import { listSources, removeSource } from "@/lib/multimodal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const sources = await removeSource(id);
  return NextResponse.json({ sources });
}

export async function GET() {
  const sources = await listSources();
  return NextResponse.json({ sources });
}