"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type Modality = "text" | "audio" | "video" | "discord" | "slack";

type Source = {
  id: string;
  modality: Modality;
  label: string;
  origin: string;
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
  status?: "ready" | "ingesting" | "error";
  detail?: string;
  errorMessage?: string;
  connector?: {
    kind: "discord" | "slack";
    channelId: string;
    channelName?: string;
    workspace?: string;
    memberCount?: number;
    topic?: string;
    lastFetchedAt?: string;
    lastMessageCount?: number;
  };
};

type ArtifactKind = "newsletter" | "linkedin" | "x";

type Artifact = {
  id: ArtifactKind;
  label: string;
  handle: string;
  blurb: string;
  body: string;
  metric: string;
  tone: string;
  imageDataUrl?: string;
};

type GenerationState = {
  status: "idle" | "loading" | "error";
  error?: string;
};

type ContextSummary = {
  sourceCount: number;
  words: number;
  minutes: number;
  bullets: string[];
  themes: string[];
  tone: string;
  phrases: { phrase: string; count: number }[];
  body: string;
};

const MODALITY_META: Record<Modality, { label: string; meta: string; placeholder: string; accept?: string; help: string }> = {
  text: {
    label: "Notes & docs",
    meta: "text",
    placeholder: "Paste notes, a doc, a brief…",
    help: "Drop text in. We will normalize, extract themes, and surface key phrases.",
  },
  audio: {
    label: "Voice notes",
    meta: "audio",
    placeholder: "Drop an .mp3, .m4a, .wav…",
    accept: "audio/*",
    help: "Whisper transcribes audio locally when OPENAI_API_KEY is set; otherwise a deterministic mock transcript is used.",
  },
  video: {
    label: "Video",
    meta: "video",
    placeholder: "Drop an .mp4, .mov, .webm…",
    accept: "video/*",
    help: "Frames are extracted and stitched into a transcript alongside any built-in audio track.",
  },
  discord: {
    label: "Discord channel",
    meta: "discord",
    placeholder: "Channel ID + bot token",
    help: "Add a Discord bot token and channel id. The bot must be a member of the channel. We pull the latest 50 messages by default.",
  },
  slack: {
    label: "Slack channel",
    meta: "slack",
    placeholder: "Channel ID + bot token",
    help: "Add a Slack bot token (xoxb-…) and channel id. The bot must be invited to the channel. We pull the latest 50 messages by default.",
  },
};

const runSizes = [
  { id: "small", label: "Newsletter", note: "1 source" },
  { id: "medium", label: "Newsletter + LinkedIn", note: "All sources" },
  { id: "full", label: "Newsletter + LinkedIn + X", note: "All sources" },
];

const initialArtifacts: Artifact[] = [
  {
    id: "newsletter",
    label: "Newsletter",
    handle: "For sponsors",
    blurb:
      "A short, sourced note your partners can read in 90 seconds: what shipped, what is next, and one ask.",
    body:
      "This week we shipped a faster ingest path (4x), closed two long-standing integration gaps, and softened the digest tone. Next up: a calmer mobile view, a sponsor-only changelog, and a quiet month-end recap.",
    metric: "ready to generate",
    tone: "Calm, partner-facing",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    handle: "For partners in feed",
    blurb:
      "A single-paragraph post with the headline and the receipt. Reads as a status, not a broadcast.",
    body:
      "Click generate to draft this from the week's source data. Image is generated alongside the text.",
    metric: "ready to generate",
    tone: "Direct, status-forward",
  },
  {
    id: "x",
    label: "X post",
    handle: "For engineers in replies",
    blurb:
      "A short, slightly opinionated note. The kind that earns a bookmark and a quiet reply.",
    body:
      "Click generate to draft this from the week's source data. Image is generated alongside the text.",
    metric: "ready to generate",
    tone: "Terse, engineer-coded",
  },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(durationMs?: number): string {
  if (!durationMs) return "";
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function formatTimestamp(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeSource(source: Source): string {
  const meta = MODALITY_META[source.modality];
  if (source.status === "ingesting") return `${meta.label} · ingesting…`;
  if (source.status === "error") return `${meta.label} · ${source.errorMessage ?? "failed"}`;
  if (source.modality === "text") {
    return `${meta.label} · ${source.transcriptPreview ? `${source.transcriptPreview.split(/\s+/).filter(Boolean).length} words` : "empty"}`;
  }
  if (source.modality === "discord" || source.modality === "slack") {
    const channel = source.connector?.channelName ? `#${source.connector.channelName}` : "channel";
    const msgs = source.connector?.lastMessageCount;
    const fetched = formatTimestamp(source.connector?.lastFetchedAt);
    const parts = [
      meta.label,
      source.connector?.workspace ? `${source.connector.workspace} · ${channel}` : channel,
      msgs ? `${msgs} msgs` : null,
      fetched ? `synced ${fetched}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  if (source.modality === "audio") return `${meta.label} · ${formatDuration(source.durationMs) || "—"}`;
  return `${meta.label} · ${formatDuration(source.durationMs) || "—"}`;
}

function summarizeKeyPhrases(source: Source): string {
  if (!source.keyPhrases?.length) return "";
  return source.keyPhrases.slice(0, 3).map((p) => p.phrase).join(" · ");
}

const ENDPOINT_BY_KIND: Record<ArtifactKind, string> = {
  newsletter: "/api/generate/newsletter",
  linkedin: "/api/generate/linkedin",
  x: "/api/generate/x",
};

type CombinedResponse = {
  source: string;
  newsletter: string;
  linkedin: string;
  x: string;
  linkedinImage?: { mimeType: string; data: string };
  xImage?: { mimeType: string; data: string };
};

function approxMetric(kind: ArtifactKind, text: string): string {
  if (kind === "x") return `${text.length} chars`;
  if (kind === "linkedin") return `~${text.length.toLocaleString()} chars`;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${words} words`;
}

type ConnectorDraft = {
  modality: "discord" | "slack";
  token: string;
  channelId: string;
  workspace?: string;
  label: string;
  limit: number;
};

type ComposerState =
  | { kind: "file"; modality: "text" | "audio" | "video"; label: string; text: string }
  | { kind: "connector"; modality: "discord" | "slack"; draft: ConnectorDraft };

export default function AppHome() {
  const [activeId, setActiveId] = useState<ArtifactKind>("newsletter");
  const [size, setSize] = useState<string>("full");
  const [running, setRunning] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const [context, setContext] = useState<ContextSummary | null>(null);
  const [loadingSources, setLoadingSources] = useState(false);
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<string>("");
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingFile, setPendingFile] = useState<{ modality: "audio" | "video"; file: File } | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [state, setState] = useState<GenerationState>({ status: "idle" });

  const active = useMemo(
    () => artifacts.find((a) => a.id === activeId) ?? artifacts[0],
    [activeId, artifacts],
  );

  const refresh = useCallback(async () => {
    setLoadingSources(true);
    try {
      const [sourcesRes, contextRes] = await Promise.all([
        fetch("/app/api/sources", { cache: "no-store" }),
        fetch("/app/api/context", { cache: "no-store" }),
      ]);
      if (sourcesRes.ok) {
        const json = (await sourcesRes.json()) as { sources: Source[] };
        setSources(json.sources);
      }
      if (contextRes.ok) {
        const json = (await contextRes.json()) as ContextSummary;
        setContext(json);
      }
    } finally {
      setLoadingSources(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch from the server. Treat the network as the external
    // system: useEffect is the right primitive for syncing React state
    // with what the server currently has. Suppressing the lint rule
    // here because the alternative (eager setState in render) would
    // re-render on every parent update.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => undefined);
  }, [refresh]);

  async function generateOne(kind: ArtifactKind): Promise<void> {
    setState({ status: "loading" });
    try {
      const textRes = await fetch(ENDPOINT_BY_KIND[kind], { method: "POST" });
      if (!textRes.ok) {
        const errBody = (await textRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `text request failed (${textRes.status})`);
      }
      const textJson = (await textRes.json()) as { text: string };
      let imageDataUrl: string | undefined;
      if (kind === "linkedin" || kind === "x") {
        const imgRes = await fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        if (imgRes.ok) {
          const imgJson = (await imgRes.json()) as { mimeType: string; data: string };
          imageDataUrl = `data:${imgJson.mimeType};base64,${imgJson.data}`;
        }
      }
      setArtifacts((prev) =>
        prev.map((a) =>
          a.id === kind
            ? {
                ...a,
                body: textJson.text,
                metric: approxMetric(kind, textJson.text),
                imageDataUrl,
              }
            : a,
        ),
      );
      setState({ status: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState({ status: "error", error: message });
    }
  }

  async function handleRun() {
    setRunning(true);
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `request failed (${res.status})`);
      }
      const json = (await res.json()) as CombinedResponse;
      const targets: ArtifactKind[] =
        size === "small"
          ? ["newsletter"]
          : size === "medium"
            ? ["newsletter", "linkedin"]
            : ["newsletter", "linkedin", "x"];
      const textByKind: Record<ArtifactKind, string> = {
        newsletter: json.newsletter,
        linkedin: json.linkedin,
        x: json.x,
      };
      const imageByKind: Partial<Record<ArtifactKind, string>> = {
        linkedin: json.linkedinImage
          ? `data:${json.linkedinImage.mimeType};base64,${json.linkedinImage.data}`
          : undefined,
        x: json.xImage
          ? `data:${json.xImage.mimeType};base64,${json.xImage.data}`
          : undefined,
      };
      setArtifacts((prev) =>
        prev.map((a) =>
          targets.includes(a.id)
            ? {
                ...a,
                body: textByKind[a.id],
                metric: approxMetric(a.id, textByKind[a.id]),
                imageDataUrl: imageByKind[a.id],
              }
            : a,
        ),
      );
      setState({ status: "idle" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setState({ status: "error", error: message });
    } finally {
      setRunning(false);
    }
  }

  async function handleRegenerate() {
    setRunning(true);
    await generateOne(activeId);
    setRunning(false);
  }

  const isGenerating = running || state.status === "loading";

  const openComposer = (modality: Modality) => {
    setFeedback("");
    setPendingFile(null);
    if (modality === "discord" || modality === "slack") {
      setComposer({
        kind: "connector",
        modality,
        draft: {
          modality,
          token: "",
          channelId: "",
          workspace: "",
          label: "",
          limit: 50,
        },
      });
      return;
    }
    setComposer({ kind: "file", modality, label: "", text: "" });
  };

  const closeComposer = () => {
    setComposer(null);
    setPendingFile(null);
    setFeedback("");
  };

  const handleFile = (file: File | null) => {
    if (!composer || composer.kind !== "file" || composer.modality === "text" || !file) return;
    setPendingFile({ modality: composer.modality, file });
    setComposer((prev) => (prev && prev.kind === "file" ? { ...prev, label: prev.label || file.name } : prev));
  };

  const submitComposer = async () => {
    if (!composer) return;
    setAdding(true);
    setFeedback("");
    try {
      let body: Record<string, unknown>;
      if (composer.kind === "connector") {
        const draft = composer.draft;
        if (!draft.token.trim()) {
          setFeedback("bot token is required");
          setAdding(false);
          return;
        }
        if (!draft.channelId.trim()) {
          setFeedback("channel id is required");
          setAdding(false);
          return;
        }
        body = {
          kind: draft.modality,
          token: draft.token.trim(),
          channelId: draft.channelId.trim(),
          workspace: draft.workspace?.trim() || undefined,
          label: draft.label.trim() || undefined,
          limit: draft.limit,
        };
      } else if (composer.modality === "text") {
        if (!composer.text.trim()) {
          setFeedback("paste some text first");
          setAdding(false);
          return;
        }
        body = { kind: "text", label: composer.label.trim() || "Pasted note", text: composer.text };
      } else {
        if (!pendingFile) {
          setFeedback("pick a file first");
          setAdding(false);
          return;
        }
        const dataUrl = await readFileAsDataUrl(pendingFile.file);
        body = {
          kind: composer.modality,
          label: composer.label.trim() || pendingFile.file.name,
          fileName: pendingFile.file.name,
          mimeType: pendingFile.file.type,
          dataUrl,
        };
      }
      const res = await fetch("/app/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setFeedback(json.error ?? "ingest failed");
        setAdding(false);
        return;
      }
      setFeedback("added");
      await refresh();
      closeComposer();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const removeSource = async (id: string) => {
    const res = await fetch(`/app/api/sources/${id}`, { method: "DELETE" });
    if (res.ok) await refresh();
  };

  const refreshSource = async (id: string) => {
    setRefreshingId(id);
    try {
      const res = await fetch(`/app/api/sources/${id}/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFeedback(json.error ?? "refresh failed");
        return;
      }
      await refresh();
    } finally {
      setRefreshingId(null);
    }
  };

  const triggerFilePicker = () => {
    fileInputRef.current?.click();
  };

  const connectedCount = sources.filter((s) => s.status !== "error").length;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-72px)] w-full max-w-[1240px] flex-col justify-center gap-5 px-6 py-6">
      <header className="flex flex-col gap-4 border-b border-[var(--app-line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
            <Link href="/" className="transition-colors hover:text-[var(--app-ink)]">
              ← Landing
            </Link>
            <span className="text-[var(--app-line)]">/</span>
            <span>Workspace</span>
            <span className="text-[var(--app-line)]">/</span>
            <span className="text-[var(--app-ink)]">Week 32</span>
          </div>
          <h1 className="font-serif text-[1.65rem] font-medium leading-[1.02] tracking-[-0.02em] sm:text-[1.85rem]">
            Wrap the week into three drafts.
          </h1>
          <p className="max-w-xl text-[12.5px] leading-relaxed text-[var(--app-muted)]">
            {context
              ? `${context.sourceCount} source${context.sourceCount === 1 ? "" : "s"} · ${context.words} words · ${context.minutes.toFixed(1)} min ingested · drafts generated locally · nothing sent without a click.`
              : "Aug 4 – Aug 10 · drafts generated locally · nothing sent without a click."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-full border border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
            <span aria-hidden className="relative grid h-1.5 w-1.5 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--app-accent)] opacity-60" />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
            </span>
            {isGenerating ? "Generating…" : state.status === "error" ? "Error" : "Ready to run"}
          </div>
          <button
            type="button"
            onClick={handleRun}
            disabled={isGenerating}
            className="group inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-5 text-sm font-medium text-[var(--app-paper)] transition-transform hover:-translate-y-px disabled:opacity-50"
          >
            {isGenerating ? "Running…" : "Run the week"}
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3 8h10M9 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </header>

      {state.status === "error" && (
        <div
          role="alert"
          className="rounded-2xl border border-[var(--app-accent)]/40 bg-[var(--app-accent)]/5 px-4 py-3 text-[12px] text-[var(--app-ink)]"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-accent)]">Generation error</span>
          <p className="mt-1">{state.error}</p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Sources
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                {connectedCount} / {sources.length || 0}
              </span>
            </div>
            <ul className="flex flex-col">
              {sources.length === 0 && !loadingSources && (
                <li className="py-3 text-[12px] text-[var(--app-muted)]">
                  No sources yet — paste a note, drop a voice memo, add a video clip, or connect a Discord or Slack channel.
                </li>
              )}
              {sources.map((source, i) => (
                <li
                  key={source.id}
                  className={
                    "flex items-start gap-3 py-2.5 " +
                    (i !== 0 ? "border-t border-[var(--app-line)]" : "")
                  }
                >
                  <span
                    aria-hidden
                    className={
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " +
                      (source.status === "error"
                        ? "bg-[#c23a2b]"
                        : "bg-[var(--app-accent)]")
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium text-[var(--app-ink)]">
                        {source.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        {MODALITY_META[source.modality].meta}
                      </span>
                    </div>
                    <p className="truncate text-[11.5px] text-[var(--app-muted)]">
                      {describeSource(source)}
                    </p>
                    {summarizeKeyPhrases(source) && (
                      <p className="truncate text-[11px] italic text-[var(--app-muted)]">
                        {summarizeKeyPhrases(source)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {source.connector && (
                      <button
                        type="button"
                        onClick={() => refreshSource(source.id)}
                        disabled={refreshingId === source.id}
                        aria-label={`Refresh ${source.label}`}
                        className="grid h-5 w-5 place-items-center rounded-full text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)] disabled:opacity-50"
                      >
                        <svg
                          viewBox="0 0 16 16"
                          className={
                            "h-3 w-3 " + (refreshingId === source.id ? "animate-spin" : "")
                          }
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M2 8a6 6 0 0 1 10.39-4.1M14 8a6 6 0 0 1-10.39 4.1" />
                          <path d="M13 1.5v3.5h-3.5M3 14.5v-3.5h3.5" />
                        </svg>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => removeSource(source.id)}
                      className="grid h-5 w-5 place-items-center rounded-full text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)]"
                      aria-label={`Remove ${source.label}`}
                    >
                      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 3l10 10M13 3L3 13" />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {(Object.keys(MODALITY_META) as Modality[]).map((modality) => (
                <button
                  key={modality}
                  type="button"
                  onClick={() => openComposer(modality)}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full border border-[var(--app-line)] px-3 text-[12px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                  {MODALITY_META[modality].label}
                </button>
              ))}
            </div>
          </section>

          {context && context.sourceCount > 0 && (
            <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                  Ingested context
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
                  {context.tone}
                </span>
              </div>
              {context.themes.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {context.themes.map((theme) => (
                    <span
                      key={theme}
                      className="rounded-full bg-[var(--app-soft)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--app-ink)]"
                    >
                      {theme}
                    </span>
                  ))}
                </div>
              )}
              {context.bullets.length > 0 && (
                <ul className="flex flex-col gap-1 text-[11.5px] leading-snug text-[var(--app-ink)]">
                  {context.bullets.slice(0, 4).map((bullet, i) => (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--app-accent)]" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              )}
              <details className="text-[11px] text-[var(--app-muted)]">
                <summary className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.16em]">
                  Raw context for the agent
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--app-line)] bg-[var(--app-soft)] p-3 text-[11px] leading-relaxed text-[var(--app-ink)]">
                  {context.body}
                </pre>
              </details>
            </section>
          )}

          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Run size
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                1× week
              </span>
            </div>
            <div role="radiogroup" aria-label="Run size" className="flex flex-col">
              {runSizes.map((option, i) => {
                const selected = size === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSize(option.id)}
                    className={
                      "group flex items-center justify-between gap-3 py-2.5 text-left transition-colors " +
                      (i !== 0 ? "border-t border-[var(--app-line)]" : "")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={
                          "grid h-4 w-4 place-items-center rounded-full border " +
                          (selected
                            ? "border-[var(--app-ink)]"
                            : "border-[var(--app-line)] group-hover:border-[var(--app-muted)]")
                        }
                      >
                        {selected && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-ink)]" />
                        )}
                      </span>
                      <span
                        className={
                          "text-[12.5px] " +
                          (selected
                            ? "font-medium text-[var(--app-ink)]"
                            : "text-[var(--app-muted)]")
                        }
                      >
                        {option.label}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
                      {option.note}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        <section className="flex flex-col gap-4">
          <div
            role="tablist"
            aria-label="Artifacts"
            className="grid gap-2.5 sm:grid-cols-3"
          >
            {artifacts.map((artifact) => {
              const selected = artifact.id === activeId;
              return (
                <button
                  key={artifact.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveId(artifact.id)}
                  className={
                    "group relative flex flex-col items-start gap-1.5 overflow-hidden rounded-2xl border p-3 text-left transition-all " +
                    (selected
                      ? "border-[var(--app-ink)] bg-[var(--app-panel)] shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]"
                      : "border-[var(--app-line)] bg-[var(--app-panel)]/60 hover:border-[var(--app-muted)]")
                  }
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                      {artifact.handle}
                    </span>
                    <span
                      className={
                        "font-mono text-[10px] " +
                        (selected ? "text-[var(--app-ink)]" : "text-[var(--app-muted)]")
                      }
                    >
                      {artifact.metric}
                    </span>
                  </div>
                  <div className="font-serif text-[1.15rem] font-medium leading-[1.05] tracking-[-0.01em] text-[var(--app-ink)]">
                    {artifact.label}
                  </div>
                  <p className="text-[11.5px] leading-snug text-[var(--app-muted)] line-clamp-2">
                    {artifact.blurb}
                  </p>
                  <div
                    aria-hidden
                    className={
                      "mt-1 h-px w-full transition-colors " +
                      (selected ? "bg-[var(--app-accent)]" : "bg-[var(--app-line)]")
                    }
                  />
                </button>
              );
            })}
          </div>

          <article className="flex flex-col overflow-hidden rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-line)] px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid h-6 w-6 place-items-center rounded-md bg-[var(--app-ink)] text-[var(--app-paper)]"
                >
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 4h12M2 8h8M2 12h12" />
                  </svg>
                </span>
                <div className="flex flex-col">
                  <span className="text-[12.5px] font-medium text-[var(--app-ink)]">
                    {active.label} draft
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    {active.tone} · {active.metric}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isGenerating}
                  className="inline-flex h-7 items-center justify-center rounded-full border border-[var(--app-line)] px-3 text-[11.5px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)] disabled:opacity-50"
                >
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      void navigator.clipboard.writeText(active.body);
                    }
                  }}
                  className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-[var(--app-ink)] px-3 text-[11.5px] font-medium text-[var(--app-paper)] transition-transform hover:-translate-y-px"
                >
                  Copy
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A.5.5 0 0 1 3.5 3H11" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="grid gap-4 px-5 py-5 sm:px-6 sm:py-6">
              {active.imageDataUrl && (
                <div className="overflow-hidden rounded-xl border border-[var(--app-line)]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={active.imageDataUrl}
                    alt={`${active.label} generated image`}
                    className="block w-full"
                  />
                </div>
              )}
              <p className="whitespace-pre-wrap font-serif text-[1.05rem] leading-[1.45] text-[var(--app-ink)] sm:text-[1.15rem]">
                {active.body}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--app-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                <span>Source · week 32</span>
                <span className="text-[var(--app-line)]">·</span>
                <span>Voice · {active.tone.toLowerCase()}</span>
                <span className="text-[var(--app-line)]">·</span>
                <span>Length · {active.metric}</span>
                {context && context.sourceCount > 0 && (
                  <>
                    <span className="text-[var(--app-line)]">·</span>
                    <span>Context · {context.sourceCount} source{context.sourceCount === 1 ? "" : "s"}</span>
                  </>
                )}
              </div>
            </div>
          </article>

          <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-[var(--app-line)] bg-[var(--app-panel)]/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-full border border-[var(--app-line)] text-[var(--app-muted)]"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 3v10M3 8h10" />
                </svg>
              </span>
              <p className="text-[11.5px] leading-snug text-[var(--app-muted)]">
                Drop a new voice note, paste a doc, connect a Discord or Slack channel, or regenerate any single draft without rerunning the week.
              </p>
            </div>
            <Link
              href="/"
              className="inline-flex h-7 items-center justify-center rounded-full px-3 text-[11.5px] font-medium text-[var(--app-ink)] underline-offset-4 hover:underline"
            >
              Back to overview
            </Link>
          </div>
        </section>
      </div>

      {composer && (
        <div
          className="fixed inset-0 z-30 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`Add ${composer.kind === "connector" ? MODALITY_META[composer.modality].label : MODALITY_META[composer.modality].label} source`}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeComposer();
          }}
        >
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-5 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.4)]">
            <div className="flex items-center justify-between">
              <h3 className="font-serif text-[1.15rem] font-medium tracking-[-0.01em] text-[var(--app-ink)]">
                Add {composer.kind === "connector" ? MODALITY_META[composer.modality].label : MODALITY_META[composer.modality].label}
              </h3>
              <button
                type="button"
                onClick={closeComposer}
                className="grid h-7 w-7 place-items-center rounded-full text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)]"
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>

            {composer.kind === "connector" ? (
              <>
                <p className="text-[11.5px] leading-snug text-[var(--app-muted)]">
                  {MODALITY_META[composer.modality].help}
                </p>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    Label
                  </span>
                  <input
                    value={composer.draft.label}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev && prev.kind === "connector"
                          ? { ...prev, draft: { ...prev.draft, label: event.target.value } }
                          : prev,
                      )
                    }
                    placeholder={
                      composer.draft.modality === "discord"
                        ? "Discord · #shipping"
                        : "Slack · #eng-weekly"
                    }
                    className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 text-[13px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    {composer.draft.modality === "discord" ? "Bot token" : "Bot token (xoxb-…)"}
                  </span>
                  <input
                    type="password"
                    value={composer.draft.token}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev && prev.kind === "connector"
                          ? { ...prev, draft: { ...prev.draft, token: event.target.value } }
                          : prev,
                      )
                    }
                    placeholder={composer.draft.modality === "discord" ? "MTI0NTY3…" : "xoxb-…"}
                    autoComplete="off"
                    className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12.5px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    Channel id
                  </span>
                  <input
                    value={composer.draft.channelId}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev && prev.kind === "connector"
                          ? { ...prev, draft: { ...prev.draft, channelId: event.target.value } }
                          : prev,
                      )
                    }
                    placeholder={composer.draft.modality === "discord" ? "123456789012345678" : "C0123ABCD"}
                    className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12.5px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                  />
                </label>
                {composer.draft.modality === "slack" && (
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                      Workspace <span className="text-[var(--app-muted)]/70 normal-case tracking-normal">(optional)</span>
                    </span>
                    <input
                      value={composer.draft.workspace ?? ""}
                      onChange={(event) =>
                        setComposer((prev) =>
                          prev && prev.kind === "connector"
                            ? { ...prev, draft: { ...prev.draft, workspace: event.target.value } }
                            : prev,
                        )
                      }
                      placeholder="acme-co"
                      className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 text-[13px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                    />
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    Messages to pull
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={composer.draft.limit}
                    onChange={(event) =>
                      setComposer((prev) =>
                        prev && prev.kind === "connector"
                          ? {
                              ...prev,
                              draft: {
                                ...prev.draft,
                                limit: Math.max(1, Math.min(200, Number(event.target.value) || 1)),
                              },
                            }
                          : prev,
                      )
                    }
                    className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12.5px] text-[var(--app-ink)] outline-none transition-colors focus:border-[var(--app-ink)]"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                    Label
                  </span>
                  <input
                    value={composer.label}
                    onChange={(event) => setComposer({ ...composer, label: event.target.value })}
                    placeholder={composer.modality === "text" ? "Brief, kickoff notes, sponsor email…" : "Voice memo, demo recording…"}
                    className="h-10 rounded-xl border border-[var(--app-line)] bg-transparent px-3 text-[13px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                  />
                </label>

                {composer.modality === "text" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                      Text
                    </span>
                    <textarea
                      value={composer.text}
                      onChange={(event) => setComposer({ ...composer, text: event.target.value })}
                      placeholder={MODALITY_META.text.placeholder}
                      rows={8}
                      className="resize-y rounded-xl border border-[var(--app-line)] bg-transparent p-3 text-[13px] leading-relaxed text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-muted)] focus:border-[var(--app-ink)]"
                    />
                  </label>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                      File
                    </span>
                    <button
                      type="button"
                      onClick={triggerFilePicker}
                      className="flex flex-col items-start gap-1 rounded-xl border border-dashed border-[var(--app-line)] bg-[var(--app-soft)]/60 px-4 py-5 text-left transition-colors hover:border-[var(--app-ink)]"
                    >
                      <span className="text-[13px] font-medium text-[var(--app-ink)]">
                        {pendingFile ? pendingFile.file.name : MODALITY_META[composer.modality].placeholder}
                      </span>
                      <span className="text-[11px] text-[var(--app-muted)]">
                        {pendingFile
                          ? `${formatBytes(pendingFile.file.size)} · ${pendingFile.file.type || "unknown"}`
                          : "Click to pick a file from your computer"}
                      </span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={MODALITY_META[composer.modality].accept}
                      className="hidden"
                      onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
                    />
                  </div>
                )}
              </>
            )}

            {feedback && (
              <p
                className={
                  "text-[11.5px] " +
                  (feedback === "added" ? "text-[var(--positive)]" : "text-[#c23a2b]")
                }
              >
                {feedback === "added" ? "Added to your sources." : feedback}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeComposer}
                className="inline-flex h-9 items-center justify-center rounded-full border border-[var(--app-line)] px-4 text-[12px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitComposer}
                disabled={adding}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-4 text-[12px] font-medium text-[var(--app-paper)] transition-transform hover:-translate-y-px disabled:opacity-50"
              >
                {adding ? "Connecting…" : composer.kind === "connector" ? "Connect" : "Ingest"}
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
