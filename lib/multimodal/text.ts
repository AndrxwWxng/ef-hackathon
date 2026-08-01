import { buildTakeaways } from "./extract";
import type { IngestStage, IngestStep, IngestTakeaways, IngestTranscript } from "./types";

const DEFAULT_PHRASE_LIMIT = 12;
const DEFAULT_BULLET_LIMIT = 4;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  return (text.match(/\b[\p{Letter}\p{Number}']+\b/gu) ?? []).length;
}

export function readSteps(steps: IngestStep[]): { findStage: (stage: IngestStage) => IngestStep } {
  return {
    findStage: (stage) => {
      const step = steps.find((item) => item.name === stage);
      if (!step) throw new Error(`Missing step "${stage}" in pipeline definition`);
      return step;
    },
  };
}

export function takeawaysFromText(text: string): IngestTakeaways {
  return buildTakeaways(text, {
    phraseLimit: DEFAULT_PHRASE_LIMIT,
    bulletLimit: DEFAULT_BULLET_LIMIT,
  });
}

export function transcriptFromText(text: string, model = "passthrough"): IngestTranscript {
  return {
    fullText: text,
    language: "en",
    segments: [{ startMs: 0, endMs: Math.max(1000, text.length * 60), text, speaker: "speaker" }],
    model,
  };
}