import { NextResponse } from "next/server";

import { listSources, type StoredSource } from "@/lib/multimodal/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ContextResponse = {
  sourceCount: number;
  words: number;
  minutes: number;
  bullets: string[];
  themes: string[];
  tone: string;
  phrases: { phrase: string; count: number }[];
  body: string;
};

const HEAD = (label: string) => `## ${label}`;
const BULLET = (text: string) => `- ${text}`;
const QUOTE = (text: string) => `> ${text}`;

function durationToMinutes(durationMs?: number): number {
  if (!durationMs || durationMs <= 0) return 0;
  return durationMs / 60_000;
}

function sourceMinutes(source: StoredSource): number {
  if (source.modality === "text" || source.modality === "discord" || source.modality === "slack") {
    const words = (source.transcriptPreview ?? "").split(/\s+/).filter(Boolean).length;
    return words / 220;
  }
  return durationToMinutes(source.durationMs);
}

function sourceWords(source: StoredSource): number {
  const text = source.transcriptPreview ?? "";
  return text.split(/\s+/).filter(Boolean).length;
}

export async function GET(): Promise<NextResponse<ContextResponse>> {
  const sources = await listSources();
  const totalWords = sources.reduce((sum, source) => sum + sourceWords(source), 0);
  const totalMinutes = sources.reduce((sum, source) => sum + sourceMinutes(source), 0);

  const sectionHeadings: string[] = [];
  if (sources.some((s) => s.modality === "audio")) sectionHeadings.push("Voice notes");
  if (sources.some((s) => s.modality === "video")) sectionHeadings.push("Video transcripts");
  if (sources.some((s) => s.modality === "text")) sectionHeadings.push("Notes & docs");
  if (sources.some((s) => s.modality === "discord")) sectionHeadings.push("Discord channels");
  if (sources.some((s) => s.modality === "slack")) sectionHeadings.push("Slack channels");

  const sections: string[] = [];
  for (const heading of sectionHeadings) {
    const items = sources.filter((s) => sectionHeadingFor(s) === heading);
    if (!items.length) continue;
    sections.push(`${HEAD(heading)}\n${items.map(formatSourceBlock).join("\n\n")}`);
  }

  const body = sections.length
    ? `${HEAD("Ingested sources")}\n${sources.length} source${sources.length === 1 ? "" : "s"} · ${totalWords} words · ${totalMinutes.toFixed(1)} min\n\n${sections.join("\n\n")}`
    : `${HEAD("Ingested sources")}\nNo sources ingested yet. Drop a voice note, paste a note, or add a video to start.`;

  const aggregatePhrases = new Map<string, number>();
  for (const source of sources) {
    for (const phrase of source.keyPhrases ?? []) {
      aggregatePhrases.set(phrase.phrase, (aggregatePhrases.get(phrase.phrase) ?? 0) + phrase.count);
    }
  }
  const phrases = [...aggregatePhrases.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([phrase, count]) => ({ phrase, count }));

  const bullets = Array.from(new Set(sources.flatMap((source) => source.bullets ?? []))).slice(0, 8);
  const themes = Array.from(new Set(sources.flatMap((source) => source.themes ?? []))).slice(0, 8);
  const tone = pickDominantTone(sources.map((source) => source.tone).filter(Boolean) as string[]);

  return NextResponse.json({
    sourceCount: sources.length,
    words: totalWords,
    minutes: Number(totalMinutes.toFixed(1)),
    bullets,
    themes,
    tone,
    phrases,
    body,
  });
}

function sectionHeadingFor(source: StoredSource): string {
  if (source.modality === "audio") return "Voice notes";
  if (source.modality === "video") return "Video transcripts";
  if (source.modality === "discord") return "Discord channels";
  if (source.modality === "slack") return "Slack channels";
  return "Notes & docs";
}

function formatSourceBlock(source: StoredSource): string {
  const metaParts: (string | null | undefined)[] = [
    source.connector
      ? `${source.connector.kind} · #${source.connector.channelName ?? source.connector.channelId}` +
        (source.connector.workspace ? ` @ ${source.connector.workspace}` : "") +
        (source.connector.lastMessageCount ? ` · ${source.connector.lastMessageCount} msgs` : "")
      : source.origin && source.origin !== "inline"
        ? source.origin
        : null,
    source.modality,
    source.durationMs ? `${(source.durationMs / 60000).toFixed(1)} min` : null,
  ];
  const meta = metaParts.filter(Boolean).join(" · ");
  const lines: string[] = [`### ${source.label}${meta ? ` — ${meta}` : ""}`];
  if (source.summary) lines.push(source.summary);
  if (source.bullets?.length) lines.push(...source.bullets.map(BULLET));
  if (source.quotes?.length) lines.push(...source.quotes.map(QUOTE));
  if (source.transcriptPreview) lines.push(`> ${source.transcriptPreview}`);
  return lines.join("\n");
}

function pickDominantTone(tones: string[]): string {
  if (!tones.length) return "neutral";
  const tally = new Map<string, number>();
  for (const tone of tones) tally.set(tone, (tally.get(tone) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}