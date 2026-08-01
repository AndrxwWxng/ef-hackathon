export type Modality = "text" | "audio" | "video" | "discord" | "slack";

export type IngestStage = "receive" | "normalize" | "transcribe" | "extract" | "summarize";

export type IngestStepStatus = "pending" | "running" | "done" | "skipped" | "error";

export type IngestStep = {
  name: IngestStage;
  status: IngestStepStatus;
  ms: number;
  detail: string;
};

export type IngestSourceMeta = {
  id: string;
  modality: Modality;
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
};

export type IngestTranscriptSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
};

export type IngestTranscript = {
  fullText: string;
  language?: string;
  segments: IngestTranscriptSegment[];
  model?: string;
};

export type KeyPhrase = {
  phrase: string;
  weight: number;
  count: number;
};

export type IngestTakeaways = {
  summary: string;
  bullets: string[];
  keyPhrases: KeyPhrase[];
  themes: string[];
  tone: string;
  quotes: string[];
};

export type IngestSource = IngestSourceMeta & {
  transcript?: IngestTranscript;
  takeaways?: IngestTakeaways;
};

export type IngestOptions = {
  workRoot?: string;
  outputRoot?: string;
  transcribeModel?: string;
  extractLimit?: number;
  onLog?: (line: string) => void;
  onStep?: (step: IngestStep) => void;
};

export type TextInput = {
  modality: "text";
  label: string;
  text: string;
  origin?: string;
};

export type AudioInput =
  | {
      modality: "audio";
      label: string;
      filePath: string;
      origin?: string;
    }
  | {
      modality: "audio";
      label: string;
      buffer: Uint8Array | Buffer;
      mimeType?: string;
      fileName?: string;
      origin?: string;
    };

export type VideoInput =
  | {
      modality: "video";
      label: string;
      filePath: string;
      origin?: string;
    }
  | {
      modality: "video";
      label: string;
      buffer: Uint8Array | Buffer;
      mimeType?: string;
      fileName?: string;
      origin?: string;
    };

export type DiscordInput = {
  modality: "discord";
  label: string;
  token: string;
  channelId: string;
  limit?: number;
  origin?: string;
};

export type SlackInput = {
  modality: "slack";
  label: string;
  token: string;
  channelId: string;
  workspace?: string;
  limit?: number;
  origin?: string;
};

export type IngestInput = TextInput | AudioInput | VideoInput | DiscordInput | SlackInput;

export type IngestResult = {
  id: string;
  modality: Modality;
  source: IngestSource;
  steps: IngestStep[];
  logs: string[];
  createdAt: string;
  finishedAt: string;
};

export type BatchInput = {
  items: IngestInput[];
  options?: IngestOptions;
};

export type BatchResult = {
  id: string;
  results: IngestResult[];
  startedAt: string;
  finishedAt: string;
};

export class IngestError extends Error {
  stage: IngestStage;
  modality: Modality;
  steps: IngestStep[];
  logs: string[];

  constructor(stage: IngestStage, modality: Modality, cause: unknown, steps: IngestStep[], logs: string[]) {
    super(
      `${stage} failed for ${modality} source: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "IngestError";
    this.stage = stage;
    this.modality = modality;
    this.steps = steps;
    this.logs = logs;
  }
}

export const MODALITY_LABEL: Record<Modality, string> = {
  text: "text",
  audio: "voice",
  video: "video",
  discord: "discord",
  slack: "slack",
};

export const STAGES_BY_MODALITY: Record<Modality, IngestStage[]> = {
  text: ["receive", "normalize", "extract", "summarize"],
  audio: ["receive", "transcribe", "extract", "summarize"],
  video: ["receive", "transcribe", "extract", "summarize"],
  discord: ["receive", "normalize", "extract", "summarize"],
  slack: ["receive", "normalize", "extract", "summarize"],
};