import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AudioError,
  hashBuffer,
  probeAudioDurationMs,
  transcribeAudio,
  takeawaysFromTranscript,
} from "./audio";
import {
  countWords,
  normalizeText,
  readSteps,
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

async function resolveOutputDir(opts: IngestOptions, id: string): Promise<string> {
  const root = opts.outputRoot ?? path.join(process.cwd(), ".ingest");
  const dir = path.join(root, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadBufferFromPath(filePath: string): Promise<{ buffer: Buffer; bytes: number }> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error(`not a file: ${filePath}`);
  const buffer = await fs.readFile(filePath);
  return { buffer, bytes: stat.size };
}

function asBuffer(input: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input);
}

function deriveOrigin(input: IngestInput): string {
  if ("origin" in input && input.origin) return input.origin;
  if ("filePath" in input && input.filePath) return input.filePath;
  if ("fileName" in input && input.fileName) return input.fileName ?? "buffer";
  return "inline";
}

async function ingestText(input: Extract<IngestInput, { modality: "text" }>, steps: IngestStep[], log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; normalized: string }> {
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const createdAt = new Date().toISOString();
  log(`received text (${countWords(input.text)} words)`);
  const normalized = await runStage("normalize", async () => normalizeText(input.text), (result) => `${countWords(result)} words`);
  const transcript = transcriptFromText(normalized);
  const takeaways = await runStage("extract", async () => takeawaysFromText(normalized), (result) => `${result.keyPhrases.length} phrases · ${result.themes.length} themes`);
  await runStage("summarize", async () => ({ ...takeaways, finishedAt: createdAt }), (result) => result.summary ? `${result.summary.length} chars` : "ok");
  return { transcript, takeaways, normalized };
}

async function ingestAudio(input: Extract<IngestInput, { modality: "audio" }>, workDir: string, options: IngestOptions, steps: IngestStep[], log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; durationMs: number; bytes: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  let audioInput: { filePath?: string; buffer?: Buffer } = {};
  let bytes = 0;
  let durationMs = 0;
  if ("filePath" in input && input.filePath) {
    const { buffer, bytes: size } = await loadBufferFromPath(input.filePath);
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

async function ingestVideoItem(input: Extract<IngestInput, { modality: "video" }>, workDir: string, options: IngestOptions, steps: IngestStep[], log: (line: string) => void, runStage: <T>(name: IngestStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => Promise<T>): Promise<{ transcript: IngestTranscript; takeaways: IngestTakeaways; durationMs: number; bytes: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  let videoInput: { filePath?: string; buffer?: Buffer } = {};
  let bytes = 0;
  if ("filePath" in input && input.filePath) {
    const { buffer, bytes: size } = await loadBufferFromPath(input.filePath);
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
  const outputDir = await resolveOutputDir(options, id);
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
  void readSteps;

  let transcript: IngestTranscript | undefined;
  let takeaways: IngestTakeaways | undefined;
  let durationMs: number | undefined;
  let bytes: number | undefined;
  let mimeType: string | undefined;
  let fileName: string | undefined;

  try {
    if (modality === "text") {
      ({ transcript, takeaways } = await ingestText(input, steps, log, runStep));
    } else if (modality === "audio") {
      if ("mimeType" in input) mimeType = input.mimeType;
      if ("fileName" in input) fileName = input.fileName;
      const out = await ingestAudio(input, workDir, options, steps, log, runStep);
      ({ transcript, takeaways } = out);
      durationMs = out.durationMs;
      bytes = out.bytes;
    } else {
      if ("mimeType" in input) mimeType = input.mimeType;
      if ("fileName" in input) fileName = input.fileName;
      const out = await ingestVideoItem(input, workDir, options, steps, log, runStep);
      ({ transcript, takeaways } = out);
      durationMs = out.durationMs;
      bytes = out.bytes;
    }

    const source: IngestSource = {
      id,
      modality,
      label: input.label || MODALITY_LABEL[modality],
      origin: deriveOrigin(input),
      bytes,
      mimeType,
      durationMs,
      createdAt,
      transcript,
      takeaways,
      ...(fileName ? {} : {}),
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

export {
  AudioError,
  VideoError,
  IngestError,
} from "./types";
export type { IngestInput, IngestResult, IngestSource, IngestStage, IngestStep, IngestTranscript, IngestTakeaways, IngestTranscriptSegment, IngestOptions, Modality } from "./types";