"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type StageStatus = "pending" | "running" | "done" | "error";

export type StageGroup = "pull" | "ingest" | "generate";

export type Stage = {
  id: string;
  group: StageGroup;
  label: string;
  status: StageStatus;
  startedAt?: number;
  ms?: number;
  detail?: string;
};

export type LogLine = {
  id: string;
  group: StageGroup;
  text: string;
  at: number;
};

const GROUP_LABEL: Record<StageGroup, string> = {
  pull: "Pulling",
  ingest: "Ingesting",
  generate: "Generating",
};

const GROUP_ORDER: StageGroup[] = ["pull", "ingest", "generate"];

const MAX_LOG_LINES = 400;

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = Math.round(seconds % 60);
  return `${minutes}m ${rem.toString().padStart(2, "0")}s`;
}

function formatStamp(ms: number): string {
  const date = new Date(ms);
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  const ss = date.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function StatusDot({ status }: { status: StageStatus }) {
  if (status === "running") {
    return (
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
    );
  }
  if (status === "done") {
    return <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />;
  }
  if (status === "error") {
    return <span className="inline-flex h-2 w-2 rounded-full bg-red-500" />;
  }
  return <span className="inline-flex h-2 w-2 rounded-full border border-[var(--app-line)] bg-transparent" />;
}

function LogLineRow({ line }: { line: LogLine }) {
  const isWarning = /^warning:/i.test(line.text);
  const isError = /\bfailed\b|\berror\b/i.test(line.text) && !isWarning;
  const isOk = /[✓✔]/.test(line.text);
  const accent =
    isError
      ? "text-red-600 dark:text-red-400"
      : isWarning
        ? "text-amber-700 dark:text-amber-400"
        : isOk
          ? "text-emerald-600 dark:text-emerald-400"
          : "text-[var(--app-ink)]";
  return (
    <div className="flex items-start gap-2 px-3 py-0.5">
      <span className="w-14 shrink-0 font-mono text-[9.5px] leading-[1.55] text-[var(--app-faint)]">
        {formatStamp(line.at)}
      </span>
      <span className={"font-mono text-[10.5px] leading-[1.55] " + accent}>
        {line.text}
      </span>
    </div>
  );
}

type Props = {
  stages: Stage[];
  logs: LogLine[];
  running: boolean;
  hasRun: boolean;
  onClear: () => void;
  error?: string | null;
  targets: string[];
};

function groupLabelFor(stage: Stage): string {
  return stage.label;
}

export function PipelinePanel({ stages, logs, running, hasRun, onClear, error, targets }: Props) {
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [now, setNow] = useState(0);
  const lastLogCount = useRef(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (!autoScroll) return;
    if (logs.length === lastLogCount.current) return;
    lastLogCount.current = logs.length;
    const el = logScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, autoScroll]);

  const visibleLogs = useMemo(() => {
    if (logs.length <= MAX_LOG_LINES) return logs;
    return logs.slice(logs.length - MAX_LOG_LINES);
  }, [logs]);

  const grouped = useMemo(() => {
    const map: Record<StageGroup, Stage[]> = { pull: [], ingest: [], generate: [] };
    for (const stage of stages) {
      map[stage.group].push(stage);
    }
    return map;
  }, [stages]);

  const totals = useMemo(() => {
    let done = 0;
    let failed = 0;
    let runningCount = 0;
    let pending = 0;
    for (const stage of stages) {
      if (stage.status === "done") done += 1;
      else if (stage.status === "error") failed += 1;
      else if (stage.status === "running") runningCount += 1;
      else pending += 1;
    }
    return { done, failed, runningCount, pending, total: stages.length };
  }, [stages]);

  const statusSummary = running
    ? "Live"
    : error
      ? "Error"
      : totals.failed > 0
        ? "Failed"
        : hasRun
          ? "Done"
          : "Idle";

  const statusDotClass =
    statusSummary === "Live"
      ? "bg-amber-500 animate-pulse"
      : statusSummary === "Error" || statusSummary === "Failed"
        ? "bg-red-500"
        : statusSummary === "Done"
          ? "bg-emerald-500"
          : "bg-[var(--app-faint)]";

  return (
    <aside className="flex min-h-[420px] shrink-0 flex-col overflow-hidden rounded-xl border border-[var(--app-line)] bg-[var(--app-panel)] lg:h-auto lg:min-h-0 lg:w-[360px] xl:w-[400px]">
      <header className="flex items-center justify-between gap-2 border-b border-[var(--app-line)] px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <h2 className="text-[12px] font-medium text-[var(--app-ink)]">Activity</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--app-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--app-muted)]">
              <span className={"h-1.5 w-1.5 rounded-full " + statusDotClass} />
              {statusSummary}
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
            {hasRun
              ? `${totals.done}/${totals.total} stages${totals.failed ? ` · ${totals.failed} failed` : ""}`
              : "Run the week to see live progress"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {targets.length > 0 && (
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
              {targets.length} target{targets.length === 1 ? "" : "s"}
            </span>
          )}
          <button
            type="button"
            onClick={onClear}
            disabled={!hasRun && logs.length === 0}
            className="grid h-6 w-6 place-items-center rounded text-[var(--app-muted)] transition-colors hover:bg-[var(--app-soft)] hover:text-[var(--app-ink)] disabled:cursor-not-allowed disabled:opacity-30"
            aria-label="Clear activity"
            title="Clear activity"
          >
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 3l10 10M13 3L3 13" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-1 py-2">
          {stages.length === 0 && (
            <p className="px-3 py-4 text-[12px] leading-relaxed text-[var(--app-muted)]">
              The pipeline stages will appear here when you run the week. Each stage shows what the agent is doing: pulling the repo, ingesting the analysis, and drafting each channel.
            </p>
          )}
          {stages.length > 0 && (
            <div className="flex flex-col">
              {GROUP_ORDER.map((group) => {
                const items = grouped[group];
                if (items.length === 0) return null;
                return (
                  <section key={group} className="px-2 py-2">
                    <div className="flex items-center justify-between px-2 pb-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
                        {GROUP_LABEL[group]}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--app-faint)]">
                        {items.filter((s) => s.status === "done").length}/{items.length}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-0.5">
                      {items.map((stage) => {
                        const liveMs =
                          stage.status === "running" && stage.startedAt
                            ? now - stage.startedAt
                            : stage.ms ?? 0;
                        const showTime = stage.status === "done" || stage.status === "running";
                        const muted = stage.status === "pending";
                        return (
                          <li
                            key={stage.id}
                            className={
                              "flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors " +
                              (stage.status === "running"
                                ? "bg-amber-500/5"
                                : stage.status === "error"
                                  ? "bg-red-500/5"
                                  : "hover:bg-[var(--app-soft)]")
                            }
                          >
                            <StatusDot status={stage.status} />
                            <span
                              className={
                                "flex-1 truncate text-[11.5px] " +
                                (muted ? "text-[var(--app-faint)]" : "text-[var(--app-ink)]")
                              }
                              title={groupLabelFor(stage)}
                            >
                              {groupLabelFor(stage)}
                            </span>
                            {stage.detail && (
                              <span
                                className="max-w-[140px] truncate font-mono text-[10px] text-[var(--app-muted)]"
                                title={stage.detail}
                              >
                                {stage.detail}
                              </span>
                            )}
                            {showTime && (
                              <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--app-muted)]">
                                {formatMs(liveMs)}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex h-[42%] min-h-[180px] shrink-0 flex-col border-t border-[var(--app-line)]">
          <div className="flex items-center justify-between border-b border-[var(--app-line)] px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
              Log · {visibleLogs.length}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--app-muted)]">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
                className="h-3 w-3 cursor-pointer accent-[var(--app-ink)]"
              />
              tail
            </label>
          </div>
          <div
            ref={logScrollRef}
            onScroll={(event) => {
              const el = event.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              setAutoScroll(atBottom);
            }}
            className="flex-1 overflow-y-auto bg-[var(--app-soft)]/40 py-1"
          >
            {visibleLogs.length === 0 ? (
              <p className="px-3 py-3 font-mono text-[10.5px] text-[var(--app-faint)]">
                No log lines yet.
              </p>
            ) : (
              visibleLogs.map((line) => <LogLineRow key={line.id} line={line} />)
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

export const PIPELINE_TARGET_LABELS = GROUP_LABEL;
