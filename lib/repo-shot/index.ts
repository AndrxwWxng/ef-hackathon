import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { chromium, type Browser } from "playwright";

import { captureShots } from "./capture";
import { detectProject } from "./detect";
import { frameShots } from "./frame";
import { cloneRepo, installDependencies, startApp } from "./sandbox";
import {
  THEMES,
  VIEWPORT_PRESETS,
  type DetectedProject,
  type RepoShotInput,
  type RepoShotOptions,
  type RepoShotResult,
  type RepoShotStage,
  type RepoShotStep,
  type RunningApp,
  type ThemeName,
  type ViewportName,
} from "./types";

const STAGES: RepoShotStage[] = ["clone", "detect", "install", "boot", "capture", "frame"];
const MAX_LOGS = 400;
const MAX_ROUTES = 12;

export class RepoShotError extends Error {
  stage: RepoShotStage;
  steps: RepoShotStep[];
  logs: string[];

  constructor(stage: RepoShotStage, cause: unknown, steps: RepoShotStep[], logs: string[]) {
    super(`${stage} failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "RepoShotError";
    this.stage = stage;
    this.steps = steps;
    this.logs = logs;
  }
}

function normalizeRoutes(routes?: string[]) {
  const output: string[] = [];
  for (const value of routes ?? ["/"]) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const route = /^https?:\/\//i.test(trimmed) || trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (!output.includes(route)) output.push(route);
    if (output.length === MAX_ROUTES) break;
  }
  return output.length ? output : ["/"];
}

function normalizeViewports(viewports?: ViewportName[]) {
  const output: ViewportName[] = [];
  for (const viewport of viewports ?? ["desktop"]) {
    if (viewport in VIEWPORT_PRESETS && !output.includes(viewport)) output.push(viewport);
  }
  return output.length ? output : (["desktop"] as ViewportName[]);
}

function normalizeTheme(theme?: ThemeName): ThemeName {
  return theme && theme in THEMES ? theme : "sunset";
}

function detail(value: unknown) {
  if (typeof value === "string") return value.split("\n")[0].slice(0, 160);
  return "";
}

export async function generateRepoShots(input: RepoShotInput, options: RepoShotOptions = {}): Promise<RepoShotResult> {
  const id = randomUUID().replaceAll("-", "").slice(0, 16);
  const routes = normalizeRoutes(input.routes);
  const viewports = normalizeViewports(input.viewports);
  const theme = normalizeTheme(input.theme);
  const title = input.title?.trim().slice(0, 120) ?? "";
  const outputRoot = path.resolve(options.outputRoot ?? path.join(process.cwd(), ".repo-shot", "shots"));
  const workRoot = path.resolve(options.workRoot ?? path.join(os.tmpdir(), "multimail-repo-shot"));
  const outputDir = path.join(outputRoot, id);
  const workDir = path.join(workRoot, id);
  const logs: string[] = [];
  const steps: RepoShotStep[] = STAGES.map((name) => ({ name, status: "pending", ms: 0, detail: "" }));
  const createdAt = new Date().toISOString();
  const log = (line: string) => {
    const clean = line.replace(/\r/g, "").trimEnd();
    if (!clean) return;
    logs.push(clean.length > 600 ? `${clean.slice(0, 600)}…` : clean);
    if (logs.length > MAX_LOGS) logs.shift();
    options.onLog?.(clean);
  };
  const runStep = async <T>(name: RepoShotStage, task: () => Promise<T>, summarize?: (result: T) => string | { skipped: boolean; detail: string }) => {
    const step = steps.find((item) => item.name === name)!;
    step.status = "running";
    options.onStep?.({ ...step });
    const started = Date.now();
    try {
      const result = await task();
      step.ms = Date.now() - started;
      const summary = summarize?.(result);
      if (typeof summary === "object") {
        step.status = summary.skipped ? "skipped" : "done";
        step.detail = detail(summary.detail);
      } else {
        step.status = "done";
        step.detail = detail(summary);
      }
      options.onStep?.({ ...step });
      return result;
    } catch (error) {
      step.ms = Date.now() - started;
      step.status = "error";
      step.detail = detail(error instanceof Error ? error.message : String(error));
      options.onStep?.({ ...step });
      throw new RepoShotError(name, error, steps.map((item) => ({ ...item })), [...logs]);
    }
  };

  let app: RunningApp | null = null;
  let browser: Browser | null = options.browser ?? null;
  let ownsBrowser = false;
  let detected: DetectedProject | null = null;

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(workRoot, { recursive: true });

  try {
    const cloned = options.skipCloneFrom
      ? {
          dir: path.resolve(options.skipCloneFrom),
          repoUrl: input.repoUrl,
          repoName: options.repoName ?? path.basename(path.resolve(options.skipCloneFrom)),
          sha: "local",
        }
      : await runStep("clone", () => cloneRepo(input.repoUrl, workDir, log, options.cloneTimeoutMs), (result) => `${result.repoName} @ ${result.sha}`);
    detected = await runStep("detect", () => detectProject(cloned.dir), (result) => `${result.type} · ${result.framework}`);
    await runStep(
      "install",
      () => installDependencies(cloned.dir, detected!, log, options.installTimeoutMs),
      (result) => ({ skipped: result.skipped, detail: result.skipped ? "nothing to install" : detected!.installCmd ?? "dependencies installed" }),
    );
    app = await runStep("boot", () => startApp(cloned.dir, detected!, log, options.bootTimeoutMs), (result) => result.url);

    if (!browser) {
      browser = await chromium.launch({ args: ["--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb"] });
      ownsBrowser = true;
    }

    const shots = await runStep(
      "capture",
      async () => {
        const captured = await captureShots({
          browser: browser!,
          baseUrl: app!.url,
          routes,
          viewports: viewports.map((name) => VIEWPORT_PRESETS[name]),
          outDir: outputDir,
          jobId: id,
          navigationTimeoutMs: options.navigationTimeoutMs,
          settleMs: options.settleMs,
          concurrency: options.captureConcurrency,
          onLog: log,
        });
        if (!captured.length) throw new Error(`No route could be captured (${routes.join(", ")})`);
        return captured;
      },
      (result) => `${result.length} screenshot${result.length === 1 ? "" : "s"}`,
    );

    const framed = await runStep(
      "frame",
      async () => {
        const output = await frameShots({
          browser: browser!,
          shots,
          outDir: outputDir,
          theme,
          title: title || cloned.repoName,
          concurrency: options.frameConcurrency,
          onLog: log,
        });
        if (!output.some((shot) => shot.framedPath)) throw new Error("No screenshots could be framed");
        return output;
      },
      (result) => `${result.filter((shot) => shot.framedPath).length} framed`,
    );

    return {
      id,
      repoUrl: cloned.repoUrl,
      repoName: cloned.repoName,
      sha: cloned.sha,
      title: title || cloned.repoName,
      theme,
      routes,
      viewports,
      outputDir,
      detected,
      shots: framed,
      steps,
      logs,
      createdAt,
      finishedAt: new Date().toISOString(),
    };
  } finally {
    if (!options.skipCloneFrom) {
      await app?.stop().catch((error) => log(`app cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
    } else {
      await app?.stop().catch((error) => log(`app cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    if (ownsBrowser) await browser?.close().catch((error) => log(`browser cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
    if (!options.skipCloneFrom) {
      await fs.rm(workDir, { recursive: true, force: true }).catch((error) => log(`workspace cleanup failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}

export { detectProject } from "./detect";
export { THEMES, VIEWPORT_PRESETS } from "./types";
export type {
  DetectedProject,
  RepoShot,
  RepoShotInput,
  RepoShotOptions,
  RepoShotResult,
  RepoShotStage,
  RepoShotStep,
  ThemeName,
  Viewport,
  ViewportName,
} from "./types";
