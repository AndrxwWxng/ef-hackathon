"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type Source = {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  connected: boolean;
  detail: string;
  meta: string;
};

type Artifact = {
  id: "newsletter" | "linkedin" | "x";
  label: string;
  handle: string;
  blurb: string;
  body: string;
  metric: string;
  tone: string;
};

const sources: Source[] = [
  {
    id: "github",
    label: "GitHub",
    value: "multimail/api",
    placeholder: "owner/repo",
    connected: true,
    detail: "owner/repo · 47 commits · 9 merged PRs",
    meta: "commits · prs",
  },
  {
    id: "docs",
    label: "External docs",
    value: "notion.so/sponsor-brief",
    placeholder: "https://docs.example.com",
    connected: true,
    detail: "One linked brief · 2,140 tokens",
    meta: "context",
  },
  {
    id: "voice",
    label: "Voice notes",
    value: "3 dropped in Slack",
    placeholder: "Drop an .mp3 or .m4a",
    connected: true,
    detail: "Transcribed · 3 min 12 sec total",
    meta: "audio",
  },
  {
    id: "writing",
    label: "Writing samples",
    value: "3 past posts",
    placeholder: "Paste 2–3 example posts",
    connected: true,
    detail: "Used to calibrate tone",
    meta: "voice",
  },
];

const runSizes = [
  { id: "small", label: "Newsletter", note: "1 source" },
  { id: "medium", label: "Newsletter + LinkedIn", note: "All sources" },
  { id: "full", label: "Newsletter + LinkedIn + X", note: "All sources" },
];

const artifacts: Artifact[] = [
  {
    id: "newsletter",
    label: "Newsletter",
    handle: "For sponsors",
    blurb:
      "A short, sourced note your partners can read in 90 seconds: what shipped, what is next, and one ask.",
    body:
      "This week we shipped a faster ingest path (4×), closed two long-standing integration gaps, and softened the digest tone. Next up: a calmer mobile view, a sponsor-only changelog, and a quiet month-end recap.",
    metric: "487 words",
    tone: "Calm, partner-facing",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    handle: "For partners in feed",
    blurb:
      "A single-paragraph post with the headline and the receipt. Reads as a status, not a broadcast.",
    body:
      "Shipped: ingest 4× faster, two flaky integrations stable, and an inbox-worthy digest that doesn't read like a changelog. Sponsors get a picture. Engineers get a changelog. Nobody gets a deck.",
    metric: "~1,400 chars",
    tone: "Direct, status-forward",
  },
  {
    id: "x",
    label: "X post",
    handle: "For engineers in replies",
    blurb:
      "A short, slightly opinionated note. The kind that earns a bookmark and a quiet reply.",
    body:
      "week 32 · ingest 4× faster · two flaky integrations now boring on purpose · a digest your sponsors will actually open",
    metric: "267 chars",
    tone: "Terse, engineer-coded",
  },
];

export default function AppHome() {
  const [activeId, setActiveId] = useState<Artifact["id"]>("newsletter");
  const [size, setSize] = useState<string>("full");
  const [running, setRunning] = useState(false);

  const active = useMemo(
    () => artifacts.find((a) => a.id === activeId) ?? artifacts[0],
    [activeId],
  );

  const handleRun = () => {
    setRunning(true);
    window.setTimeout(() => setRunning(false), 1400);
  };

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
            Aug 4 – Aug 10 · 4 sources connected · drafts generated locally · nothing sent without a click.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-full border border-[var(--app-line)] bg-[var(--app-panel)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
            <span aria-hidden className="relative grid h-1.5 w-1.5 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-[var(--app-accent)] opacity-60" />
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--app-accent)]" />
            </span>
            Ready to run
          </div>
          <button
            type="button"
            onClick={handleRun}
            disabled={running}
            className="group inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--app-ink)] px-5 text-sm font-medium text-[var(--app-paper)] transition-transform hover:-translate-y-px disabled:opacity-50"
          >
            {running ? "Running…" : "Run the week"}
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

      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-2xl border border-[var(--app-line)] bg-[var(--app-panel)] p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                Sources
              </h2>
              <span className="font-mono text-[11px] text-[var(--app-muted)]">
                4 / 4
              </span>
            </div>
            <ul className="flex flex-col">
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
                      (source.connected
                        ? "bg-[var(--app-accent)]"
                        : "border border-[var(--app-muted)]")
                    }
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-[var(--app-ink)]">
                        {source.label}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--app-muted)]">
                        {source.meta}
                      </span>
                    </div>
                    <p className="truncate text-[11.5px] text-[var(--app-muted)]">
                      {source.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="mt-0.5 inline-flex h-8 items-center justify-center rounded-full border border-[var(--app-line)] text-[12px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
            >
              Add a source
            </button>
          </section>

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
                  className="inline-flex h-7 items-center justify-center rounded-full border border-[var(--app-line)] px-3 text-[11.5px] font-medium text-[var(--app-ink)] transition-colors hover:bg-[var(--app-soft)]"
                >
                  Edit
                </button>
                <button
                  type="button"
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
            <div className="grid gap-3 px-5 py-5 sm:px-6 sm:py-6">
              <p className="font-serif text-[1.05rem] leading-[1.45] text-[var(--app-ink)] sm:text-[1.15rem]">
                {active.body}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--app-line)] pt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--app-muted)]">
                <span>Source · week 32</span>
                <span className="text-[var(--app-line)]">·</span>
                <span>Voice · {active.tone.toLowerCase()}</span>
                <span className="text-[var(--app-line)]">·</span>
                <span>Length · {active.metric}</span>
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
