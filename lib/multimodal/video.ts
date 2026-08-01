import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  transcribeAudio,
  probeAudioDurationMs,
  type AudioError,
} from "./audio";
import { buildTakeaways, transcriptDurationMs, transcriptToText } from "./extract";
import type { IngestTranscript } from "./types";

const DEFAULT_FRAMES = 4;

async function extractAudioFromVideo(input: string | Buffer, workDir: string, baseName: string): Promise<string> {
  await fs.mkdir(workDir, { recursive: true });
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
        path.join(workDir, `${baseName}.audio.mp3`),
      ]);
      const err: Buffer[] = [];
      proc.stderr.on("data", (chunk) => err.push(chunk));
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg video→audio exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-240)}`));
          return;
        }
        resolve(path.join(workDir, `${baseName}.audio.mp3`));
      });
    });
  }
  const inputPath = path.join(workDir, `${baseName}.input`);
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
      path.join(workDir, `${baseName}.audio.mp3`),
    ]);
    const err: Buffer[] = [];
    proc.stderr.on("data", (chunk) => err.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      fs.rm(inputPath, { force: true }).catch(() => undefined);
      if (code !== 0) {
        reject(new Error(`ffmpeg video→audio exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-240)}`));
        return;
      }
      resolve(path.join(workDir, `${baseName}.audio.mp3`));
    });
  });
}

async function probeVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
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
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const value = Number(Buffer.concat(chunks).toString("utf8").trim());
      resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : 0);
    });
  });
}

async function extractKeyFrames(input: string | Buffer, workDir: string, baseName: string, count: number): Promise<string[]> {
  await fs.mkdir(workDir, { recursive: true });
  const isBuffer = !(typeof input === "string");
  let inputPath: string;
  if (isBuffer) {
    inputPath = path.join(workDir, `${baseName}.input`);
    await fs.writeFile(inputPath, input as Buffer);
  } else {
    inputPath = input;
  }
  let durationSec = 0;
  if (isBuffer) {
    durationSec = await probeVideoDurationBuffer(input as Buffer);
  } else {
    durationSec = (await probeVideoDuration(input as string)) / 1000;
  }
  const safeCount = Math.max(1, count);
  const fps = durationSec > 0 ? Math.max(0.5, safeCount / durationSec) : safeCount;
  const pattern = path.join(workDir, `${baseName}.frame-%02d.jpg`);
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      `fps=${fps.toFixed(3)},scale=640:-2`,
      "-frames:v",
      String(safeCount),
      "-vsync",
      "vfr",
      "-q:v",
      "4",
      pattern,
    ]);
    const err: Buffer[] = [];
    proc.stderr.on("data", (chunk) => err.push(chunk));
    proc.on("error", () => resolve([]));
    proc.on("close", async () => {
      if (isBuffer) await fs.rm(inputPath, { force: true }).catch(() => undefined);
      try {
        const files = (await fs.readdir(workDir))
          .filter((name) => name.startsWith(`${baseName}.frame-`) && name.endsWith(".jpg"))
          .sort();
        resolve(files.map((name) => path.join(workDir, name)));
      } catch {
        resolve([]);
      }
    });
  });
}

async function probeVideoDurationBuffer(buffer: Buffer): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      "-",
    ]);
    proc.stdin.write(buffer);
    proc.stdin.end();
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.on("error", () => resolve(0));
    proc.on("close", () => {
      const value = Number(Buffer.concat(chunks).toString("utf8").trim());
      resolve(Number.isFinite(value) && value > 0 ? value : 0);
    });
  });
}

export type VideoIngestOptions = {
  workDir: string;
  apiKey?: string;
  transcribeModel?: string;
  frameCount?: number;
  onLog?: (line: string) => void;
};

export type VideoIngestResult = {
  durationMs: number;
  audioPath: string;
  framePaths: string[];
  transcript: IngestTranscript;
  transcriptText: string;
};

export class VideoError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "VideoError";
    this.cause = cause;
  }
}

export async function ingestVideo(
  input: { filePath?: string; buffer?: Buffer | Uint8Array },
  options: VideoIngestOptions,
): Promise<VideoIngestResult> {
  const baseName = `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const log = options.onLog ?? (() => undefined);
  const frameCount = Math.max(1, Math.min(8, options.frameCount ?? DEFAULT_FRAMES));
  let audioPath: string | null = null;
  try {
    log(`extracting audio from video (${input.filePath ? "file" : "buffer"})`);
    audioPath = await extractAudioFromVideo(
      (input.filePath ?? (input.buffer as Buffer)) as string | Buffer,
      options.workDir,
      baseName,
    );
    log(`extracting ${frameCount} key frames`);
    const framePaths = await extractKeyFrames(
      (input.filePath ?? (input.buffer as Buffer)) as string | Buffer,
      options.workDir,
      baseName,
      frameCount,
    );
    log(`transcribing audio track`);
    const transcript = await transcribeAudio({ filePath: audioPath }, options.workDir, options.apiKey, options.transcribeModel);
    const transcriptText = transcriptToText(transcript);
    let durationMs = 0;
    if (input.filePath) durationMs = await probeVideoDuration(input.filePath);
    if (!durationMs && audioPath) durationMs = await probeAudioDurationMs(audioPath);
    if (!durationMs) durationMs = transcriptDurationMs(transcript);
    return { durationMs, audioPath, framePaths, transcript, transcriptText };
  } catch (err) {
    if (err instanceof VideoError) throw err;
    if ((err as { name?: string })?.name === "AudioError") throw err as AudioError;
    throw new VideoError(
      `video ingest failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

export function buildVideoTakeaways(text: string) {
  return buildTakeaways(text);
}