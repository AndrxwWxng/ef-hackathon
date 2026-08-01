import { NextResponse } from "next/server";

import { generateRepoHistory, RepoHistoryError } from "@/lib/repo-history/public";
import { ingestSource, type IngestInput } from "@/lib/multimodal";
import { addSource, summarizeForStorage } from "@/lib/multimodal/store";
import { generateTextDraft, generateImage, imagePromptForSource } from "@/lib/openai";
import { SAMPLE_WEEK, summarizeSource, type WeeklySource } from "@/lib/sample-week";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DRAFT_KINDS = ["newsletter", "linkedin", "x"] as const;
type DraftKind = (typeof DRAFT_KINDS)[number];

type RunWeekBody = {
  repoUrl?: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  targets?: DraftKind[];
  mood?: string;
  writingSamples?: string[];
};

type StageStatus = "pending" | "running" | "done" | "error";

type Stage = {
  id: string;
  group: "pull" | "ingest" | "generate";
  label: string;
  status: StageStatus;
  startedAt?: number;
  ms?: number;
  detail?: string;
};

type RunEvent =
  | { type: "stage"; stage: Stage }
  | { type: "log"; group: Stage["group"]; line: string }
  | { type: "source"; id: string; label: string }
  | { type: "draft"; kind: DraftKind; text: string; metric: string; imageDataUrl?: string }
  | { type: "complete"; weeklySource: WeeklySource; sources: string[] }
  | { type: "error"; message: string; group: Stage["group"]; recoverable: boolean };

type PullOutcome = Awaited<ReturnType<typeof generateRepoHistory>> & { analysis: string };

const STAGE_DEFS: { id: string; group: Stage["group"]; label: string }[] = [
  { id: "pull.init", group: "pull", label: "Initialize pull" },
  { id: "pull.clone", group: "pull", label: "Clone repository" },
  { id: "pull.branch", group: "pull", label: "Resolve branch" },
  { id: "pull.window", group: "pull", label: "Compute time window" },
  { id: "pull.shape", group: "pull", label: "Collect counts" },
  { id: "pull.structure", group: "pull", label: "Read repo structure" },
  { id: "pull.narrative", group: "pull", label: "Capture commits" },
  { id: "pull.synthesize", group: "pull", label: "Synthesize analysis" },
  { id: "ingest.normalize", group: "ingest", label: "Normalize analysis" },
  { id: "ingest.extract", group: "ingest", label: "Extract themes" },
  { id: "ingest.summarize", group: "ingest", label: "Summarize context" },
  { id: "ingest.store", group: "ingest", label: "Store source" },
  ...DRAFT_KINDS.map((kind) => ({
    id: `generate.${kind}`,
    group: "generate" as const,
    label:
      kind === "newsletter"
        ? "Draft newsletter"
        : kind === "linkedin"
          ? "Draft LinkedIn post"
          : "Draft X post",
  })),
];

function emptyStages(): Stage[] {
  return STAGE_DEFS.map((def) => ({
    id: def.id,
    group: def.group,
    label: def.label,
    status: "pending" as StageStatus,
  }));
}

function approxMetric(kind: DraftKind, text: string): string {
  if (kind === "x") return `${text.length} chars`;
  if (kind === "linkedin") return `~${text.length.toLocaleString()} chars`;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${words} words`;
}

function parseRepoInput(value: string | undefined): { repoUrl: string; branch?: string } {
  const raw = (value ?? "").trim();
  if (!raw) throw new Error("GitHub repo is required (e.g. owner/repo or https://github.com/owner/repo)");
  if (/^https?:\/\//i.test(raw) || /^[\w.-]+@/.test(raw)) {
    return { repoUrl: raw };
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return { repoUrl: `https://github.com/${raw}.git` };
  }
  throw new Error("GitHub repo must be owner/repo or a full https URL");
}

export async function POST(req: Request): Promise<Response> {
  let body: RunWeekBody;
  try {
    body = (await req.json()) as RunWeekBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed: { repoUrl: string; branch?: string };
  try {
    parsed = parseRepoInput(body.repoUrl);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  const targets = (body.targets?.length ? body.targets : DRAFT_KINDS).filter((t): t is DraftKind =>
    (DRAFT_KINDS as readonly string[]).includes(t),
  );
  if (targets.length === 0) {
    return NextResponse.json({ error: "Pick at least one artifact to generate." }, { status: 400 });
  }

  const stages = emptyStages();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* controller closed */
        }
      };
      const updateStage = (id: string, patch: Partial<Stage>) => {
        const idx = stages.findIndex((s) => s.id === id);
        if (idx < 0) return;
        const prev = stages[idx];
        const startedAt = patch.startedAt ?? prev.startedAt ?? Date.now();
        const next: Stage = {
          ...prev,
          ...patch,
          startedAt,
          ms: patch.status === "running" ? 0 : Date.now() - startedAt,
        };
        stages[idx] = next;
        write({ type: "stage", stage: next });
      };
      const log = (line: string) => write({ type: "log", group: "pull", line });

      try {
        updateStage("pull.init", { status: "running", detail: parsed.repoUrl });
        log(`starting pull for ${parsed.repoUrl}`);

        const history = await runPullPhases({
          repoUrl: parsed.repoUrl,
          branch: parsed.branch ?? body.branch,
          windowDays: body.windowDays,
          windowAnchor: body.windowAnchor,
          updateStage,
          log,
        });

        for (const id of [
          "pull.init",
          "pull.clone",
          "pull.branch",
          "pull.window",
          "pull.shape",
          "pull.structure",
          "pull.narrative",
          "pull.synthesize",
        ]) {
          updateStage(id, { status: "done" });
        }

        const analysisText = history.analysis;

        const ingestInput: IngestInput = {
          modality: "text",
          label: `Repo history · ${history.meta.repoName}`,
          text: analysisText,
          origin: history.meta.repoUrl,
        };

        updateStage("ingest.normalize", { status: "running" });
        const ingestResult = await ingestSource(ingestInput, {
          onStep: (step) => {
            if (step.name === "normalize") {
              updateStage("ingest.normalize", {
                status: step.status === "error" ? "error" : "done",
                detail: step.detail,
              });
            } else if (step.name === "extract") {
              updateStage("ingest.extract", {
                status: step.status === "error" ? "error" : step.status === "done" ? "running" : "running",
                detail: step.detail,
              });
            } else if (step.name === "summarize") {
              updateStage("ingest.summarize", {
                status: step.status === "error" ? "error" : "running",
                detail: step.detail,
              });
            }
          },
        });
        updateStage("ingest.extract", { status: "done" });
        updateStage("ingest.summarize", { status: "done" });

        updateStage("ingest.store", { status: "running" });
        const stored = summarizeForStorage(ingestResult);
        const storedSources = await addSource(stored);
        updateStage("ingest.store", { status: "done", detail: `${storedSources.length} source${storedSources.length === 1 ? "" : "s"}` });
        write({ type: "source", id: stored.id, label: stored.label });

        const weeklySource: WeeklySource = {
          week: `Repo pull · ${history.meta.windowFrom} -> ${history.meta.windowTo}`,
          project: history.meta.repoName,
          commits: [],
          pullRequests: [],
          voiceNotes: [],
        };

        for (const kind of targets) {
          updateStage(`generate.${kind}`, { status: "running" });
          const text = await generateTextDraft({
            kind,
            source: weeklySource,
            mood: body.mood,
            writingSamples: body.writingSamples,
          });
          let imageDataUrl: string | undefined;
          if (kind === "linkedin" || kind === "x") {
            const prompt = imagePromptForSource(weeklySource, kind);
            const img = await generateImage(prompt);
            imageDataUrl = `data:image/png;base64,${img.base64}`;
          }
          updateStage(`generate.${kind}`, { status: "done", detail: approxMetric(kind, text) });
          write({
            type: "draft",
            kind,
            text,
            metric: approxMetric(kind, text),
            imageDataUrl,
          });
        }

        write({ type: "complete", weeklySource, sources: storedSources.map((s) => s.id) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stages", stages })}\n\n`));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const stage = err instanceof RepoHistoryError ? `pull.${err.stage}` : "pull";
        write({ type: "error", message, group: stage.startsWith("pull.") ? "pull" : "ingest", recoverable: false });
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

async function runPullPhases(args: {
  repoUrl: string;
  branch?: string;
  windowDays?: number;
  windowAnchor?: "last-commit" | "now";
  updateStage: (id: string, patch: Partial<Stage>) => void;
  log: (line: string) => void;
}): Promise<PullOutcome> {
  const { updateStage, log } = args;

  updateStage("pull.clone", { status: "running" });
  updateStage("pull.branch", { status: "running" });
  updateStage("pull.window", { status: "running" });
  updateStage("pull.shape", { status: "running" });
  updateStage("pull.structure", { status: "running" });
  updateStage("pull.narrative", { status: "running" });

  const result = await generateRepoHistory({
    repoUrl: args.repoUrl,
    branch: args.branch,
    windowDays: args.windowDays,
    windowAnchor: args.windowAnchor,
    onLog: log,
  });

  const detailFor = (key: keyof typeof result.phases, fallback: string) => {
    const phase = result.phases[key];
    if (!phase) return fallback;
    return `${phase.detail} · ${phase.ms}ms`;
  };

  updateStage("pull.clone", { status: "done", detail: detailFor("clone", "ok") });
  updateStage("pull.branch", { status: "done", detail: result.meta.branch });
  updateStage("pull.window", { status: "done", detail: `${result.meta.windowFrom} → ${result.meta.windowTo}` });
  updateStage("pull.shape", { status: "done", detail: detailFor("shape", "ok") });
  updateStage("pull.structure", { status: "done", detail: detailFor("structure", "ok") });
  updateStage("pull.narrative", { status: "done", detail: detailFor("narrative", "ok") });

  updateStage("pull.synthesize", { status: "running" });
  const analysis = await readAnalysis(result.artifacts.analysis);
  if (!analysis) {
    throw new RepoHistoryError("synthesize", "analysis.md missing", []);
  }
  updateStage("pull.synthesize", { status: "done", detail: `${analysis.length.toLocaleString()} chars` });

  return Object.assign({}, result, { analysis }) as PullOutcome;
}

async function readAnalysis(filePath: string): Promise<string> {
  const fs = await import("node:fs/promises");
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

void summarizeSource;
void SAMPLE_WEEK;