"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NewsletterPreview } from "./_components/NewsletterPreview";
import { LinkedInPreview } from "./_components/LinkedInPreview";
import { XPreview } from "./_components/XPreview";

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
  generated?: boolean;
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

const MODALITY_META: Record<Modality, { label: string; meta: string; placeholder: string; accept?: string; help: string; icon: string }> = {
  text: {
    label: "Note",
    meta: "text",
    placeholder: "Paste notes, a doc, a brief…",
    help: "Drop text in. We normalize, extract themes, and surface key phrases.",
    icon: "M4 4h12v12H4zM4 7h12M4 11h8",
  },
  audio: {
    label: "Voice",
    meta: "audio",
    placeholder: "Drop an .mp3, .m4a, .wav…",
    accept: "audio/*",
    help: "Whisper transcribes audio when OPENAI_API_KEY is set; otherwise a deterministic mock is used.",
    icon: "M5 9v6h2l3 3V6L7 9H5zM13 8a3 3 0 0 1 0 8M15 5a7 7 0 0 1 0 14",
  },
  video: {
    label: "Video",
    meta: "video",
    placeholder: "Drop an .mp4, .mov, .webm…",
    accept: "video/*",
    help: "Frames are extracted and stitched into a transcript alongside any audio track.",
    icon: "M3 5h10v10H3zM13 8l4-2v8l-4-2",
  },
  discord: {
    label: "Discord",
    meta: "discord",
    placeholder: "Channel ID + bot token",
    help: "Add a bot token and channel id. The bot must be a member of the channel. We pull the latest 50 messages by default.",
    icon: "M7 8a2 2 0 1 0 0 .01M13 8a2 2 0 1 0 0 .01M5 6l-1 9a8 8 0 0 0 4 1.5M19 6l1 9a8 8 0 0 1-4 1.5M5 6l1-2c1 .5 2 1 4 1s3-.5 4-1l1 2",
  },
  slack: {
    label: "Slack",
    meta: "slack",
    placeholder: "Channel ID + bot token",
    help: "Add a bot token (xoxb-…) and channel id. The bot must be invited to the channel. We pull the latest 50 messages by default.",
    icon: "M5 9h2v2H5zM9 5h2v6H9zM13 13h2v6h-2zM13 9h6v2h-6z",
  },
};

type SourceConfig = {
  github: string;
  writingSamples: string[];
  mood: string;
};

const MOOD_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "default", label: "Default", hint: "Neutral, professional voice" },
  { id: "Calm and measured", label: "Calm", hint: "Short sentences, no hype" },
  { id: "Warm and personal", label: "Warm", hint: "First-person, direct" },
  { id: "Direct and punchy", label: "Direct", hint: "Leads with the news" },
  { id: "Witty and a bit dry", label: "Witty", hint: "Light, subtle humor" },
  { id: "Playful and energetic", label: "Playful", hint: "Enthusiastic, not breathless" },
  { id: "Technical and matter-of-fact", label: "Technical", hint: "Engineer-coded, file-level" },
  { id: "Visionary and forward-looking", label: "Visionary", hint: "Frames a longer arc" },
];

const initialArtifacts: Artifact[] = [
  {
    id: "newsletter",
    label: "Newsletter",
    handle: "For sponsors",
    blurb: "A sourced note your partners can read in 90 seconds.",
    body:
      "This week we shipped a faster ingest path (4x), closed two long-standing integration gaps, and softened the digest tone. Next up: a calmer mobile view, a sponsor-only changelog, and a quiet month-end recap.",
    metric: "ready to generate",
    tone: "Calm, partner-facing",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    handle: "For partners in feed",
    blurb: "A single-paragraph post with the headline and the receipt.",
    body: "Click generate to draft this from the week's source data.",
    metric: "ready to generate",
    tone: "Direct, status-forward",
  },
  {
    id: "x",
    label: "X post",
    handle: "For engineers in replies",
    blurb: "A short, slightly opinionated note worth a bookmark.",
    body: "Click generate to draft this from the week's source data.",
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
  if (source.status === "ingesting") return `ingesting…`;
  if (source.status === "error") return source.errorMessage ?? "failed";
  if (source.modality === "text") {
    return source.transcriptPreview ? `${source.transcriptPreview.split(/\s+/).filter(Boolean).length} words` : "empty";
  }
  if (source.modality === "discord" || source.modality === "slack") {
    const channel = source.connector?.channelName ? `#${source.connector.channelName}` : "channel";
    const msgs = source.connector?.lastMessageCount;
    const fetched = formatTimestamp(source.connector?.lastFetchedAt);
    const parts = [
      channel,
      source.connector?.workspace ?? "",
      msgs ? `${msgs} msgs` : null,
      fetched ? `synced ${fetched}` : null,
    ].filter(Boolean);
    return parts.join(" · ");
  }
  return formatDuration(source.durationMs) || "—";
}

const ENDPOINT_BY_KIND: Record<ArtifactKind, string> = {
  newsletter: "/api/generate/newsletter",
  linkedin: "/api/generate/linkedin",
  x: "/api/generate/x",
};

const LABEL_BY_KIND: Record<ArtifactKind, string> = {
  newsletter: "newsletter",
  linkedin: "LinkedIn post",
  x: "X post",
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
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState<{ url: string; text: string } | null>(null);
  const [postError, setPostError] = useState<string>("");
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState<{ id: string; to: string[]; subject: string } | null>(null);
  const [emailError, setEmailError] = useState<string>("");
  const [targets, setTargets] = useState<Set<ArtifactKind>>(
    new Set<ArtifactKind>(["newsletter", "linkedin", "x"]),
  );
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
  const [progress, setProgress] = useState<
    | {
        step: number;
        steps: number;
        artifactIndex: number;
        artifactTotal: number;
        artifactLabel: string;
        stepLabel: string;
      }
    | null
  >(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [sourceConfig, setSourceConfig] = useState<SourceConfig>({
    github: "https://github.com/AndrxwWxng/ef-hackathon",
    writingSamples: [
      "We shipped a faster ingest path (4x), closed two long-standing integration gaps, and softened the digest tone.",
    ],
    mood: "Calm and measured",
  });

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

  const writtenSamples = sourceConfig.writingSamples.filter((s) => s.trim().length > 0);

  const payloadBody = JSON.stringify({
    repoUrl: sourceConfig.github,
    mood: sourceConfig.mood === "default" ? undefined : sourceConfig.mood,
    writingSamples: writtenSamples,
  });

  const githubDisplay = sourceConfig.github.trim().length > 0
    ? sourceConfig.github.trim()
    : "owner/repo";

  const sourceWordLabel = context ? `${context.words.toLocaleString()} words` : "—";
  const sourceCountLabel = context ? `${context.sourceCount}` : "0";
  const [repoAge, setRepoAge] = useState<{ createdAt: string; weeks: number } | null>(null);

  useEffect(() => {
    const repoUrl = sourceConfig.github.trim();
    if (!repoUrl) return;
    const now = Date.now();
    let cancelled = false;
    const controller = new AbortController();
    fetch(`/app/api/repo-age?repoUrl=${encodeURIComponent(repoUrl)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((json: { createdAt?: string }) => {
        if (cancelled || !json.createdAt) return;
        const created = new Date(json.createdAt);
        if (Number.isNaN(created.getTime())) return;
        const weeks = Math.max(0, Math.floor((now - created.getTime()) / (7 * 86_400_000)));
        setRepoAge({ createdAt: json.createdAt, weeks });
      })
      .catch(() => {
        /* leave previous value in place on failure */
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [sourceConfig.github]);

  const weekLabel = useMemo(() => {
    if (!repoAge) return "Week —";
    const created = new Date(repoAge.createdAt);
    if (Number.isNaN(created.getTime())) return "Week —";
    const sinceFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
    return `Week ${repoAge.weeks} · since ${sinceFmt.format(created)}`;
  }, [repoAge]);

  async function generateOne(kind: ArtifactKind, imageAfter: boolean): Promise<void> {
    setState({ status: "loading" });
    try {
      const textRes = await fetch(ENDPOINT_BY_KIND[kind], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadBody,
      });
      if (!textRes.ok) {
        const errBody = (await textRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `text request failed (${textRes.status})`);
      }
      const textJson = (await textRes.json()) as { text: string };
      let imageDataUrl: string | undefined;
      if (imageAfter) {
        const imgRes = await fetch("/api/generate/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, repoUrl: sourceConfig.github }),
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
              generated: true,
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
    if (targets.size === 0) {
      setState({ status: "error", error: "Pick at least one artifact to generate." });
      return;
    }
    setRunning(true);
    setState({ status: "loading" });
    setFeedback("");

    const order: ArtifactKind[] = ["newsletter", "linkedin", "x"];
    const queue = order.filter((t) => targets.has(t));
    const artifactTotal = queue.length;

    type Step = { kind: ArtifactKind; phase: "read" | "draft" | "image" };
    const plan: Step[] = [];
    for (const kind of queue) {
      plan.push({ kind, phase: "read" });
      plan.push({ kind, phase: "draft" });
      if (kind === "linkedin" || kind === "x") plan.push({ kind, phase: "image" });
    }
    const stepsTotal = plan.length;
    let stepCursor = 0;
    let currentArtifactIndex = 0;

    setProgress({
      step: 0,
      steps: stepsTotal,
      artifactIndex: 0,
      artifactTotal,
      artifactLabel: LABEL_BY_KIND[queue[0]],
      stepLabel: "Starting run",
    });

    for (const step of plan) {
      if (queue.indexOf(step.kind) !== currentArtifactIndex) {
        currentArtifactIndex = queue.indexOf(step.kind);
      }
      const artifactLabel = LABEL_BY_KIND[step.kind];
      const stepLabel =
        step.phase === "read"
          ? `Reading ${artifactLabel} repo history`
          : step.phase === "draft"
            ? `Writing ${artifactLabel} draft`
            : `Rendering ${artifactLabel} image`;

      setProgress((p) =>
        p
          ? {
              ...p,
              artifactIndex: currentArtifactIndex,
              artifactLabel,
              step: stepCursor,
              stepLabel,
            }
          : p,
      );

      if (step.phase === "draft") {
        const hasImageStep = plan.some(
          (s) => s.kind === step.kind && s.phase === "image",
        );
        await generateOne(step.kind, hasImageStep);
      } else {
        // "read" and "image" phases don't have a dedicated client-side call —
        // they happen server-side as part of generateOne, but we tick the
        // cursor so the bar visibly advances between draft and image phases.
      }

      stepCursor += 1;
      setProgress((p) => (p ? { ...p, step: stepCursor } : p));
    }

    setProgress((p) =>
      p
        ? {
            ...p,
            step: p.steps,
            stepLabel: `Done · ${artifactTotal} draft${artifactTotal === 1 ? "" : "s"}`,
          }
        : p,
    );
    setRunning(false);
    setState({ status: "idle" });
    window.setTimeout(() => setProgress(null), 1200);
  }

  function selectTab(kind: ArtifactKind) {
    setActiveId(kind);
    setTargets((prev) => {
      if (prev.has(kind)) return prev;
      const next = new Set(prev);
      next.add(kind);
      return next;
    });
    setEmailSent(null);
    setEmailError("");
  }
    function toggleTarget(kind: ArtifactKind) {
      setTargets((prev) => {
        const next = new Set(prev);
        if (next.has(kind)) next.delete(kind);
        else next.add(kind);
        return next;
      });
    }

    function updateSample(idx: number, value: string) {
      setSourceConfig((prev) => {
        const samples = [...prev.writingSamples];
        samples[idx] = value;
        return { ...prev, writingSamples: samples };
      });
    }

    function addSample() {
      setSourceConfig((prev) => ({
        ...prev,
        writingSamples: [...prev.writingSamples, ""],
      }));
    }

    function removeSample(idx: number) {
      setSourceConfig((prev) => ({
        ...prev,
        writingSamples: prev.writingSamples.filter((_, i) => i !== idx),
      }));
    }

    async function handleSendEmail() {
      if (active.id !== "newsletter") return;
      const markdown = active.body;
      if (!markdown.trim()) {
        setEmailError("Newsletter body is empty.");
        return;
      }
      setSendingEmail(true);
      setEmailError("");
      setEmailSent(null);
      try {
        const res = await fetch("/app/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: markdown,
            author: authorForKind(active.id),
            week: githubDisplay,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          id?: string;
          to?: string[];
          subject?: string;
          error?: string;
        };
        if (!res.ok || !json.id) {
          setEmailError(json.error ?? `Send failed (${res.status})`);
          return;
        }
        setEmailSent({
          id: json.id,
          to: json.to ?? [],
          subject: json.subject ?? "",
        });
      } catch (err) {
        setEmailError(err instanceof Error ? err.message : String(err));
      } finally {
        setSendingEmail(false);
      }
    }

    async function handlePostToX() {
      const text = "Hello world!";
      setPosting(true);
      setPostError("");
      setPosted(null);
      try {
        const res = await fetch("/app/api/x/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; url?: string; text?: string };
        if (!res.ok || !json.url) {
          setPostError(json.error ?? `Post failed (${res.status})`);
          return;
        }
        setPosted({ url: json.url, text: json.text ?? text });
      } catch (err) {
        setPostError(err instanceof Error ? err.message : String(err));
      } finally {
        setPosting(false);
      }
    }

    async function handleRegenerate() {
      setEmailSent(null);
      setEmailError("");
      setRunning(true);
      const label = LABEL_BY_KIND[activeId];
      const hasImage = activeId === "linkedin" || activeId === "x";
      const steps = hasImage ? 2 : 1;
      setProgress({
        step: 0,
        steps,
        artifactIndex: 0,
        artifactTotal: 1,
        artifactLabel: label,
        stepLabel: `Re-reading ${label} repo history`,
      });
      await generateOne(activeId, hasImage);
      setProgress({
        step: steps,
        steps,
        artifactIndex: 0,
        artifactTotal: 1,
        artifactLabel: label,
        stepLabel: "Done",
      });
      setRunning(false);
      window.setTimeout(() => setProgress(null), 1200);
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
  const activeMood = MOOD_OPTIONS.find((m) => m.id === sourceConfig.mood);

  return (
    <div className="mx-auto flex h-[calc(100vh-45px)] w-full max-w-[1600px] flex-col gap-4 overflow-hidden px-3 py-4 sm:px-5 lg:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
            <span>Workspace</span>
            <span className="text-[var(--app-line)]">·</span>
            <span>{sourceCountLabel} source{context?.sourceCount === 1 ? "" : "s"}</span>
            <span className="text-[var(--app-line)]">·</span>
            <span>{sourceWordLabel}</span>
          </div>
          <h1 className="font-serif text-[1.4rem] font-medium leading-[1.05] tracking-[-0.02em] text-[var(--app-ink)] sm:text-[1.55rem]">
            {weekLabel}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-[var(--app-muted)]">
            <span
              aria-hidden
              className={
                "h-1.5 w-1.5 rounded-full " +
                (isGenerating
                  ? "bg-amber-500 animate-pulse"
                  : state.status === "error"
                    ? "bg-red-500"
                    : "bg-emerald-500")
              }
            />
            {isGenerating ? "Generating" : state.status === "error" ? "Error" : "Ready"}
          </div>
          <button
            type="button"
            onClick={handleRun}
            disabled={isGenerating || targets.size === 0}
            className="group inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-4 text-[13px] font-medium text-[var(--app-paper)] transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SparkIcon className="h-3.5 w-3.5" />
            {isGenerating ? "Running…" : "Run the week"}
          </button>
        </div>
      </div>

      {state.status === "error" && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12.5px] text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          <span className="font-mono text-[10px] uppercase tracking-[0.12em]">Error</span>
          <span className="ml-2">{state.error}</span>
        </div>
      )}

      {progress && (
        <div
          role="progressbar"
          aria-valuenow={progress.step}
          aria-valuemin={0}
          aria-valuemax={progress.steps}
          className="flex items-center gap-3 rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] px-4 py-2.5"
        >
          <span
            aria-hidden
            className={
              "h-1.5 w-1.5 shrink-0 rounded-full " +
              (progress.step >= progress.steps ? "bg-emerald-500" : "bg-amber-500 animate-pulse")
            }
          />
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--app-soft)]">
            <div
              className="h-full rounded-full bg-[var(--app-ink)] transition-[width] duration-300 ease-out"
              style={{
                width: `${progress.steps === 0 ? 0 : (progress.step / progress.steps) * 100}%`,
              }}
            />
          </div>
          <span className="shrink-0 font-mono text-[11px] text-[var(--app-muted)] tabular-nums">
            {progress.artifactLabel} · {progress.artifactIndex + 1}/{progress.artifactTotal} · {progress.stepLabel}
          </span>
        </div>
      )}

      {/* Main grid */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Sidebar */}
        <aside
          className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1"
          style={isDesktop ? { width: `${sidebarWidth}px`, flexShrink: 0 } : undefined}
        >
          {/* Sources */}
          <section className="flex flex-col rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)]">
            <div className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3">
              <h2 className="text-[12px] font-medium text-[var(--app-ink)]">Sources</h2>
              <span className="font-mono text-[10.5px] text-[var(--app-muted)]">
                {connectedCount}/{sources.length || 0}
              </span>
            </div>

            <ul className="flex flex-col">
              {sources.length === 0 && !loadingSources && (
                <li className="px-4 py-4 text-[12px] leading-relaxed text-[var(--app-muted)]">
                  No sources yet. Add a note, drop a voice memo, or connect a channel.
                </li>
              )}
              {sources.map((source, i) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  showBorder={i !== 0}
                  refreshing={refreshingId === source.id}
                  onRefresh={() => refreshSource(source.id)}
                  onRemove={() => removeSource(source.id)}
                />
              ))}
            </ul>

            <div className="flex flex-wrap gap-1.5 border-t border-[var(--app-line)] px-4 py-3">
              {(Object.keys(MODALITY_META) as Modality[]).map((modality) => (
                <button
                  key={modality}
                  type="button"
                  onClick={() => openComposer(modality)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
                >
                  <PlusIcon className="h-3 w-3 text-[var(--app-muted)]" />
                  {MODALITY_META[modality].label}
                </button>
              ))}
            </div>
          </section>

          {/* Configuration */}
          <section className="flex flex-col rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)]">
            <button
              type="button"
              onClick={() => setConfigOpen((p) => !p)}
              className="flex items-center justify-between border-b border-[var(--app-line)] px-4 py-3 text-left"
              aria-expanded={configOpen}
            >
              <h2 className="text-[12px] font-medium text-[var(--app-ink)]">Configuration</h2>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10.5px] text-[var(--app-muted)]">
                  {activeMood?.label ?? "Default"}
                </span>
                <ChevronIcon className={"h-3 w-3 text-[var(--app-muted)] transition-transform " + (configOpen ? "rotate-180" : "")} />
              </div>
            </button>

            {configOpen && (
              <div className="flex flex-col gap-4 px-4 py-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    GitHub repo
                  </label>
                  <input
                    type="text"
                    value={sourceConfig.github}
                    onChange={(event) =>
                      setSourceConfig((prev) => ({ ...prev, github: event.target.value }))
                    }
                    placeholder="owner/repo"
                    className="h-8 w-full rounded-md border border-[var(--app-line)] bg-transparent px-2.5 font-mono text-[12px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      Mood
                    </label>
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {MOOD_OPTIONS.map((m) => {
                      const selected = sourceConfig.mood === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setSourceConfig((prev) => ({ ...prev, mood: m.id }))
                          }
                          aria-pressed={selected}
                          title={m.hint}
                          className={
                            "rounded-md border px-2 py-1.5 text-[11px] font-medium transition-colors " +
                            (selected
                              ? "border-[var(--app-ink)] bg-[var(--app-ink)] text-[var(--app-paper)]"
                              : "border-[var(--app-line)] bg-transparent text-[var(--app-ink)] hover:border-[var(--app-muted)]")
                          }
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      Writing samples
                    </label>
                    <button
                      type="button"
                      onClick={addSample}
                      className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
                    >
                      + add
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {sourceConfig.writingSamples.map((sample, idx) => (
                      <div key={`sample-${idx}`} className="flex flex-col gap-1">
                        <textarea
                          rows={5}
                          value={sample}
                          onChange={(event) => updateSample(idx, event.target.value)}
                          placeholder="Paste an example post…the model reads samples to calibrate voice."
                          className="w-full resize-none rounded-lg border border-[var(--app-line)] bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
                        />
                        {sourceConfig.writingSamples.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeSample(idx)}
                            className="self-end font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
                          >
                            remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Context summary (when sources exist) */}
          {context && context.sourceCount > 0 && (
            <section className="flex flex-col rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
              <h2 className="text-[12px] font-medium text-[var(--app-ink)]">This week</h2>
              <div className="mt-3 flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-2">
                  <Stat label="Sources" value={context.sourceCount.toString()} />
                  <Stat label="Words" value={context.words.toLocaleString()} />
                  <Stat label="Minutes" value={context.minutes.toFixed(1)} />
                </div>
                {context.themes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {context.themes.slice(0, 6).map((theme) => (
                      <span
                        key={theme}
                        className="rounded-full bg-[var(--app-soft)] px-2 py-0.5 text-[10.5px] text-[var(--app-ink)]"
                      >
                        {theme}
                      </span>
                    ))}
                  </div>
                )}
                {context.bullets.length > 0 && (
                  <ul className="flex flex-col gap-1.5 text-[11.5px] leading-relaxed text-[var(--app-ink)]">
                    {context.bullets.slice(0, 3).map((bullet, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-[var(--app-ink)]" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </aside>

        {/* Main content */}
        <section className="flex min-h-0 min-w-0 flex-col gap-3">
          {/* Artifact tabs */}
          <div role="tablist" aria-label="Artifacts" className="flex items-center gap-1 rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] p-1">
            {artifacts.map((artifact) => {
              const selected = artifact.id === activeId;
              const enabled = targets.has(artifact.id);
              return (
                <div
                  key={artifact.id}
                  role="tab"
                  aria-selected={selected}
                  className={
                    "group relative flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-left transition-colors " +
                    (selected
                      ? "bg-[var(--app-ink)] text-[var(--app-paper)]"
                      : "text-[var(--app-ink)] hover:bg-[var(--app-soft)]")
                  }
                  onClick={() => selectTab(artifact.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectTab(artifact.id);
                    }
                  }}
                  tabIndex={0}
                >
                  <div className="flex flex-col">
                    <span className="text-[13px] font-medium">{artifact.label}</span>
                    <span
                      className={
                        "font-mono text-[10px] uppercase tracking-[0.12em] " +
                        (selected ? "text-[var(--app-paper)]/60" : "text-[var(--app-muted)]")
                      }
                    >
                      {artifact.handle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "font-mono text-[10.5px] " +
                        (selected ? "text-[var(--app-paper)]/70" : "text-[var(--app-muted)]")
                      }
                    >
                      {artifact.metric}
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={enabled}
                      aria-label={`${enabled ? "Exclude" : "Include"} ${artifact.label} from the run`}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleTarget(artifact.id);
                      }}
                      className={
                        "grid h-4 w-4 place-items-center rounded-full border transition-colors " +
                        (enabled
                          ? selected
                            ? "border-[var(--app-paper)] bg-[var(--app-paper)] text-[var(--app-ink)]"
                            : "border-[var(--app-ink)] bg-[var(--app-ink)] text-[var(--app-paper)]"
                          : selected
                            ? "border-[var(--app-paper)]/40"
                            : "border-[var(--app-line)]")
                      }
                    >
                      {enabled && <TickIcon className="h-2.5 w-2.5" />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Preview card */}
          <article className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-line)] px-4 py-2.5">
              <div className="flex items-center gap-3">
                <ChannelBadge kind={active.id} />
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium text-[var(--app-ink)]">
                    {active.label} draft
                  </span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                    {active.tone} · {active.metric}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={isGenerating || !targets.has(active.id)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--app-line)] px-3 text-[12px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshIcon className="h-3 w-3" />
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      void navigator.clipboard.writeText(active.body);
                    }
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--app-ink)] px-3 text-[12px] font-medium text-[var(--app-paper)] transition-opacity hover:opacity-90"
                >
                  <CopyIcon className="h-3 w-3" />
                  Copy
                </button>
                {active.id === "newsletter" && (
                  <button
                    type="button"
                    onClick={handleSendEmail}
                    disabled={sendingEmail || isGenerating || !active.generated}
                    title={
                      active.generated
                        ? "Send this newsletter as an HTML email via Resend"
                        : "Generate a draft first"
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SendIcon className="h-3 w-3" />
                    {sendingEmail ? "Sending…" : emailSent ? "Sent" : "Send via Email"}
                  </button>
                )}
                {active.id === "x" && (
                  <button
                    type="button"
                    onClick={handlePostToX}
                    disabled={posting || isGenerating}
                    title="Post 'Hello world!' to X"
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#1d9bf0] px-3 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <SiXIcon className="h-3 w-3" />
                    {posting ? "Posting…" : posted ? "Posted" : "Post to X"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-[var(--app-soft)] px-4 py-6 sm:px-8 sm:py-8">
              <ChannelPreview
                artifact={active}
                githubDisplay={githubDisplay}
                authorName={authorForKind(active.id)}
                authorTitle={titleForKind(active.id)}
              />
              {!active.generated && (
                <p className="mt-4 text-center font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                  Click Run the week to generate a draft.
                </p>
              )}
              {active.id === "newsletter" && (emailSent || emailError) && (
                <div
                  className={
                    "mx-auto mt-3 max-w-md rounded-lg border px-3 py-2 text-[12px] " +
                    (emailError
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400")
                  }
                  role={emailError ? "alert" : "status"}
                >
                  {emailError ? (
                    <span>Send failed: {emailError}</span>
                  ) : emailSent ? (
                    <span>
                      Sent to {emailSent.to.join(", ")}.{` `}
                      <span className="font-mono text-[11px] opacity-80">id: {emailSent.id}</span>
                    </span>
                  ) : null}
                </div>
              )}
              {active.id === "x" && (posted || postError) && (
                <div
                  className={
                    "mx-auto mt-3 max-w-md rounded-lg border px-3 py-2 text-[12px] " +
                    (postError
                      ? "border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
                      : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-400")
                  }
                  role={postError ? "alert" : "status"}
                >
                  {postError ? (
                    <span>Post failed: {postError}</span>
                  ) : posted ? (
                    <span>
                      Posted to X.{" "}
                      <a
                        href={posted.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono underline underline-offset-2"
                      >
                        View on X ↗
                      </a>
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--app-line)] px-4 py-2 text-[11px] text-[var(--app-muted)]">
              <span className="font-mono uppercase tracking-[0.12em] text-[10.5px]">Source</span>
              <span>{githubDisplay}</span>
              <span className="text-[var(--app-line)]">·</span>
              <span>{sourceConfig.mood === "default" ? "Default tone" : sourceConfig.mood}</span>
              <span className="text-[var(--app-line)]">·</span>
              <span>{writtenSamples.length} sample{writtenSamples.length === 1 ? "" : "s"}</span>
              {context && context.sourceCount > 0 && (
                <>
                  <span className="text-[var(--app-line)]">·</span>
                  <span>{context.sourceCount} ingested</span>
                </>
              )}
              <span className="ml-auto font-mono uppercase tracking-[0.12em] text-[10.5px]">
                {active.metric}
              </span>
            </div>
          </article>
        </section>

        <PipelinePanel
          stages={stages}
          logs={logLines}
          running={running}
          hasRun={hasRun}
          error={pipelineError}
          targets={Array.from(targets)}
          onClear={() => {
            setLogLines([]);
            setStages([]);
            setHasRun(false);
            setPipelineError(null);
          }}
        />
      </div>

      {composer && (
        <Composer
          composer={composer}
          adding={adding}
          feedback={feedback}
          fileInputRef={fileInputRef}
          onClose={closeComposer}
          onChange={setComposer}
          onFile={handleFile}
          onPickFile={triggerFilePicker}
          onSubmit={submitComposer}
        />
      )}
    </div>
  );
}

function authorForKind(kind: ArtifactKind): string {
  if (kind === "newsletter") return "Multimail Team";
  if (kind === "linkedin") return "M. Kapoor";
  return "multimail";
}

function titleForKind(kind: ArtifactKind): string {
  if (kind === "newsletter") return "Multimail · weekly";
  if (kind === "linkedin") return "Founder · Multimail · weekly build notes";
  return "· engineering at Multimail";
}

function SourceRow({
  source,
  showBorder,
  refreshing,
  onRefresh,
  onRemove,
}: {
  source: Source;
  showBorder: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const meta = MODALITY_META[source.modality];
  return (
    <li
      className={
        "group flex items-start gap-2.5 px-4 py-2.5 " +
        (showBorder ? "border-t border-[var(--app-line)]" : "")
      }
    >
      <span
        aria-hidden
        className={
          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full " +
          (source.status === "error" ? "bg-red-500" : "bg-emerald-500")
        }
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[12.5px] font-medium text-[var(--app-ink)]">
          {source.label}
        </span>
        <span className="truncate text-[11px] text-[var(--app-muted)]">
          {meta.label} · {describeSource(source)}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {source.connector && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={`Refresh ${source.label}`}
            className="grid h-6 w-6 place-items-center rounded text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)] disabled:opacity-50"
          >
            <RefreshIcon className={"h-3 w-3 " + (refreshing ? "animate-spin" : "")} />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${source.label}`}
          className="grid h-6 w-6 place-items-center rounded text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)]"
        >
          <XIcon className="h-3 w-3" />
        </button>
      </div>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-[var(--app-soft)] px-2.5 py-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
        {label}
      </span>
      <span className="text-[14px] font-medium tabular-nums text-[var(--app-ink)]">{value}</span>
    </div>
  );
}

function ChannelBadge({ kind }: { kind: ArtifactKind }) {
  const config: Record<ArtifactKind, { label: string; className: string }> = {
    newsletter: {
      label: "Email",
      className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    },
    linkedin: {
      label: "LinkedIn",
      className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    },
    x: {
      label: "X",
      className: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-300",
    },
  };
  const c = config[kind];
  return (
    <span className={"rounded-full px-2 py-0.5 text-[10.5px] font-medium " + c.className}>
      {c.label}
    </span>
  );
}

function ChannelPreview({
  artifact,
  githubDisplay,
  authorName,
  authorTitle,
}: {
  artifact: Artifact;
  authorName?: string;
  authorTitle?: string;
  githubDisplay?: string;
}) {
  const body =
    artifact.id === "newsletter" ? (
      <NewsletterPreview body={artifact.body} author={authorName} week={githubDisplay} />
    ) : artifact.id === "linkedin" ? (
      <LinkedInPreview body={artifact.body} authorName={authorName} authorTitle={authorTitle} />
    ) : (
      <XPreview body={artifact.body} authorName={authorName} authorHandle="multimail_dev" />
    );

  return (
    <div className="mx-auto w-full max-w-fit">
      <div className="mx-auto">{body}</div>
      {artifact.imageDataUrl && (
        <div className="mx-auto mt-3 max-w-2xl overflow-hidden rounded-xl border border-[var(--app-line)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artifact.imageDataUrl}
            alt={`${artifact.label} generated image`}
            className="block w-full"
          />
        </div>
      )}
    </div>
  );
}

function Composer({
  composer,
  adding,
  feedback,
  fileInputRef,
  onClose,
  onChange,
  onFile,
  onPickFile,
  onSubmit,
}: {
  composer: ComposerState;
  adding: boolean;
  feedback: string;
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onClose: () => void;
  onChange: (state: ComposerState) => void;
  onFile: (file: File | null) => void;
  onPickFile: () => void;
  onSubmit: () => void;
}) {
  const meta = MODALITY_META[composer.modality];

  return (
    <div
      className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Add ${meta.label} source`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-medium text-[var(--app-ink)]">
              Add {meta.label.toLowerCase()} source
            </h3>
            <p className="text-[12px] leading-relaxed text-[var(--app-muted)]">{meta.help}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)]"
            aria-label="Close"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <Field label="Label">
            <input
              value={composer.kind === "connector" ? composer.draft.label : composer.label}
              onChange={(event) => {
                if (composer.kind === "connector") {
                  onChange({
                    ...composer,
                    draft: { ...composer.draft, label: event.target.value },
                  });
                } else {
                  onChange({ ...composer, label: event.target.value });
                }
              }}
              placeholder={
                composer.kind === "connector"
                  ? composer.draft.modality === "discord"
                    ? "Discord · #shipping"
                    : "Slack · #eng-weekly"
                  : composer.modality === "text"
                    ? "Brief, kickoff notes, sponsor email…"
                    : "Voice memo, demo recording…"
              }
              className="h-9 w-full rounded-lg border border-[var(--app-line)] bg-transparent px-3 text-[13px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
            />
          </Field>

          {composer.kind === "connector" ? (
            <>
              <Field label={composer.draft.modality === "discord" ? "Bot token" : "Bot token (xoxb-…)"}>
                <input
                  type="password"
                  value={composer.draft.token}
                  onChange={(event) =>
                    onChange({
                      ...composer,
                      draft: { ...composer.draft, token: event.target.value },
                    })
                  }
                  placeholder={composer.draft.modality === "discord" ? "MTI0NTY3…" : "xoxb-…"}
                  autoComplete="off"
                  className="h-9 w-full rounded-lg border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12.5px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Channel id">
                  <input
                    value={composer.draft.channelId}
                    onChange={(event) =>
                      onChange({
                        ...composer,
                        draft: { ...composer.draft, channelId: event.target.value },
                      })
                    }
                    placeholder={composer.draft.modality === "discord" ? "123456789012345678" : "C0123ABCD"}
                    className="h-9 w-full rounded-lg border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
                  />
                </Field>
                <Field label="Messages">
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={composer.draft.limit}
                    onChange={(event) =>
                      onChange({
                        ...composer,
                        draft: {
                          ...composer.draft,
                          limit: Math.max(1, Math.min(200, Number(event.target.value) || 1)),
                        },
                      })
                    }
                    className="h-9 w-full rounded-lg border border-[var(--app-line)] bg-transparent px-3 font-mono text-[12px] text-[var(--app-ink)] outline-none transition-colors focus:border-[var(--app-ink)]"
                  />
                </Field>
              </div>

              {composer.draft.modality === "slack" && (
                <Field label="Workspace (optional)">
                  <input
                    value={composer.draft.workspace ?? ""}
                    onChange={(event) =>
                      onChange({
                        ...composer,
                        draft: { ...composer.draft, workspace: event.target.value },
                      })
                    }
                    placeholder="acme-co"
                    className="h-9 w-full rounded-lg border border-[var(--app-line)] bg-transparent px-3 text-[13px] text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
                  />
                </Field>
              )}
            </>
          ) : composer.modality === "text" ? (
            <Field label="Text">
              <textarea
                value={composer.text}
                onChange={(event) => onChange({ ...composer, text: event.target.value })}
                placeholder={meta.placeholder}
                rows={8}
                className="w-full resize-y rounded-lg border border-[var(--app-line)] bg-transparent p-3 text-[13px] leading-relaxed text-[var(--app-ink)] outline-none transition-colors placeholder:text-[var(--app-faint)] focus:border-[var(--app-ink)]"
              />
            </Field>
          ) : (
            <Field label="File">
              <button
                type="button"
                onClick={onPickFile}
                className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-[var(--app-line)] bg-[var(--app-soft)]/40 px-4 py-4 text-left transition-colors hover:border-[var(--app-ink)]"
              >
                <span className="text-[13px] font-medium text-[var(--app-ink)]">
                  {composer.label || meta.placeholder}
                </span>
                <span className="text-[11.5px] text-[var(--app-muted)]">
                  Click to pick a file from your computer
                </span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept={meta.accept}
                className="hidden"
                onChange={(event) => onFile(event.target.files?.[0] ?? null)}
              />
            </Field>
          )}
        </div>

        {feedback && (
          <p
            className={
              "text-[12px] " +
              (feedback === "added" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")
            }
          >
            {feedback === "added" ? "Added to your sources." : feedback}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center justify-center rounded-full px-4 text-[12.5px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={adding}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-4 text-[12.5px] font-medium text-[var(--app-paper)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {adding ? "Connecting…" : composer.kind === "connector" ? "Connect" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
        {label}
      </label>
      {children}
    </div>
  );
}

function SparkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0l1.8 4.5L14 6l-3.5 2.5L12 13l-4-2.5L4 13l1.5-4.5L2 6l4.2-1.5z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 1.5 1.5 6l5 2 2 5z" />
      <path d="m6.5 8 3-3" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 8a6 6 0 0 1 10.39-4.1M14 8a6 6 0 0 1-10.39 4.1" />
      <path d="M13 1.5v3.5h-3.5M3 14.5v-3.5h3.5" />
    </svg>
  );
}

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V3.5A.5.5 0 0 1 3.5 3H11" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function TickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 8l3 3 7-7" />
    </svg>
  );
}

function SiXIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}
