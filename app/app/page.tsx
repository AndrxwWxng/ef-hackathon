"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { NewsletterPreview } from "./_components/NewsletterPreview";
import { LinkedInPreview } from "./_components/LinkedInPreview";
import { XPreview } from "./_components/XPreview";

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
  generated: boolean;
};

type GenerationState = {
  status: "idle" | "loading" | "error";
  error?: string;
};

type SourceConfig = {
  github: string;
  writingSamples: string[];
  mood: string;
};

const MOOD_OPTIONS: { id: string; label: string; hint: string }[] = [
  { id: "default", label: "Default", hint: "Neutral, professional voice" },
  { id: "Calm and measured", label: "Calm and measured", hint: "Short sentences, no hype" },
  { id: "Warm and personal", label: "Warm and personal", hint: "First-person, direct to reader" },
  { id: "Direct and punchy", label: "Direct and punchy", hint: "Leads with the news" },
  { id: "Witty and a bit dry", label: "Witty and a bit dry", hint: "Light, subtle humor" },
  { id: "Playful and energetic", label: "Playful and energetic", hint: "Enthusiastic, not breathless" },
  { id: "Technical and matter-of-fact", label: "Technical and matter-of-fact", hint: "Engineer-coded, file-level" },
  { id: "Visionary and forward-looking", label: "Visionary and forward-looking", hint: "Frames a longer arc" },
];

const initialArtifacts: Artifact[] = [
  {
    id: "newsletter",
    label: "Newsletter",
    handle: "For sponsors",
    blurb:
      "A short, sourced note your partners can read in 90 seconds: what shipped, what is next, and one ask.",
    body:
      "Click generate to draft this from the week's source data. Tone pulls from the selected mood and writing samples.",
    metric: "ready to generate",
    tone: "Calm, partner-facing",
    generated: false,
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
    generated: false,
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
    generated: false,
  },
];

const ENDPOINT_BY_KIND: Record<ArtifactKind, string> = {
  newsletter: "/api/generate/newsletter",
  linkedin: "/api/generate/linkedin",
  x: "/api/generate/x",
};

function approxMetric(kind: ArtifactKind, text: string): string {
  if (kind === "x") return `${text.length} chars`;
  if (kind === "linkedin") return `~${text.length.toLocaleString()} chars`;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return `${words} words`;
}

export default function AppHome() {
  const [activeId, setActiveId] = useState<ArtifactKind>("newsletter");
  const [targets, setTargets] = useState<Set<ArtifactKind>>(
    new Set<ArtifactKind>(["newsletter", "linkedin", "x"]),
  );
  const [running, setRunning] = useState(false);
  const [artifacts, setArtifacts] = useState<Artifact[]>(initialArtifacts);
  const [state, setState] = useState<GenerationState>({ status: "idle" });

  const [sourceConfig, setSourceConfig] = useState<SourceConfig>({
    github: "multimail/api",
    writingSamples: [
      "We shipped a faster ingest path (4x), closed two long-standing integration gaps, and softened the digest tone.",
    ],
    mood: "Calm and measured",
  });

  const active = useMemo(
    () => artifacts.find((a) => a.id === activeId) ?? artifacts[0],
    [activeId, artifacts],
  );

  const writtenSamples = sourceConfig.writingSamples.filter((s) => s.trim().length > 0);

  const payloadBody = JSON.stringify({
    mood: sourceConfig.mood === "default" ? undefined : sourceConfig.mood,
    writingSamples: writtenSamples,
  });

  const githubDisplay = sourceConfig.github.trim().length > 0
    ? sourceConfig.github.trim()
    : "owner/repo";

  async function generateOne(kind: ArtifactKind): Promise<void> {
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
    const order: ArtifactKind[] = ["newsletter", "linkedin", "x"];
    for (const t of order) {
      if (!targets.has(t)) continue;
      await generateOne(t);
    }
    setRunning(false);
  }

  async function handleRegenerate() {
    setRunning(true);
    await generateOne(activeId);
    setRunning(false);
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

  const isGenerating = running || state.status === "loading";

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
            Aug 4 – Aug 10 · pulled from <span className="text-[var(--app-ink)]">{githubDisplay}</span> · gpt-5 for text, gpt-image-1 for images · nothing sent without a click.
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
            disabled={isGenerating || targets.size === 0}
            className="group inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-5 text-sm font-medium text-[var(--app-paper)] transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
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

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-4 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Sources
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                {writtenSamples.length + (sourceConfig.github.trim() ? 1 : 0)} active
              </span>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)]/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="grid h-5 w-5 place-items-center rounded-md bg-[#0f172a] text-white">
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="currentColor" aria-hidden>
                      <path d="M8 .2a8 8 0 0 0-2.5 15.6c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.7 7.7 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.4c0 .2.1.5.5.4A8 8 0 0 0 8 .2z" />
                    </svg>
                  </span>
                  <span className="text-[12.5px] font-medium">GitHub</span>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-accent)]">
                  connected
                </span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="sr-only">GitHub repository</span>
                <input
                  type="text"
                  value={sourceConfig.github}
                  onChange={(e) =>
                    setSourceConfig((prev) => ({ ...prev, github: e.target.value }))
                  }
                  placeholder="owner/repo or https://github.com/owner/repo"
                  className="h-9 w-full rounded-md border border-[var(--app-line)] bg-[var(--app-paper)] px-3 font-mono text-[12px] outline-none transition-colors focus:border-[var(--app-ink)]"
                />
              </label>
              <p className="text-[10.5px] leading-snug text-[var(--app-muted)]">
                Paste a repo URL or <span className="font-mono">owner/repo</span>. We pull
                merged PRs + commits for the selected week.
              </p>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)]/40 p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span aria-hidden className="grid h-5 w-5 place-items-center rounded-md bg-[var(--app-ink)] text-[var(--app-paper)] font-serif text-[10px]">
                    Aa
                  </span>
                  <span className="text-[12.5px] font-medium">Writing samples</span>
                </div>
                <button
                  type="button"
                  onClick={addSample}
                  className="rounded-full border border-[var(--app-line)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
                >
                  + add
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {sourceConfig.writingSamples.map((sample, idx) => (
                  <div key={`sample-${idx}`} className="flex flex-col gap-1.5">
                    <label className="flex flex-col gap-1">
                      <span className="sr-only">Writing sample {idx + 1}</span>
                      <textarea
                        rows={2}
                        value={sample}
                        onChange={(e) => updateSample(idx, e.target.value)}
                        placeholder={`Paste an example ${idx === 0 ? "newsletter intro" : "post"} from your team…`}
                        className="w-full resize-none rounded-md border border-[var(--app-line)] bg-[var(--app-paper)] px-3 py-2 text-[12px] leading-snug outline-none transition-colors focus:border-[var(--app-ink)]"
                      />
                    </label>
                    {sourceConfig.writingSamples.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeSample(idx)}
                        className="self-end font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-accent)]"
                      >
                        remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10.5px] leading-snug text-[var(--app-muted)]">
                Used to calibrate voice. The drafts read from your team&apos;s words,
                they don&apos;t lift sentences.
              </p>
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Mood / tone
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                {sourceConfig.mood === "default" ? "default" : "1 applied"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
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
                    className={
                      "flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-all " +
                      (selected
                        ? "border-[var(--app-ink)] bg-[var(--app-soft)] shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)]"
                        : "border-[var(--app-line)] bg-[var(--app-paper)] hover:border-[var(--app-muted)]")
                    }
                  >
                    <span className="text-[11.5px] font-medium text-[var(--app-ink)]">
                      {m.label}
                    </span>
                    <span className="text-[10px] leading-snug text-[var(--app-muted)]">
                      {m.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Run size
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                {targets.size}/3 selected
              </span>
            </div>
            <div className="flex flex-col">
              {[
                { id: "newsletter" as const, label: "Newsletter", note: "350-550 words" },
                { id: "linkedin" as const, label: "LinkedIn", note: "~1,000 chars" },
                { id: "x" as const, label: "X post", note: "240-280 chars" },
              ].map((option, i) => {
                const selected = targets.has(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    onClick={() => toggleTarget(option.id)}
                    className={
                      "group flex items-center justify-between gap-3 py-2.5 text-left transition-colors " +
                      (i !== 0 ? "border-t border-[var(--app-line)]" : "")
                    }
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden
                        className={
                          "grid h-4 w-4 place-items-center rounded border transition-colors " +
                          (selected
                            ? "border-[var(--app-ink)] bg-[var(--app-ink)] text-[var(--app-paper)]"
                            : "border-[var(--app-line)] group-hover:border-[var(--app-muted)]")
                        }
                      >
                        {selected && (
                          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="M3 8l3 3 7-7" />
                          </svg>
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
            <div className="flex items-center justify-between gap-2 border-t border-[var(--app-line)] pt-2">
              <button
                type="button"
                onClick={() => setTargets(new Set(["newsletter", "linkedin", "x"]))}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
              >
                select all
              </button>
              <button
                type="button"
                onClick={() => setTargets(new Set())}
                className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)] transition-colors hover:text-[var(--app-ink)]"
              >
                clear
              </button>
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
                  disabled={isGenerating || !targets.has(active.id)}
                  className="inline-flex h-7 items-center justify-center rounded-full border border-[var(--app-line)] px-3 text-[11.5px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)] disabled:cursor-not-allowed disabled:opacity-50"
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
                  Copy markdown
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="5" y="5" width="8" height="8" rx="1.5" />
                    <path d="M3 11V3.5A.5.5 0 0 1 3.5 3H11" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="bg-[var(--app-bg)] px-3 py-6 sm:px-6 sm:py-10">
              {active.generated ? (
                <ChannelPreview
                  artifact={active}
                  githubDisplay={githubDisplay}
                  authorName={authorForKind(active.id)}
                  authorTitle={titleForKind(active.id)}
                />
              ) : (
                <ChannelPreview
                  artifact={active}
                  githubDisplay={githubDisplay}
                  authorName={authorForKind(active.id)}
                  authorTitle={titleForKind(active.id)}
                  initialFallback={active.body}
                />
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--app-line)] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
              <span>Source · {githubDisplay}</span>
              <span className="text-[var(--app-line)]">·</span>
              <span>Mood · {sourceConfig.mood === "default" ? "default" : sourceConfig.mood}</span>
              <span className="text-[var(--app-line)]">·</span>
              <span>Voice · {writtenSamples.length} sample{writtenSamples.length === 1 ? "" : "s"}</span>
              <span className="text-[var(--app-line)]">·</span>
              <span>Length · {active.metric}</span>
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
                Drop a new voice note, paste a doc, or regenerate any single draft without rerunning the week.
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
    </main>
  );
}

function authorForKind(kind: ArtifactKind): string {
  if (kind === "newsletter") return "Multimail Team";
  if (kind === "linkedin") return "M. Kapoor";
  return "polar-relay";
}

function titleForKind(kind: ArtifactKind): string {
  if (kind === "newsletter") return "Polar Relay · weekly";
  if (kind === "linkedin") return "Founder · Polar Relay · weekly build notes";
  return "· engineering at Polar Relay";
}

function ChannelPreview({
  artifact,
  initialFallback,
  authorName,
  authorTitle,
  githubDisplay,
}: {
  artifact: Artifact;
  initialFallback?: string;
  authorName?: string;
  authorTitle?: string;
  githubDisplay?: string;
}) {
  const body = artifact.generated ? artifact.body : initialFallback ?? artifact.body;
  if (artifact.id === "newsletter") {
    return (
      <div className="mx-auto max-w-2xl">
        <NewsletterPreview body={body} author={authorName} week={githubDisplay} />
        {!artifact.generated && (
          <p className="mt-3 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
            Source-only fallback · run the week to generate a draft
          </p>
        )}
        {artifact.imageDataUrl && (
          <div className="mx-auto mt-4 max-w-2xl overflow-hidden rounded-xl border border-[var(--app-line)]">
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
  if (artifact.id === "linkedin") {
    return (
      <div className="mx-auto max-w-xl">
        <LinkedInPreview body={body} authorName={authorName} authorTitle={authorTitle} />
        {!artifact.generated && (
          <p className="mt-3 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
            Source-only fallback · run the week to generate a draft
          </p>
        )}
        {artifact.imageDataUrl && (
          <div className="mx-auto mt-4 max-w-xl overflow-hidden rounded-xl border border-[var(--app-line)]">
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
  return (
    <div className="mx-auto max-w-lg">
      <XPreview body={body} authorName={authorName} authorHandle="polar_relay" />
      {!artifact.generated && (
        <p className="mt-3 text-center font-mono text-[10.5px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
          Source-only fallback · run the week to generate a draft
        </p>
      )}
      {artifact.imageDataUrl && (
        <div className="mx-auto mt-4 max-w-lg overflow-hidden rounded-xl border border-[var(--app-line)]">
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
