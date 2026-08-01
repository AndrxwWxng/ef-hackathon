import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AudioError,
  probeAudioDurationMs,
  transcribeAudio,
  takeawaysFromTranscript,
} from "./audio";
import {
  defaultLabelFor,
  DiscordConnectorError,
  fetchConnector,
  formatConnectorTranscript,
  SlackConnectorError,
  type ConnectorFetchResult,
} from "@/lib/connectors";
import {
  countWords,
  normalizeText,
  takeawaysFromText,
  transcriptFromText,
} from "./text";
import {
  IngestError,
  MODALITY_LABEL,
  STAGES_BY_MODALITY,
  type IngestInput,
  type IngestOptions,
  type IngestResult,
  type IngestSource,
  type IngestStage,
  type IngestStep,
  type IngestTakeaways,
  type IngestTranscript,
  type Modality,
} from "./types";
import { VideoError, buildVideoTakeaways, ingestVideo } from "./video";

const MAX_LOGS = 400;
const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";

function makeStages(modality: Modality): IngestStep[] {
  return STAGES_BY_MODALITY[modality].map((name) => ({
    name,
    status: "pending",
    ms: 0,
    detail: "",
  }));
}

async function resolveWorkDir(opts: IngestOptions, modality: Modality, id: string): Promise<string> {
  const root = opts.workRoot ?? path.join(os.tmpdir(), "multimail-ingest");
  const dir = path.join(root, modality, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadBufferFromPath(filePath: string): Promise<{ bytes: number }> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  return { bytes: stat.size };
}

function asBuffer(input: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

function deriveOrigin(input: IngestInput): string {
  if ("origin" in input && input.origin) return input.origin;
  if ("filePath" in input && input.filePath) return input.filePath;
  if ("fileName" in input && input.fileName) return input.fileName ?? "buffer";
  if (input.modality === "discord" || input.modality === "slack") {
    return input.channelId;
  }
  return "inline";
}

async function ingestText(input: Extract<IngestInput, { modality: "text" }>, log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; normalized: string }> {
  log(`received text (${countWords(input.text)} words)`);
  const normalized = await runStage("normalize", async () => normalizeText(input.text), (result) => `${countWords(result)} words`);
  const transcript = transcriptFromText(normalized);
  const takeaways = await runStage("extract", async () => takeawaysFromText(normalized), (result) => `${result.keyPhrases.length} phrases · ${result.themes.length} themes`);
  await runStage("summarize", async () => takeaways, (result) => result.summary ? `${result.summary.length} chars` : "ok");
  return { transcript, takeaways, normalized };
}

async function ingestAudio(input: Extract<IngestInput, { modality: "audio" }>, workDir: string, log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; durationMs: number; bytes: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  let audioInput: { filePath?: string; buffer?: Buffer } = {};
  let bytes = 0;
  let durationMs = 0;
  if ("filePath" in input && input.filePath) {
    const { bytes: size } = await loadBufferFromPath(input.filePath);
    bytes = size;
    audioInput = { filePath: input.filePath };
    durationMs = await probeAudioDurationMs(input.filePath);
    log(`received audio file ${path.basename(input.filePath)} (${(size / 1024).toFixed(1)} KB)`);
  } else if ("buffer" in input && input.buffer) {
    const buf = asBuffer(input.buffer);
    bytes = buf.byteLength;
    audioInput = { buffer: buf };
    log(`received audio buffer (${(buf.byteLength / 1024).toFixed(1)} KB)`);
  } else {
    throw new AudioError("audio input needs filePath or buffer");
  }
  const transcript = await runStage("transcribe", () => transcribeAudio(audioInput, workDir, apiKey, DEFAULT_TRANSCRIBE_MODEL), (result) => `${result.segments.length} segs · ${result.model ?? "unknown"}${apiKey ? "" : " (local mock)"}`);
  if (!durationMs) durationMs = Math.max(0, transcript.segments.at(-1)?.endMs ?? 0);
  const takeaways = await runStage("extract", async () => takeawaysFromTranscript(transcript), (result) => `${result.bullets.length} bullets · ${result.keyPhrases.length} phrases`);
  await runStage("summarize", async () => takeaways, (result) => result.summary ? `${result.summary.length} chars` : "ok");
  return { transcript, takeaways, durationMs, bytes };
}

async function ingestConnector(
  input: Extract<IngestInput, { modality: "discord" | "slack" }>,
  log: (line: string) => void,
  runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>,
): Promise<{
  transcript: IngestTranscript;
  takeaways: IngestTakeaways;
  normalized: string;
  connector: ConnectorFetchResult;
  defaultLabel: string;
}> {
  const result = await runStage(
    "receive",
    async () =>
      fetchConnector({
        kind: input.modality,
        token: input.token,
        channelId: input.channelId,
        limit: input.limit,
        workspace: input.modality === "slack" ? input.workspace : undefined,
      }),
    (res) => `${res.messages.length} msgs · #${res.channel.name}${res.channel.workspace ? ` @ ${res.channel.workspace}` : ""}`,
  );
  if (result.messages.length === 0) {
    const err =
      input.modality === "discord"
        ? new DiscordConnectorError("No messages returned from Discord. Is the bot in the channel?")
        : new SlackConnectorError("No messages returned from Slack. Is the bot in the channel?");
    throw err;
  }
  const raw = formatConnectorTranscript(input.modality, result);
  log(`received ${result.messages.length} ${input.modality} messages from #${result.channel.name}`);
  const normalized = await runStage(
    "normalize",
    async () => normalizeText(raw),
    (out) => `${countWords(out)} words`,
  );
  const transcript = transcriptFromText(normalized, input.modality);
  const takeaways = await runStage(
    "extract",
    async () => takeawaysFromText(normalized),
    (res) => `${res.keyPhrases.length} phrases · ${res.themes.length} themes`,
  );
  await runStage(
    "summarize",
    async () => takeaways,
    (res) => (res.summary ? `${res.summary.length} chars` : "ok"),
  );
  return {
    transcript,
    takeaways,
    normalized,
    connector: result,
    defaultLabel: defaultLabelFor(input.modality, result),
  };
}

async function ingestVideoItem(input: Extract<IngestInput, { modality: "video" }>, workDir: string, log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; durationMs: number; bytes: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  let videoInput: { filePath?: string; buffer?: Buffer } = {};
  let bytes = 0;
  if ("filePath" in input && input.filePath) {
    const { bytes: size } = await loadBufferFromPath(input.filePath);
    bytes = size;
    videoInput = { filePath: input.filePath };
    log(`received video file ${path.basename(input.filePath)} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  } else if ("buffer" in input && input.buffer) {
    const buf = asBuffer(input.buffer);
    bytes = buf.byteLength;
    videoInput = { buffer: buf };
    log(`received video buffer (${(buf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    throw new VideoError("video input needs filePath or buffer");
  }
  const result = await runStage("transcribe", () => ingestVideo(videoInput, { workDir, apiKey, transcribeModel: DEFAULT_TRANSCRIBE_MODEL, onLog: log }), (res) => `${res.transcript.segments.length} segs · ${res.framePaths.length} frames · ${(res.durationMs / 1000).toFixed(1)}s`);
  const transcript = result.transcript;
  const transcriptText = result.transcriptText;
  const takeaways = await runStage("extract", async () => buildVideoTakeaways(transcriptText), (res) => `${res.bullets.length} bullets · ${res.themes.length} themes`);
  await runStage("summarize", async () => takeaways, (res) => res.summary ? `${res.summary.length} chars` : "ok");
  return { transcript, takeaways, durationMs: result.durationMs, bytes };
}

export async function ingestSource(input: IngestInput, options: IngestOptions = {}): Promise<IngestResult> {
  const modality = input.modality;
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const createdAt = new Date().toISOString();
  const logs: string[] = [];
  const steps = makeStages(modality);
  const workDir = await resolveWorkDir(options, modality, id);
  const log = (line: string) => {
    const clean = line.replace(/\r/g, "").trimEnd();
    if (!clean) return;
    logs.push(clean.length > 600 ? `${clean.slice(0, 600)}…` : clean);
    if (logs.length > MAX_LOGS) logs.shift();
    options.onLog?.(clean);
  };
  const runStep = async <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => {
    const step = steps.find((item) => item.name === name);
    if (!step) throw new Error(`missing step ${name} for modality ${modality}`);
    step.status = "running";
    options.onStep?.({ ...step });
    const started = Date.now();
    try {
      const result = await task();
      step.ms = Date.now() - started;
      const summary = summarize?.(result);
      if (typeof summary === "object") {
        step.status = summary.skipped ? "skipped" : "done";
        step.detail = summary.detail;
      } else {
        step.status = "done";
        step.detail = summary ?? "";
      }
      options.onStep?.({ ...step });
      return result;
    } catch (error) {
      step.ms = Date.now() - started;
      step.status = "error";
      step.detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
      options.onStep?.({ ...step });
      throw new IngestError(name, modality, error, steps.map((item) => ({ ...item })), [...logs]);
    }
  };
  void steps;

  let transcript: IngestTranscript | undefined;
  let takeaways: IngestTakeaways | undefined;
  let durationMs: number | undefined;
  let bytes: number | undefined;
  let mimeType: string | undefined;
  let connectorChannel: string | undefined;
  let connectorWorkspace: string | undefined;
  let connectorMessageCount: number | undefined;
  let connectorFetchedAt: string | undefined;
  let defaultLabel: string | undefined;

  try {
    if (modality === "text") {
      ({ transcript, takeaways } = await ingestText(input, log, runStep));
    } else if (modality === "audio") {
      if ("mimeType" in input) mimeType = input.mimeType;
      const out = await ingestAudio(input, workDir, log, runStep);
      ({ transcript, takeaways } = out);
      durationMs = out.durationMs;
      bytes = out.bytes;
    } else if (modality === "video") {
      if ("mimeType" in input) mimeType = input.mimeType;
      const out = await ingestVideoItem(input, workDir, log, runStep);
      ({ transcript, takeaways } = out);
      durationMs = out.durationMs;
      bytes = out.bytes;
    } else {
      const out = await ingestConnector(input, log, runStep);
      transcript = out.transcript;
      takeaways = out.takeaways;
      connectorChannel = out.connector.channel.name;
      connectorWorkspace = out.connector.channel.workspace;
      connectorMessageCount = out.connector.messages.length;
      connectorFetchedAt = out.connector.fetchedAt;
      defaultLabel = out.defaultLabel;
      bytes = Buffer.byteLength(out.normalized, "utf8");
    }

    const source: IngestSource = {
      id,
      modality,
      label: input.label || defaultLabel || MODALITY_LABEL[modality],
      origin: deriveOrigin(input),
      bytes,
      mimeType,
      durationMs,
      createdAt,
      connectorChannel,
      connectorWorkspace,
      connectorMessageCount,
      connectorFetchedAt,
      transcript,
      takeaways,
    };

    return {
      id,
      modality,
      source,
      steps,
      logs,
      createdAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch((err) => log(`cleanup failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

export async function ingestBatch(batch: { items: IngestInput[]; options?: IngestOptions }): Promise<IngestResult[]> {
  return Promise.all(batch.items.map((item) => ingestSource(item, batch.options)));
}

export { AudioError } from "./audio";
export { VideoError } from "./video";
export { IngestError } from "./types";
export type {
  DiscordInput,
  IngestInput,
  IngestResult,
  IngestSource,
  IngestStage,
  IngestStep,
  IngestTranscript,
  IngestTakeaways,
  IngestTranscriptSegment,
  IngestOptions,
  Modality,
  SlackInput,
} from "./types";