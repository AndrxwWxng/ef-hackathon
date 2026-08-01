import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { decryptSecret, encryptSecret } from "@/lib/connectors/credentials";

export type ConnectorKind = "discord" | "slack";

export type StoredSource = {
  id: string;
  modality: "text" | "audio" | "video" | "discord" | "slack";
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
  connector?: {
    kind: ConnectorKind;
    channelId: string;
    channelName?: string;
    workspace?: string;
    memberCount?: number;
    topic?: string;
    lastFetchedAt?: string;
    lastMessageCount?: number;
  };
};

export type StoredSourcesFile = {
  version: 1;
  sources: StoredSource[];
  updatedAt: string;
};

type StoredCredentialsFile = {
  version: 1;
  credentials: Record<string, { kind: ConnectorKind; token: string; workspace?: string }>;
  updatedAt: string;
};

const STORE_VERSION = 1 as const;
const MAX_SOURCES = 200;

function storePath(): string {
  return process.env.MULTIMAIL_SOURCES_PATH ?? path.join(os.tmpdir(), "multimail-sources.json");
}

function credentialsPath(): string {
  return process.env.MULTIMAIL_CREDENTIALS_PATH ?? path.join(os.tmpdir(), "multimail-credentials.json");
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
  const next = [source, ...state.sources.filter((item) => item.id !== source.id)].slice(0, MAX_SOURCES);
  await writeFile({ ...state, sources: next, updatedAt: new Date().toISOString() });
  return next;
}

export async function removeSource(id: string): Promise<StoredSource[]> {
  const state = await readFile();
  const next = state.sources.filter((item) => item.id !== id);
  await writeFile({ ...state, sources: next, updatedAt: new Date().toISOString() });
  await removeCredential(id).catch(() => undefined);
  return next;
}

export async function clearSources(): Promise<StoredSource[]> {
  const next: StoredSource[] = [];
  await writeFile({ version: STORE_VERSION, sources: next, updatedAt: new Date().toISOString() });
  await clearCredentials().catch(() => undefined);
  return next;
}

async function readCredentials(): Promise<StoredCredentialsFile> {
  const file = credentialsPath();
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(raw) as StoredCredentialsFile;
    if (parsed && parsed.version === STORE_VERSION && parsed.credentials) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { version: STORE_VERSION, credentials: {}, updatedAt: new Date().toISOString() };
}

async function writeCredentials(state: StoredCredentialsFile): Promise<void> {
  const file = credentialsPath();
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export async function saveCredential(args: {
  sourceId: string;
  kind: ConnectorKind;
  token: string;
  workspace?: string;
}): Promise<void> {
  const state = await readCredentials();
  state.credentials[args.sourceId] = {
    kind: args.kind,
    token: encryptSecret(args.token),
    workspace: args.workspace,
  };
  state.updatedAt = new Date().toISOString();
  await writeCredentials(state);
}

export async function getCredential(sourceId: string): Promise<{ kind: ConnectorKind; token: string; workspace?: string } | null> {
  const state = await readCredentials();
  const entry = state.credentials[sourceId];
  if (!entry) return null;
  return { kind: entry.kind, token: decryptSecret(entry.token), workspace: entry.workspace };
}

export async function removeCredential(sourceId: string): Promise<void> {
  const state = await readCredentials();
  if (!(sourceId in state.credentials)) return;
  delete state.credentials[sourceId];
  state.updatedAt = new Date().toISOString();
  await writeCredentials(state);
}

export async function clearCredentials(): Promise<void> {
  await writeCredentials({ version: STORE_VERSION, credentials: {}, updatedAt: new Date().toISOString() });
}

export function summarizeForStorage(result: {
  id: string;
  modality: StoredSource["modality"];
  source: {
    label: string;
    origin: string;
    bytes?: number;
    mimeType?: string;
    durationMs?: number;
    createdAt: string;
    connectorChannel?: string;
    connectorWorkspace?: string;
    connectorMessageCount?: number;
    connectorFetchedAt?: string;
    transcript?: { fullText: string };
    takeaways?: {
      summary: string;
      bullets: string[];
      themes: string[];
      tone: string;
      quotes: string[];
      keyPhrases: { phrase: string; count: number; weight: number }[];
    };
  };
}): StoredSource {
  const transcriptText = result.source.transcript?.fullText ?? "";
  const stored: StoredSource = {
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
  if (result.modality === "discord" || result.modality === "slack") {
    stored.connector = {
      kind: result.modality,
      channelId: result.source.origin ?? "",
      channelName: result.source.connectorChannel,
      workspace: result.source.connectorWorkspace,
      lastFetchedAt: result.source.connectorFetchedAt,
      lastMessageCount: result.source.connectorMessageCount,
    };
  }
  return stored;
}

export function newSourceId(): string {
  return randomUUID().replaceAll("-", "").slice(0, 16);
}
