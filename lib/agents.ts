import fs from "node:fs/promises";

import { Agent, run, tool, type AgentOutputType, type RunResult } from "@openai/agents";
import { z } from "zod";

import {
  generateRepoShots,
  generateRepoVideo,
  VIEWPORT_PRESETS,
  THEMES,
  type RepoVideoFormat,
  type RepoVideoResult,
  type ViewportName,
} from "./repo-shot";
import { buildSourceContext, GROUNDING_RULES, generateTextDraft } from "./openai";
import type { WeeklySource } from "./weekly-source";
import type { ThemeName } from "./repo-shot/types";

export const AGENT_MODEL = "gpt-5.6";
export const SCREENSHOT_TOOL_NAME = "take_screenshots";
export const VIDEO_TOOL_NAME = "record_app_video";

export type ScreenshotFrame = {
  id: string;
  route: string;
  viewport: string;
  width: number;
  height: number;
  mimeType: "image/png";
  data: string;
};

export type ScreenshotResult = {
  repoUrl: string;
  repoName: string;
  theme: string;
  viewports: string[];
  routes: string[];
  frames: ScreenshotFrame[];
};

export type VideoResult = {
  repoUrl: string;
  repoName: string;
  viewport: ViewportName;
  format: RepoVideoFormat;
  routes: string[];
  rawPath: string;
  encodedPath: string | null;
  outputPath: string;
  durationMs: number;
  width: number;
  height: number;
};

export type DraftRunResult = {
  text: string;
  screenshots: ScreenshotResult | null;
  video: VideoResult | null;
};

const viewportNames = Object.keys(VIEWPORT_PRESETS) as [string, ...string[]];
const themeNames = Object.keys(THEMES) as [string, ...string[]];

export const screenshotToolParams = z.object({
  repoUrl: z
    .string()
    .min(1)
    .describe(
      "HTTP(S) URL or owner/repo shorthand for the GitHub repo to screenshot. Use the source's `App repo (screenshottable)` field when available.",
    ),
  routes: z
    .array(z.string().min(1))
    .max(12)
    .optional()
    .describe(
      "App routes to capture (e.g. ['/'], ['/', '/dashboard', '/pricing']). Defaults to ['/'].",
    ),
  viewports: z
    .array(z.enum(viewportNames as [string, ...string[]]))
    .optional()
    .describe("Viewport presets to capture. Defaults to ['desktop']."),
  theme: z
    .enum(themeNames as [string, ...string[]])
    .optional()
    .describe("Frame theme. Defaults to 'sunset'."),
  title: z.string().max(120).optional().describe("Optional title shown in the window chrome."),
});

export type ScreenshotToolParams = z.infer<typeof screenshotToolParams>;

export type BuildScreenshotToolOptions = {
  capture?: (result: ScreenshotResult) => void;
  preGenerated?: Promise<ScreenshotResult | null> | null;
};

function normalizeRepoKey(repoUrl: string): string {
  return repoUrl
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
    .toLowerCase();
}

function preGeneratedScreenshotMatches(
  cached: ScreenshotResult,
  input: ScreenshotToolParams,
): boolean {
  if (!cached.frames.length) return false;
  if (normalizeRepoKey(cached.repoUrl) !== normalizeRepoKey(input.repoUrl)) return false;
  // Pre-gen is a best-effort cache: accept any route set for the same repo so
  // the agent does not re-clone just because it picked slightly different paths.
  return true;
}

export function buildScreenshotTool(options: BuildScreenshotToolOptions = {}) {
  return tool({
    name: SCREENSHOT_TOOL_NAME,
    description:
      "Clone a GitHub repo into a throwaway workspace, install dependencies, boot the dev server, and capture framed screenshots of one or more routes at multiple viewports. " +
      "Returns base64 PNG frames that the caller can embed in the post. Use this whenever the source includes an `App repo (screenshottable)` URL and you want to reference the actual UI in the draft.",
    parameters: screenshotToolParams,
    execute: async (input: ScreenshotToolParams) => {
      const callId = Math.random().toString(36).slice(2, 8);
      const fmt = (...args: unknown[]) =>
        args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      const slog = (...args: unknown[]) => console.log(`[screenshot-tool ${callId}]`, fmt(...args));
      const slogErr = (...args: unknown[]) => console.error(`[screenshot-tool ${callId}]`, fmt(...args));
      slog("invoked", {
        repoUrl: input.repoUrl,
        routes: input.routes,
        viewports: input.viewports,
        theme: input.theme,
        title: input.title,
      });
      const started = Date.now();

      if (options.preGenerated) {
        const cached = await options.preGenerated;
        if (cached && preGeneratedScreenshotMatches(cached, input)) {
          slog("using pre-generated screenshots", {
            frameCount: cached.frames.length,
            durationMs: Date.now() - started,
          });
          options.capture?.(cached);
          const summary = {
            repoName: cached.repoName,
            repoUrl: cached.repoUrl,
            theme: cached.theme,
            viewports: cached.viewports,
            routes: cached.routes,
            frameCount: cached.frames.length,
            frameSummaries: cached.frames.map((frame) => ({
              id: frame.id,
              route: frame.route,
              viewport: frame.viewport,
            })),
            preGenerated: true,
          };
          return JSON.stringify(summary);
        }
      }

      let result: Awaited<ReturnType<typeof generateRepoShots>>;
      try {
        result = await generateRepoShots({
          repoUrl: input.repoUrl,
          routes: pickScreenshotRoutes(undefined, input.routes),
          viewports: input.viewports as Parameters<typeof generateRepoShots>[0]["viewports"],
          theme: input.theme as Parameters<typeof generateRepoShots>[0]["theme"],
          title: input.title,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        slogErr("generateRepoShots threw", { message });
        throw err;
      }
      slog("generateRepoShots returned", {
        durationMs: Date.now() - started,
        repoName: result.repoName,
        repoUrl: result.repoUrl,
        stepNames: result.steps.map((s) => s.name),
        shotCount: result.shots.length,
        shots: result.shots.map((s) => ({
          id: s.id,
          route: s.route,
          viewport: s.viewport,
          hasFramedPath: Boolean(s.framedPath),
        })),
      });
      const frames: ScreenshotFrame[] = [];
      for (const shot of result.shots) {
        if (!shot.framedPath) continue;
        try {
          const data = await fs.readFile(shot.framedPath, "base64");
          frames.push({
            id: shot.id,
            route: shot.route,
            viewport: shot.viewport,
            width: shot.width,
            height: shot.height,
            mimeType: "image/png",
            data,
          });
        } catch (err) {
          slogErr("failed to read framed screenshot", {
            id: shot.id,
            path: shot.framedPath,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const screenshots: ScreenshotResult = {
        repoUrl: result.repoUrl,
        repoName: result.repoName,
        theme: result.theme,
        viewports: result.viewports as string[],
        routes: result.routes,
        frames,
      };
      options.capture?.(screenshots);
      const summary = {
        repoName: result.repoName,
        repoUrl: result.repoUrl,
        theme: result.theme,
        viewports: result.viewports,
        routes: result.routes,
        frameCount: frames.length,
        frameSummaries: frames.map((frame) => ({
          id: frame.id,
          route: frame.route,
          viewport: frame.viewport,
        })),
      };
      slog("returning summary", { frameCount: frames.length, durationMs: Date.now() - started });
      return JSON.stringify(summary);
    },
  });
}

export const videoToolParams = z.object({
  repoUrl: z
    .string()
    .min(1)
    .describe(
      "HTTP(S) URL or owner/repo shorthand for the GitHub repo to record. Use the source's `App repo (screenshottable)` field when available.",
    ),
  routes: z
    .array(z.string().min(1))
    .max(8)
    .optional()
    .describe(
      "App routes to walk through, in order. Defaults to ['/']. The walker prefers clicking real <a> links to the next route and falls back to direct navigation. Pick an order that reads as a natural tour.",
    ),
  viewport: z
    .enum(["desktop", "mobile"])
    .optional()
    .describe("Viewport preset. Defaults to 'desktop'."),
  durationMs: z
    .number()
    .int()
    .min(2000)
    .max(120000)
    .optional()
    .describe("Maximum total recording time in milliseconds. Defaults to 20000."),
  format: z
    .enum(["webm", "mp4"])
    .optional()
    .describe("Output container. 'webm' (Playwright native) or 'mp4' (requires ffmpeg on PATH). Defaults to 'webm'."),
  title: z.string().max(120).optional().describe("Optional title used for the saved artifact's filename."),
});

export type VideoToolParams = z.infer<typeof videoToolParams>;

export type BuildVideoToolOptions = {
  capture?: (result: VideoResult) => void;
  preGenerated?: Promise<VideoResult | null> | null;
};

function preGeneratedVideoMatches(cached: VideoResult, input: VideoToolParams): boolean {
  if (!cached.outputPath) return false;
  if (normalizeRepoKey(cached.repoUrl) !== normalizeRepoKey(input.repoUrl)) return false;
  if (input.format && cached.format !== input.format) return false;
  if (input.viewport && cached.viewport !== input.viewport) return false;
  return true;
}

export function buildVideoTool(options: BuildVideoToolOptions = {}) {
  return tool({
    name: VIDEO_TOOL_NAME,
    description:
      "Clone a GitHub repo into a throwaway workspace, install dependencies, boot the dev server, then drive a real Chromium session through the requested routes (clicking real <a> links when possible, scrolling, holding on each route) while recording. " +
      "Returns a JSON summary that points to the saved video file under the output directory. Use this when the source has an `App repo (screenshottable)` URL and a short walk-through would make the post more useful (e.g. 'a 20s tour of the new dashboard').",
    parameters: videoToolParams,
    execute: async (input: VideoToolParams) => {
      const callId = Math.random().toString(36).slice(2, 8);
      const slog = (...args: unknown[]) => console.log(`[video-tool ${callId}]`, ...args);
      const slogErr = (...args: unknown[]) => console.error(`[video-tool ${callId}]`, ...args);
      slog("invoked", {
        repoUrl: input.repoUrl,
        routes: input.routes,
        viewport: input.viewport,
        durationMs: input.durationMs,
        format: input.format,
        title: input.title,
      });
      const started = Date.now();

      if (options.preGenerated) {
        const cached = await options.preGenerated;
        if (cached && preGeneratedVideoMatches(cached, input)) {
          slog("using pre-generated video", {
            outputPath: cached.outputPath,
            durationMs: Date.now() - started,
          });
          options.capture?.(cached);
          const summary = {
            repoName: cached.repoName,
            repoUrl: cached.repoUrl,
            viewport: cached.viewport,
            format: cached.format,
            routes: cached.routes,
            durationMs: cached.durationMs,
            width: cached.width,
            height: cached.height,
            outputPath: cached.outputPath,
            rawPath: cached.rawPath,
            encodedPath: cached.encodedPath,
            preGenerated: true,
          };
          return JSON.stringify(summary);
        }
      }

      let result: RepoVideoResult;
      try {
        result = await generateRepoVideo({
          repoUrl: input.repoUrl,
          routes: input.routes,
          viewport: (input.viewport ?? "desktop") as ViewportName,
          durationMs: input.durationMs,
          format: (input.format ?? "webm") as RepoVideoFormat,
          title: input.title,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const stack = err instanceof Error ? err.stack : undefined;
        slogErr("generateRepoVideo threw", { message, stack });
        throw err;
      }
      const outputPath = result.encodedPath ?? result.rawPath;
      slog("generateRepoVideo returned", {
        durationMs: Date.now() - started,
        repoName: result.repoName,
        repoUrl: result.repoUrl,
        stepNames: result.steps.map((s) => s.name),
        routeCount: result.routes.length,
        outputPath,
        format: result.format,
        viewport: result.viewport,
        width: result.width,
        height: result.height,
        recordedMs: result.durationMs,
      });
      const captured: VideoResult = {
        repoUrl: result.repoUrl,
        repoName: result.repoName,
        viewport: result.viewport,
        format: result.format,
        routes: result.routes,
        rawPath: result.rawPath,
        encodedPath: result.encodedPath,
        outputPath,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
      };
      options.capture?.(captured);
      const summary = {
        repoName: result.repoName,
        repoUrl: result.repoUrl,
        viewport: result.viewport,
        format: result.format,
        routes: result.routes,
        durationMs: result.durationMs,
        width: result.width,
        height: result.height,
        outputPath,
        rawPath: result.rawPath,
        encodedPath: result.encodedPath,
        stepSummaries: result.steps.map((step) => ({ name: step.name, status: step.status, ms: step.ms, detail: step.detail })),
      };
      slog("returning summary", { outputPath, durationMs: Date.now() - started });
      return JSON.stringify(summary);
    },
  });
}

const SHARED_RULES = [
  "You only use information present in the supplied source data.",
  "You never invent partner names, metrics, or testimonials.",
  "You avoid em dashes; use hyphens, colons, or rewrite instead.",
  GROUNDING_RULES,
  "If the source includes an `App repo (screenshottable)` URL, you MUST call `take_screenshots` at least once before producing the draft, choosing routes that show the most relevant shipped work (the home page is always a safe default).",
  "Do not describe the screenshots in the draft unless they make the post more useful. Reference the visual only when it adds concrete value (e.g. 'the new digest view on mobile').",
  "You may optionally call `record_app_video` once when a short walk-through would add real value (e.g. a 15-20s tour of the most relevant shipped flow). Prefer it over `take_screenshots` only if the flow has interactive depth - otherwise screenshots are cheaper and clearer.",
  "Do not describe the video in the draft; the host will attach it to the post automatically.",
  "Return ONLY the draft text, no preamble, no labels, no surrounding quotes.",
].join("\n");

function buildUserPrompt(source: WeeklySource, kind: "newsletter" | "linkedin", mood: string | undefined, toneLine: string): string {
  const kindLabel = kind === "linkedin" ? "LinkedIn post" : "newsletter";
  const instructions =
    kind === "linkedin"
      ? "Write a LinkedIn post of roughly 800-1,400 characters. Open with the single most interesting shipped item in one short line, then 3-5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Use minimal Markdown (line breaks, occasional **bold** for emphasis). Tone is direct and status-forward. Reference concrete items from the source. Do not invent partners, metrics, or testimonials."
      : "Write a 350-550 word sponsor-facing newsletter. Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3-5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, and specific. Use Markdown for structure (headings with ##, bold with **, lists with -). Reference concrete items from the source. Do not invent partners, metrics, or testimonials.";

  return (
    `Source data for the week (do not invent beyond this):\n\n` +
    buildSourceContext(source) +
    `\n\nTarget mood/tone (apply throughout): ${mood ?? "(no override, use neutral default)"}. ` +
    `Guidance: ${toneLine}.` +
    `\n\nTask: ${instructions}\n\n` +
    `Return ONLY the ${kindLabel} text.`
  );
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  default: "Use a natural, professional tone.",
  "calm and measured": "Use a calm, measured tone. Short sentences. No hype words.",
  "warm and personal": "Use a warm, first-person, personal tone. Speak directly to the reader.",
  "direct and punchy": "Use a direct, punchy, status-forward tone. Lead with the news.",
  "witty and a bit dry": "Use a witty, lightly dry tone. Occasional subtle humor is welcome; do not force jokes.",
  "playful and energetic": "Use a playful, energetic tone. Enthusiastic but not breathless.",
  "technical and matter-of-fact": "Use a technical, matter-of-fact tone. Engineer-coded, references files/PRs by name when useful.",
  "visionary and forward-looking": "Use a visionary, forward-looking tone. Frame the week's work inside a longer arc.",
};

function resolveToneInstruction(mood?: string): string {
  if (!mood) return TONE_INSTRUCTIONS.default;
  const key = mood.trim().toLowerCase();
  if (TONE_INSTRUCTIONS[key]) return TONE_INSTRUCTIONS[key];
  return `Use a tone that matches this mood/voice guidance: "${mood}". Apply it consistently across the draft.`;
}

export type BuildAgentsOptions = {
  screenshotTool: ReturnType<typeof buildScreenshotTool>;
  videoTool: ReturnType<typeof buildVideoTool>;
};

export type DraftAgent = Agent<unknown, AgentOutputType>;

function buildDraftAgents({ screenshotTool, videoTool }: BuildAgentsOptions): { linkedinAgent: DraftAgent; newsletterAgent: DraftAgent } {
  const linkedinAgent: DraftAgent = new Agent({
    name: "LinkedIn Draft Agent",
    handoffDescription: "Writes a LinkedIn post for the weekly update.",
    instructions:
      "You write LinkedIn posts for a small dev team's weekly update.\n" +
      SHARED_RULES,
    model: AGENT_MODEL,
    tools: [screenshotTool, videoTool],
  });

  const newsletterAgent: DraftAgent = new Agent({
    name: "Newsletter Draft Agent",
    handoffDescription: "Writes a sponsor-facing newsletter for the weekly update.",
    instructions:
      "You write sponsor-facing newsletters for a small dev team's weekly update.\n" +
      SHARED_RULES,
    model: AGENT_MODEL,
    tools: [screenshotTool, videoTool],
  });

  return { linkedinAgent, newsletterAgent };
}

export type RunDraftAgentOptions = {
  source: WeeklySource;
  mood?: string;
  writingSamples?: string[];
};

async function runDraftAgent(
  agent: DraftAgent,
  kind: "linkedin" | "newsletter",
  options: RunDraftAgentOptions,
): Promise<RunResult<unknown, DraftAgent>> {
  const callId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) => console.log(`[${kind}-agent ${callId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[${kind}-agent ${callId}]`, ...args);
  const prompt = buildUserPrompt(options.source, kind, options.mood, resolveToneInstruction(options.mood));
  const sampleBlock = (options.writingSamples ?? [])
    .filter((sample) => sample.trim().length > 0)
    .map((sample, index) => `Sample ${index + 1}:\n${sample.trim()}`)
    .join("\n\n");
  const fullPrompt = sampleBlock
    ? `${prompt}\n\nWriting samples from the team (calibrate voice, do not lift sentences verbatim):\n${sampleBlock}`
    : prompt;
  log("starting", {
    model: AGENT_MODEL,
    promptLength: fullPrompt.length,
    sampleCount: (options.writingSamples ?? []).filter((s) => s.trim().length > 0).length,
    mood: options.mood ?? null,
    appRepoScreenshottable: (options.source as { appRepoScreenshottable?: unknown }).appRepoScreenshottable ?? null,
  });
  const started = Date.now();
  try {
    const result = await run<DraftAgent, unknown>(agent, fullPrompt, { maxTurns: 6 });
    log("finished", {
      durationMs: Date.now() - started,
      finalOutputLength: typeof result.finalOutput === "string" ? result.finalOutput.length : 0,
      newItems: result.newItems?.length ?? 0,
      rawResponses: result.rawResponses?.length ?? 0,
      lastResponseId: result.lastResponseId ?? null,
      newItemsSummary: (result.newItems ?? []).slice(-10).map((item) => {
        const anyItem = item as { type?: string; name?: string; status?: string; role?: string };
        return { type: anyItem.type, name: anyItem.name, status: anyItem.status, role: anyItem.role };
      }),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    const name = err instanceof Error ? err.name : undefined;
    logErr("run() threw", { name, message, stack, durationMs: Date.now() - started });
    throw err;
  }
}

export type RunLinkedInAgentOptions = RunDraftAgentOptions & {
  onScreenshot?: (result: ScreenshotResult) => void;
  onVideo?: (result: VideoResult) => void;
  preGeneratedScreenshot?: Promise<ScreenshotResult | null> | null;
  preGeneratedVideo?: Promise<VideoResult | null> | null;
};

export async function runLinkedInAgent(
  options: RunLinkedInAgentOptions,
): Promise<DraftRunResult> {
  return runDraftAgentWithScreenshots("linkedin", options);
}

export type RunNewsletterAgentOptions = RunDraftAgentOptions & {
  onScreenshot?: (result: ScreenshotResult) => void;
  onVideo?: (result: VideoResult) => void;
  preGeneratedScreenshot?: Promise<ScreenshotResult | null> | null;
  preGeneratedVideo?: Promise<VideoResult | null> | null;
};

export async function runNewsletterAgent(
  options: RunNewsletterAgentOptions,
): Promise<DraftRunResult> {
  return runDraftAgentWithScreenshots("newsletter", options);
}

async function runDraftAgentWithScreenshots(
  kind: "linkedin" | "newsletter",
  options: RunDraftAgentOptions & {
    onScreenshot?: (result: ScreenshotResult) => void;
    onVideo?: (result: VideoResult) => void;
    preGeneratedScreenshot?: Promise<ScreenshotResult | null> | null;
    preGeneratedVideo?: Promise<VideoResult | null> | null;
  },
): Promise<DraftRunResult> {
  let captured: ScreenshotResult | null = null;
  let capturedVideo: VideoResult | null = null;
  const screenshotTool = buildScreenshotTool({
    preGenerated: options.preGeneratedScreenshot ?? null,
    capture: (result) => {
      captured = result;
      options.onScreenshot?.(result);
    },
  });
  const videoTool = buildVideoTool({
    preGenerated: options.preGeneratedVideo ?? null,
    capture: (result) => {
      capturedVideo = result;
      options.onVideo?.(result);
    },
  });
  const { linkedinAgent, newsletterAgent } = buildDraftAgents({ screenshotTool, videoTool });
  const agent = kind === "linkedin" ? linkedinAgent : newsletterAgent;
  const result = await runDraftAgent(agent, kind, options);
  const text = String(result.finalOutput ?? "").trim().replace(/—/g, "-");
  return { text, screenshots: captured, video: capturedVideo };
}

type DraftKind = "newsletter" | "linkedin" | "x";

function pickScreenshotRoutes(sourceRoutes?: string[], override?: string[]): string[] {
  const MAX = 4;
  const raw = override?.length ? override : sourceRoutes?.length ? sourceRoutes : ["/"];
  const out: string[] = [];
  const push = (route: string) => {
    const normalized = route.startsWith("/") || /^https?:\/\//i.test(route) ? route : `/${route}`;
    if (!out.includes(normalized)) out.push(normalized);
  };
  // Always include home first when available; then unique page routes up to MAX.
  if (raw.includes("/")) push("/");
  for (const route of raw) {
    if (out.length >= MAX) break;
    push(route);
  }
  return out.length ? out : ["/"];
}

async function preGenerateScreenshot(
  source: WeeklySource,
  options: { routes?: string[]; viewports?: ViewportName[]; theme?: ThemeName } = {},
): Promise<ScreenshotResult | null> {
  if (!source.repoUrl) return null;
  const callId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) =>
    console.log(`[pre-screenshot ${callId}]`, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const logErr = (...args: unknown[]) =>
    console.error(`[pre-screenshot ${callId}]`, args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
  const routes = pickScreenshotRoutes(source.routes, options.routes);
  const viewports = options.viewports ?? (["desktop"] as ViewportName[]);
  const theme = options.theme ?? "sunset";
  log("starting", { repoUrl: source.repoUrl, routes, viewports, theme });
  const started = Date.now();
  try {
    const result = await generateRepoShots({
      repoUrl: source.repoUrl,
      routes,
      viewports,
      theme,
    });
    const frames: ScreenshotFrame[] = [];
    for (const shot of result.shots) {
      if (!shot.framedPath) continue;
      try {
        const data = await fs.readFile(shot.framedPath, "base64");
        frames.push({
          id: shot.id,
          route: shot.route,
          viewport: shot.viewport,
          width: shot.width,
          height: shot.height,
          mimeType: "image/png",
          data,
        });
      } catch (err) {
        logErr("failed to read framed screenshot", {
          id: shot.id,
          path: shot.framedPath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const screenshots: ScreenshotResult = {
      repoUrl: result.repoUrl,
      repoName: result.repoName,
      theme: result.theme,
      viewports: result.viewports as string[],
      routes: result.routes,
      frames,
    };
    log("done", { frameCount: frames.length, durationMs: Date.now() - started });
    return screenshots;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logErr("pre-generation failed", { message, durationMs: Date.now() - started });
    return null;
  }
}

async function preGenerateVideo(
  source: WeeklySource,
  options: {
    routes?: string[];
    viewport?: ViewportName;
    durationMs?: number;
    format?: RepoVideoFormat;
  } = {},
): Promise<VideoResult | null> {
  if (!source.repoUrl) return null;
  const callId = Math.random().toString(36).slice(2, 8);
  const log = (...args: unknown[]) => console.log(`[pre-video ${callId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[pre-video ${callId}]`, ...args);
  const routes = pickScreenshotRoutes(source.routes, options.routes).slice(0, 3);
  const viewport = options.viewport ?? "desktop";
  const durationMs = options.durationMs ?? 20000;
  const format = options.format ?? "webm";
  log(
    "starting",
    JSON.stringify({
      repoUrl: source.repoUrl,
      routes,
      viewport,
      durationMs,
      format,
    }),
  );
  const started = Date.now();
  try {
    const result = await generateRepoVideo({
      repoUrl: source.repoUrl,
      routes,
      viewport,
      durationMs,
      format,
    });
    const outputPath = result.encodedPath ?? result.rawPath;
    const video: VideoResult = {
      repoUrl: result.repoUrl,
      repoName: result.repoName,
      viewport: result.viewport,
      format: result.format,
      routes: result.routes,
      rawPath: result.rawPath,
      encodedPath: result.encodedPath,
      outputPath,
      durationMs: result.durationMs,
      width: result.width,
      height: result.height,
    };
    log("done", { outputPath, durationMs: Date.now() - started });
    return video;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logErr("pre-generation failed", { message, durationMs: Date.now() - started });
    return null;
  }
}

export type RunAllTargetsOptions = {
  source: WeeklySource;
  targets: DraftKind[];
  mood?: string;
  writingSamples?: string[];
  onScreenshot?: (result: ScreenshotResult) => void;
  onVideo?: (result: VideoResult) => void;
};

export type RunAllTargetsResult = {
  drafts: Partial<Record<DraftKind, DraftRunResult>>;
  screenshot: ScreenshotResult | null;
  video: VideoResult | null;
};

export async function runAllTargets(
  options: RunAllTargetsOptions,
): Promise<RunAllTargetsResult> {
  const kindList = options.targets.filter((t): t is DraftKind =>
    t === "newsletter" || t === "linkedin" || t === "x",
  );
  const needsAgent = kindList.includes("linkedin") || kindList.includes("newsletter");

  const screenshotP = needsAgent ? preGenerateScreenshot(options.source) : null;
  const videoP = needsAgent ? preGenerateVideo(options.source) : null;

  if (screenshotP) {
    screenshotP.then((result) => {
      if (result) options.onScreenshot?.(result);
    }, () => undefined);
  }
  if (videoP) {
    videoP.then((result) => {
      if (result) options.onVideo?.(result);
    }, () => undefined);
  }

  const drafts: Partial<Record<DraftKind, DraftRunResult>> = {};
  await Promise.all(
    kindList.map(async (target) => {
      if (target === "linkedin") {
        drafts.linkedin = await runLinkedInAgent({
          source: options.source,
          mood: options.mood,
          writingSamples: options.writingSamples,
          preGeneratedScreenshot: screenshotP,
          preGeneratedVideo: videoP,
          onScreenshot: options.onScreenshot,
          onVideo: options.onVideo,
        });
      } else if (target === "newsletter") {
        drafts.newsletter = await runNewsletterAgent({
          source: options.source,
          mood: options.mood,
          writingSamples: options.writingSamples,
          preGeneratedScreenshot: screenshotP,
          preGeneratedVideo: videoP,
          onScreenshot: options.onScreenshot,
          onVideo: options.onVideo,
        });
      } else {
        const text = await generateTextDraft({
          kind: "x",
          source: options.source,
          mood: options.mood,
          writingSamples: options.writingSamples,
        });
        drafts.x = { text, screenshots: null, video: null };
      }
    }),
  );

  const [screenshot, video] = await Promise.all([
    screenshotP ?? Promise.resolve(null),
    videoP ?? Promise.resolve(null),
  ]);

  return { drafts, screenshot, video };
}
