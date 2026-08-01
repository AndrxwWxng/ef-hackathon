"use client";

import { useState } from "react";

type Source = {
  id: string;
  label: string;
  placeholder: string;
  connected: boolean;
  detail: string;
};

const initialSources: Source[] = [
  {
    id: "github",
    label: "GitHub repo",
    placeholder: "owner/repo",
    connected: true,
    detail: "Pulls commits, PRs, and merged work for the selected week.",
  },
  {
    id: "docs",
    label: "External docs",
    placeholder: "https://docs.example.com",
    connected: true,
    detail: "Notion, Coda, or any public doc URL, used as additional context.",
  },
  {
    id: "gmail",
    label: "Gmail",
    placeholder: "you@gmail.com",
    connected: false,
    detail: "Optional. Threads mentioning partners or sponsors add context.",
  },
  {
    id: "writing",
    label: "Writing samples",
    placeholder: "Paste 2–3 example posts",
    connected: true,
    detail: "Calibrates voice so drafts sound like your team, not a bot.",
  },
];

const runSizes = [
  { id: "small", label: "Small", description: "1 source · newsletter only" },
  { id: "medium", label: "Medium", description: "All sources · newsletter + LinkedIn" },
  { id: "full", label: "Full", description: "All sources · newsletter + LinkedIn + X" },
];

export default function Homepage() {
  const [sources] = useState<Source[]>(initialSources);
  const [size, setSize] = useState<string>("medium");
  const [running, setRunning] = useState(false);

  const handleRun = () => {
    setRunning(true);
    window.setTimeout(() => setRunning(false), 1200);
  };

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
          Dashboard
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          This week&apos;s update
        </h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Review your connected sources, pick how much to generate, then run.
        </p>
      </header>

      <section className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Sources</h2>
          <span className="text-xs text-[var(--muted-foreground)]">
            {sources.filter((s) => s.connected).length} of {sources.length} connected
          </span>
        </div>
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)]">
          {sources.map((source) => (
            <li
              key={source.id}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{source.label}</span>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide " +
                      (source.connected
                        ? "bg-[var(--foreground)] text-[var(--background)]"
                        : "border border-[var(--border)] text-[var(--muted-foreground)]")
                    }
                  >
                    {source.connected ? "Connected" : "Not connected"}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">
                  {source.detail}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  defaultValue={source.connected ? source.placeholder : ""}
                  placeholder={source.placeholder}
                  aria-label={`${source.label} value`}
                  className="h-9 w-full min-w-0 rounded-full border border-[var(--border)] bg-transparent px-3 text-xs outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--foreground)] sm:w-56"
                />
                <button
                  type="button"
                  className="h-9 rounded-full border border-[var(--border)] px-3 text-xs transition-colors hover:bg-[var(--muted)]"
                >
                  {source.connected ? "Edit" : "Connect"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">How much to run</h2>
        <div
          role="radiogroup"
          aria-label="Run size"
          className="grid gap-3 sm:grid-cols-3"
        >
          {runSizes.map((option) => {
            const selected = size === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setSize(option.id)}
                className={
                  "flex flex-col items-start gap-1 rounded-2xl border px-4 py-4 text-left transition-colors " +
                  (selected
                    ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                    : "border-[var(--border)] hover:bg-[var(--muted)]")
                }
              >
                <span className="text-sm font-medium">{option.label}</span>
                <span
                  className={
                    "text-xs " +
                    (selected
                      ? "text-[var(--background)]/70"
                      : "text-[var(--muted-foreground)]")
                  }
                >
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t border-[var(--border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-[var(--muted-foreground)]">
          Drafts will appear below. Nothing is sent or posted automatically.
        </p>
        <button
          type="button"
          onClick={handleRun}
          disabled={running}
          className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--foreground)] px-6 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          {running ? "Running…" : "Run manually"}
        </button>
      </section>
    </main>
  );
}