export type WindowAnchor = "last-commit" | "now";

export type RepoHistoryInput = {
  repoUrl: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: WindowAnchor;
  outDir?: string;
  onLog?: (line: string) => void;
};

export type RepoHistoryOptions = {
  cloneRoot?: string;
  fetchTimeoutMs?: number;
  exclude?: string[];
  maxLogs?: number;
};

export type RepoHistoryMeta = {
  repoUrl: string;
  repoName: string;
  branch: string;
  windowFrom: string;
  windowTo: string;
  windowAnchorIso: string;
  windowAnchorMode: WindowAnchor;
  windowDays: number;
  totalCommits: number;
  totalMerges: number;
  weekCommits: number;
  weekMerges: number;
  shallow: boolean;
  cloneDir: string;
  outDir: string;
  generatedAt: string;
};

export type RepoHistoryArtifacts = {
  metaJson: string;
  phase1: string;
  phase2: string;
  phase3: string;
  analysis: string;
};

export type RepoHistoryResult = {
  meta: RepoHistoryMeta;
  artifacts: RepoHistoryArtifacts;
  data: {
    shape: import("./phase1").Phase1Shape;
    structure: import("./phase2").Phase2Structure;
    narrative: import("./phase3").Phase3Narrative;
  };
  phases: {
    clone: { ms: number; detail: string };
    shape: { ms: number; detail: string };
    structure: { ms: number; detail: string };
    narrative: { ms: number; detail: string };
    synthesize: { ms: number; detail: string };
  };
  logs: string[];
};

export class RepoHistoryError extends Error {
  stage: keyof RepoHistoryResult["phases"] | "init";
  cause?: unknown;
  logs: string[];

  constructor(stage: RepoHistoryError["stage"], cause: unknown, logs: string[]) {
    super(
      `repo-history ${stage} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = "RepoHistoryError";
    this.stage = stage;
    this.cause = cause;
    this.logs = logs;
  }
}