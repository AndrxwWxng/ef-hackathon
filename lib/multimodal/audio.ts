import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { buildTakeaways, transcriptDurationMs, transcriptToText } from "./extract";
import type { IngestTranscript, IngestTranscriptSegment } from "./types";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const DEFAULT_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "whisper-1";
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

export class AudioError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AudioError";
    this.cause = cause;
  }
}

async function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new AudioError(`ffprobe exited ${code}`));
        return;
      }
      const value = Number(Buffer.concat(chunks).toString("utf8").trim());
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0);
    });
  });
}

export async function probeAudioDurationMs(filePath: string): Promise<number> {
  try {
    return await probeDuration(filePath);
  } catch {
    return 0;
  }
}

export async function normalizeAudioToMp3(input: string | Buffer, outputDir: string, baseName: string): Promise<string> {
  const inputPath = path.join(outputDir, `${baseName}.input`);
  if (typeof input === "string") {
    return new Promise((resolve, reject) => {
      const proc = spawn("ffmpeg", [
        "-y",
        "-i",
        input,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-b:a",
        "64k",
        path.join(outputDir, `${baseName}.mp3`),
      ]);
      const err: Buffer[] = [];
      proc.stderr.on("data", (chunk) => err.push(chunk));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new AudioError(`ffmpeg exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-300)}`));
          return;
        }
        resolve(path.join(outputDir, `${baseName}.mp3`));
      });
    });
  }
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(inputPath, input);
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      path.join(outputDir, `${baseName}.mp3`),
    ]);
    const err: Buffer[] = [];
    proc.stderr.on("data", (chunk) => err.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      fs.rm(inputPath, { force: true }).catch(() => undefined);
      if (code !== 0) {
        reject(new AudioError(`ffmpeg exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-300)}`));
        return;
      }
      resolve(path.join(outputDir, `${baseName}.mp3`));
    });
  });
}

export function hashBuffer(buffer: Buffer | Uint8Array): string {
  return createHash("sha1").update(buffer).digest("hex").slice(0, 16);
}

type WhisperVerboseJson = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    id?: number;
    start?: number;
    end?: number;
    text?: string;
    speaker?: string;
  }>;
};

export async function transcribeWithWhisper(
  filePath: string,
  apiKey: string,
  model = DEFAULT_MODEL,
): Promise<IngestTranscript> {
  const buffer = await fs.readFile(filePath);
  if (buffer.byteLength > MAX_AUDIO_BYTES) {
    throw new AudioError(
      `audio file is ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; max is ${MAX_AUDIO_BYTES / 1024 / 1024} MB`,
    );
  }
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: "audio/mpeg" });
  form.append("file", blob, path.basename(filePath));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");

  let response: Response;
  try {
    response = await fetch(WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new AudioError(`Whisper request failed: ${err instanceof Error ? err.message : String(err)}`, err);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw new AudioError(`Whisper returned ${response.status}: ${raw.slice(0, 240)}`);
  }
  let parsed: WhisperVerboseJson;
  try {
    parsed = JSON.parse(raw) as WhisperVerboseJson;
  } catch (err) {
    throw new AudioError("Whisper response was not JSON", err);
  }
  const segments: IngestTranscriptSegment[] = (parsed.segments ?? []).map((seg) => ({
    startMs: Math.max(0, Math.round((seg.start ?? 0) * 1000)),
    endMs: Math.max(0, Math.round((seg.end ?? seg.start ?? 0) * 1000)),
    text: (seg.text ?? "").trim(),
    speaker: seg.speaker,
  }));
  return {
    fullText: (parsed.text ?? "").trim() || transcriptToText({ fullText: "", segments, language: parsed.language }),
    language: parsed.language,
    segments,
    model,
  };
}

export async function transcribeWithLocalMock(filePath: string): Promise<IngestTranscript> {
  const stat = await fs.stat(filePath).catch(() => null);
  const bytes = stat?.size ?? 0;
  const minutes = Math.max(0.25, bytes / (1024 * 96));
  const sentences = [
    "We shipped the new ingest path this week and the numbers look much better.",
    "Two flaky integrations are stable now and that unblocked the sponsor digest.",
    "Next up is a calmer mobile view and a sponsor-only changelog.",
    "Thanks to the team for keeping the tone even when the timeline moved.",
  ];
  const segments: IngestTranscriptSegment[] = sentences.map((text, i) => {
    const start = Math.round((i * minutes * 60_000) / sentences.length);
    const end = Math.round(((i + 1) * minutes * 60_000) / sentences.length);
    return { startMs: start, endMs: end, text, speaker: "speaker" };
  });
  return {
    fullText: sentences.join(" "),
    language: "en",
    segments,
    model: "local-mock",
  };
}

export async function transcribeAudio(
  input: { filePath?: string; buffer?: Buffer | Uint8Array },
  workDir: string,
  apiKey?: string,
  model?: string,
): Promise<IngestTranscript> {
  const baseName = `audio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await fs.mkdir(workDir, { recursive: true });
  let workingPath: string;
  if (input.filePath) {
    workingPath = await normalizeAudioToMp3(input.filePath, workDir, baseName);
  } else if (input.buffer) {
    workingPath = await normalizeAudioToMp3(Buffer.from(input.buffer), workDir, baseName);
  } else {
    throw new AudioError("transcribeAudio: need filePath or buffer");
  }
  try {
    if (apiKey) {
      return await transcribeWithWhisper(workingPath, apiKey, model ?? DEFAULT_MODEL);
    }
    return await transcribeWithLocalMock(workingPath);
  } finally {
    await fs.rm(workingPath, { force: true }).catch(() => undefined);
  }
}

export function takeawaysFromTranscript(transcript: IngestTranscript): ReturnType<typeof buildTakeaways> {
  const text = transcriptToText(transcript);
  const takeaways = buildTakeaways(text);
  takeaways.summary = `${takeaways.summary} (${(transcriptDurationMs(transcript) / 60000).toFixed(1)} min)`;
  return takeaways;
}