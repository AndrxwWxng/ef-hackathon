import { NextResponse } from "next/server";

import { generateRepoHistory, projectToWeeklySource, RepoHistoryError } from "@/lib/repo-history/public";
import { ingestSource, type IngestInput } from "@/lib/multimodal";
import {
  addSource,
  getCredential,
  summarizeForStorage,
  type StoredSource,
} from "@/lib/multimodal/store";
import { generateTextDraft, generateImage, imagePromptForSource } from "@/lib/openai";
import { type WeeklySource } from "@/lib/weekly-source";

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
  { id: "pull.deep", group: "pull", label: "Read diffs and source files" },
  { id: "pull.github", group: "pull", label: "Fetch PRs and issues" },
  { id: "pull.comprehend", group: "pull", label: "Understand the changes" },
  { id: "pull.synthesize", group: "pull", label: "Synthesize analysis" },
  { id: "pull.discord", group: "pull", label: "Refresh Discord channels" },
  { id: "pull.slack", group: "pull", label: "Refresh Slack channels" },
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
          "pull.deep",
          "pull.github",
          "pull.comprehend",
          "pull.synthesize",
        ]) {
          updateStage(id, { status: "done" });
        }

        for (const warning of history.warnings) {
          write({ type: "error", message: warning, group: "pull", recoverable: true });
          log(`warning: ${warning}`);
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
        let storedSources = await addSource(stored);
        updateStage("ingest.store", { status: "done", detail: `${storedSources.length} source${storedSources.length === 1 ? "" : "s"}` });
        write({ type: "source", id: stored.id, label: stored.label });

        storedSources = await refreshConnectorSources({
          kind: "discord",
          sources: storedSources,
          updateStage,
          write,
          log: (line) => write({ type: "log", group: "pull", line }),
        });
        storedSources = await refreshConnectorSources({
          kind: "slack",
          sources: storedSources,
          updateStage,
          write,
          log: (line) => write({ type: "log", group: "pull", line }),
        });

        const weeklySource: WeeklySource = projectToWeeklySource({
          meta: history.meta,
          shape: history.data.shape,
          structure: history.data.structure,
          narrative: history.data.narrative,
          deep: history.data.deep,
          github: history.data.github,
          comprehension: history.data.comprehension,
        });

        for (const kind of targets) {
          updateStage(`generate.${kind}`, { status: "running" });
        }

        const draftResults = await Promise.all(
          targets.map(async (kind) => {
            try {
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
              return { kind, text, imageDataUrl };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              updateStage(`generate.${kind}`, { status: "error", detail: message });
              write({
                type: "error",
                message: `${kind} generation failed: ${message}`,
                group: "generate",
                recoverable: true,
              });
              throw err;
            }
          }),
        );

        for (const result of draftResults) {
          updateStage(`generate.${result.kind}`, {
            status: "done",
            detail: approxMetric(result.kind, result.text),
          });
          write({
            type: "draft",
            kind: result.kind,
            text: result.text,
            metric: approxMetric(result.kind, result.text),
            imageDataUrl: result.imageDataUrl,
          });
        }

        write({ type: "complete", weeklySource, sources: storedSources.map((s) => s.id) });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stages", stages })}\n\n`));
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        let group: Stage["group"] = "pull";
        if (err instanceof RepoHistoryError) {
          group = "pull";
        } else if (message.includes(" generation failed")) {
          group = "generate";
        }
        write({ type: "error", message, group, recoverable: false });
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
  updateStage("pull.deep", { status: "running" });
  updateStage("pull.github", { status: "running" });
  updateStage("pull.comprehend", { status: "running" });

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
  updateStage("pull.deep", {
    status: result.data.deep ? "done" : "error",
    detail: detailFor("deep", "skipped"),
  });
  updateStage("pull.github", {
    status: result.data.github ? "done" : "error",
    detail: detailFor("github", "skipped or not a GitHub repo"),
  });
  updateStage("pull.comprehend", {
    status: result.data.comprehension ? "done" : "error",
    detail: detailFor("comprehend", "skipped; drafts fall back to heuristics"),
  });

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

type RefreshConnectorArgs = {
  kind: "discord" | "slack";
  sources: StoredSource[];
  updateStage: (id: string, patch: Partial<Stage>) => void;
  write: (event: RunEvent) => void;
  log: (line: string) => void;
};

async function refreshConnectorSources(args: RefreshConnectorArgs): Promise<StoredSource[]> {
  const { kind, sources, updateStage, write, log } = args;
  const stageId = kind === "discord" ? "pull.discord" : "pull.slack";
  const targets = sources.filter((source) => source.connector?.kind === kind);
  if (targets.length === 0) {
    updateStage(stageId, { status: "done", detail: "no channels connected" });
    log(`${kind}: no channels connected`);
    return sources;
  }
  updateStage(stageId, {
    status: "running",
    detail: `${targets.length} channel${targets.length === 1 ? "" : "s"}`,
  });
  log(`${kind}: refreshing ${targets.length} channel${targets.length === 1 ? "" : "s"}`);

  let ok = 0;
  let failed = 0;
  const refreshed = [...sources];

  await Promise.all(
    targets.map(async (source) => {
      const channelLabel = source.connector?.channelName
        ? `#${source.connector.channelName}`
        : source.connector?.channelId ?? source.label;
      try {
        const credential = await getCredential(source.id);
        if (!credential) {
          log(`${kind}: ${channelLabel} skipped (no saved token)`);
          failed += 1;
          return;
        }
        const channelId = source.connector?.channelId ?? source.origin;
        if (!channelId) {
          log(`${kind}: ${channelLabel} skipped (missing channel id)`);
          failed += 1;
          return;
        }
        const input: IngestInput =
          kind === "discord"
            ? {
                modality: "discord",
                label: source.label,
                token: credential.token,
                channelId,
                limit: 50,
                origin: channelId,
              }
            : {
                modality: "slack",
                label: source.label,
                token: credential.token,
                channelId,
                workspace: credential.workspace ?? source.connector?.workspace,
                limit: 50,
                origin: channelId,
              };
        const result = await ingestSource(input, {
          onLog: () => undefined,
          onStep: () => undefined,
        });
        result.id = source.id;
        result.source.id = source.id;
        const stored = summarizeForStorage(result);
        const next = await addSource(stored);
        const idx = refreshed.findIndex((item) => item.id === source.id);
        if (idx >= 0) refreshed[idx] = stored;
        else refreshed.unshift(stored);
        const merged = next;
        for (let i = 0; i < refreshed.length; i += 1) {
          const match = merged.find((item) => item.id === refreshed[i].id);
          if (match) refreshed[i] = match;
        }
        const msgs = stored.connector?.lastMessageCount ?? 0;
        ok += 1;
        log(`${kind}: ${channelLabel} ✓ (${msgs} msgs)`);
        write({ type: "source", id: source.id, label: stored.label });
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        log(`${kind}: ${channelLabel} ✗ ${message}`);
      }
    }),
  );

  const detail = `${ok}/${targets.length} refreshed${failed ? ` · ${failed} failed` : ""}`;
  updateStage(stageId, { status: failed === targets.length ? "error" : "done", detail });
  if (failed === targets.length && ok === 0) {
    write({
      type: "error",
      message: `${kind} refresh failed for every channel (${failed}/${targets.length}). Drafts will skip the latest channel activity.`,
      group: "pull",
      recoverable: true,
    });
  }
  return refreshed;
}
