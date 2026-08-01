import fs from "node:fs/promises";

import { Agent, run, tool, type AgentOutputType, type RunResult } from "@openai/agents";
import { z } from "zod";

import { generateRepoShots, VIEWPORT_PRESETS, THEMES } from "./repo-shot";
import { buildSourceContext } from "./openai";
import type { WeeklySource } from "./weekly-source";

export const AGENT_MODEL = "gpt-5.6";
export const SCREENSHOT_TOOL_NAME = "take_screenshots";

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

export type DraftRunResult = {
  text: string;
  screenshots: ScreenshotResult | null;
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
};

export function buildScreenshotTool(options: BuildScreenshotToolOptions = {}) {
  return tool({
    name: SCREENSHOT_TOOL_NAME,
    description:
      "Clone a GitHub repo into a throwaway workspace, install dependencies, boot the dev server, and capture framed screenshots of one or more routes at multiple viewports. " +
      "Returns base64 PNG frames that the caller can embed in the post. Use this whenever the source includes an `App repo (screenshottable)` URL and you want to reference the actual UI in the draft.",
    parameters: screenshotToolParams,
    execute: async (input: ScreenshotToolParams) => {
      const callId = Math.random().toString(36).slice(2, 8);
      const slog = (...args: unknown[]) => console.log(`[screenshot-tool ${callId}]`, ...args);
      const slogErr = (...args: unknown[]) => console.error(`[screenshot-tool ${callId}]`, ...args);
      slog("invoked", {
        repoUrl: input.repoUrl,
        routes: input.routes,
        viewports: input.viewports,
        theme: input.theme,
        title: input.title,
      });
      const started = Date.now();
      let result: Awaited<ReturnType<typeof generateRepoShots>>;
      try {
        result = await generateRepoShots({
          repoUrl: input.repoUrl,
          routes: input.routes,
          viewports: input.viewports as Parameters<typeof generateRepoShots>[0]["viewports"],
          theme: input.theme as Parameters<typeof generateRepoShots>[0]["theme"],
          title: input.title,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        const stack = err instanceof Error ? err.stack : undefined;
        slogErr("generateRepoShots threw", { message, stack });
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

const SHARED_RULES = [
  "Audience: non-technical readers (sponsors, partners, and general users). They do not write code and do not follow engineering workflows. Write so a curious but non-technical person can read it end-to-end and feel informed, not lost.",
  "Never reveal the product's plumbing. Do not mention GitHub, commits, pull requests, commit SHAs, repository paths, branches, merges, voice-note IDs, internal tags, or any other artifact of how the post was generated. To the reader, the writing should feel like a calm, human update from the team, not an automated digest of source code.",
  "Source the writing in user-facing reality, not engineering reality. Cover only what matters to the end user or a sponsor: visible UI/visual changes, new or changed functionality, security and privacy improvements, testing/quality changes that affect reliability, and anything else that a sponsor or user would actually care about. Skip internal refactors, dependency churn, tooling changes, and other developer-only work unless they have a direct, visible user benefit (and even then, frame it in user terms).",
  "Keep it tight and high-signal. Lead with what shipped and why it matters, not the journey. Skip filler, throat-clearing, and restating the headline. Every sentence should earn its place.",
  "Tone: natural and effortless, never forced, breathless, hype-driven, or AI-synthesized. No generic openers ('This week was a busy one...'), no manufactured enthusiasm, no em-dash-heavy cadence. Sound like a real person who happened to write the update.",
  "You only use information present in the supplied source data.",
  "You never invent partner names, metrics, or testimonials.",
  "You avoid em dashes; use hyphens, colons, or rewrite instead.",
  "If the source includes an `App repo (screenshottable)` URL, you MUST call `take_screenshots` at least once before producing the draft, choosing routes that show the most relevant shipped work (the home page is always a safe default).",
  "Do not describe the screenshots in the draft unless they make the post more useful. Reference the visual only when it adds concrete value (e.g. 'the new digest view on mobile').",
  "Return ONLY the draft text, no preamble, no labels, no surrounding quotes.",
].join("\n");

function buildUserPrompt(source: WeeklySource, kind: "newsletter" | "linkedin", mood: string | undefined, toneLine: string): string {
  const kindLabel = kind === "linkedin" ? "LinkedIn post" : "newsletter";
  const instructions =
    kind === "linkedin"
      ? "Write a LinkedIn post of roughly 800-1,400 characters for non-technical readers (sponsors, partners, and general users). Open with the single most interesting shipped item in one short line, then 3-5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Use minimal Markdown (line breaks, occasional **bold** for emphasis). Tone is direct, calm, and status-forward - never breathless or hype-driven. Reference concrete user-facing items from the source. Do not invent partners, metrics, or testimonials, and do not reference GitHub, commits, PRs, or any internal artifact."
      : "Write a 350-550 word sponsor-facing newsletter for non-technical readers (sponsors, partners, and general users). Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3-5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, specific, and effortless - never synthetic or forced. Use Markdown for structure (headings with ##, bold with **, lists with -). Reference concrete user-facing items from the source. Do not invent partners, metrics, or testimonials, and do not reference GitHub, commits, PRs, or any internal artifact.";

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
};

export type DraftAgent = Agent<unknown, AgentOutputType>;

function buildDraftAgents({ screenshotTool }: BuildAgentsOptions): { linkedinAgent: DraftAgent; newsletterAgent: DraftAgent } {
  const linkedinAgent: DraftAgent = new Agent({
    name: "LinkedIn Draft Agent",
    handoffDescription: "Writes a LinkedIn post for the weekly update.",
    instructions:
      "You write LinkedIn posts for a small dev team's weekly update, aimed at non-technical readers (sponsors, partners, and general users). The post should read like a calm, human update from the team, not an automated engineering digest.\n" +
      SHARED_RULES,
    model: AGENT_MODEL,
    tools: [screenshotTool],
  });

  const newsletterAgent: DraftAgent = new Agent({
    name: "Newsletter Draft Agent",
    handoffDescription: "Writes a sponsor-facing newsletter for the weekly update.",
    instructions:
      "You write sponsor-facing newsletters for a small dev team's weekly update, aimed at non-technical readers (sponsors, partners, and general users). The newsletter should read like a calm, human update from the team, not an automated engineering digest.\n" +
      SHARED_RULES,
    model: AGENT_MODEL,
    tools: [screenshotTool],
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
};

export async function runLinkedInAgent(
  options: RunLinkedInAgentOptions,
): Promise<DraftRunResult> {
  return runDraftAgentWithScreenshots("linkedin", options);
}

export type RunNewsletterAgentOptions = RunDraftAgentOptions & {
  onScreenshot?: (result: ScreenshotResult) => void;
};

export async function runNewsletterAgent(
  options: RunNewsletterAgentOptions,
): Promise<DraftRunResult> {
  return runDraftAgentWithScreenshots("newsletter", options);
}

async function runDraftAgentWithScreenshots(
  kind: "linkedin" | "newsletter",
  options: RunDraftAgentOptions & { onScreenshot?: (result: ScreenshotResult) => void },
): Promise<DraftRunResult> {
  let captured: ScreenshotResult | null = null;
  const screenshotTool = buildScreenshotTool({
    capture: (result) => {
      captured = result;
      options.onScreenshot?.(result);
    },
  });
  const { linkedinAgent, newsletterAgent } = buildDraftAgents({ screenshotTool });
  const agent = kind === "linkedin" ? linkedinAgent : newsletterAgent;
  const result = await runDraftAgent(agent, kind, options);
  const text = String(result.finalOutput ?? "").trim().replace(/—/g, "-");
  return { text, screenshots: captured };
}
