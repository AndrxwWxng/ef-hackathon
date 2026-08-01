export type WindowAnchor = "last-commit" | "now";

export type RepoHistoryInput = {
  repoUrl: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: WindowAnchor;
  outDir?: string;
  onLog?: (line: string) => void;
  /** Read patches, key files, and docs. Default true. */
  deepRead?: boolean;
  /** Pull PR/issue/release prose from the GitHub API. Default true. */
  useGitHub?: boolean;
  /**
   * Run the LLM comprehension pass over the deep read. Default true, but
   * automatically skipped when OPENAI_KEY is missing or deepRead is off.
   */
  comprehend?: boolean;
};

export type RepoHistoryOptions = {
  cloneRoot?: string;
  fetchTimeoutMs?: number;
  exclude?: string[];
  maxLogs?: number;
  deepLimits?: Partial<import("./phase4").Phase4Limits>;
  comprehendBatchSize?: number;
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
  /** Patches, key file contents, docs, routes. Written when deepRead ran. */
  phase4?: string;
  /** PR/issue/release prose. Written when the GitHub fetch ran. */
  github?: string;
  /** The comprehension digest. Written when the LLM pass ran. */
  digest?: string;
  analysis: string;
};

export type PhaseTiming = { ms: number; detail: string };

export type RepoHistoryResult = {
  meta: RepoHistoryMeta;
  artifacts: RepoHistoryArtifacts;
  data: {
    shape: import("./phase1").Phase1Shape;
    structure: import("./phase2").Phase2Structure;
    narrative: import("./phase3").Phase3Narrative;
    deep: import("./phase4").Phase4Deep | null;
    github: import("./github").GitHubContext | null;
    comprehension: import("./comprehend").ComprehensionResult | null;
  };
  phases: {
    clone: PhaseTiming;
    shape: PhaseTiming;
    structure: PhaseTiming;
    narrative: PhaseTiming;
    deep?: PhaseTiming;
    github?: PhaseTiming;
    comprehend?: PhaseTiming;
    synthesize: PhaseTiming;
  };
  /** Non-fatal degradations, e.g. GitHub unreachable or comprehension skipped. */
  warnings: string[];
  logs: string[];
};

export class RepoHistoryError extends Error {
  stage: keyof RepoHistoryResult["phases"] | "init" | "deep" | "github" | "comprehend";
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