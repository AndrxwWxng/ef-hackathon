import { NextResponse } from "next/server";

import { listSources, type StoredSource } from "@/lib/multimodal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse<{ sources: StoredSource[] }>> {
  const sources = await listSources();
  return NextResponse.json({ sources });
}