import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type StoredSource = {
  id: string;
  modality: "text" | "audio" | "video";
  label: string;
  origin?: string;
  bytes?: number;
  mimeType?: string;
  durationMs?: number;
  createdAt: string;
  summary?: string;
  bullets?: string[];
  themes?: string[];
  tone?: string;
  keyPhrases?: { phrase: string; count: number; weight: number }[];
  quotes?: string[];
  transcriptPreview?: string;
};

export type StoredSourcesFile = {
  version: 1;
  sources: StoredSource[];
  updatedAt: string;
};

const STORE_VERSION = 1 as const;

function storePath(): string {
  return process.env.MULTIMAIL_SOURCES_PATH ?? path.join(os.tmpdir(), "multimail-sources.json");
}

async function readFile(): Promise<StoredSourcesFile> {
  const file = storePath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as StoredSourcesFile;
    if (parsed && parsed.version === STORE_VERSION && Array.isArray(parsed.sources)) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { version: STORE_VERSION, sources: [], updatedAt: new Date().toISOString() };
}

async function writeFile(state: StoredSourcesFile): Promise<void> {
  const file = storePath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2));
}

export async function listSources(): Promise<StoredSource[]> {
  const state = await readFile();
  return state.sources;
}

export async function addSource(source: StoredSource): Promise<StoredSource[]> {
  const state = await readFile();
  const next = [source, ...state.sources.filter((item) => item.id !== source.id)].slice(0, 200);
  await writeFile({ ...state, sources: next, updatedAt: new Date().toISOString() });
  return next;
}

export async function removeSource(id: string): Promise<StoredSource[]> {
  const state = await readFile();
  const next = state.sources.filter((item) => item.id !== id);
  await writeFile({ ...state, sources: next, updatedAt: new Date().toISOString() });
  return next;
}

export async function clearSources(): Promise<StoredSource[]> {
  const next: StoredSource[] = [];
  await writeFile({ version: STORE_VERSION, sources: next, updatedAt: new Date().toISOString() });
  return next;
}

export function summarizeForStorage(result: {
  id: string;
  modality: "text" | "audio" | "video";
  source: {
    label: string;
    origin: string;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
    createdAt: string;
    transcript?: { fullText: string };
    takeaways?: { summary: string; bullets: string[]; themes: string[]; tone: string; quotes: string[]; keyPhrases: { phrase: string; count: number; weight: number }[] };
  };
}): StoredSource {
  const transcriptText = result.source.transcript?.fullText ?? "";
  return {
    id: result.id,
    modality: result.modality,
    label: result.source.label,
    origin: result.source.origin,
    bytes: result.source.bytes,
    mimeType: result.source.mimeType,
    durationMs: result.source.durationMs,
    createdAt: result.source.createdAt,
    summary: result.source.takeaways?.summary,
    bullets: result.source.takeaways?.bullets,
    themes: result.source.takeaways?.themes,
    tone: result.source.takeaways?.tone,
    keyPhrases: result.source.takeaways?.keyPhrases,
    quotes: result.source.takeaways?.quotes,
    transcriptPreview: transcriptText.length > 320 ? `${transcriptText.slice(0, 320)}…` : transcriptText,
  };
}