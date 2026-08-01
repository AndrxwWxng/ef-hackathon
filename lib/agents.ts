import fs from "node:fs/promises";

import { Agent, run, tool, type AgentOutputType, type RunResult } from "@openai/agents";
import { z } from "zod";

import { generateRepoShots, VIEWPORT_PRESETS, THEMES } from "./repo-shot";
import { buildSourceContext, GROUNDING_RULES } from "./openai";
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
      const result = await generateRepoShots({
        repoUrl: input.repoUrl,
        routes: input.routes,
        viewports: input.viewports as Parameters<typeof generateRepoShots>[0]["viewports"],
        theme: input.theme as Parameters<typeof generateRepoShots>[0]["theme"],
        title: input.title,
      });
      const frames: ScreenshotFrame[] = [];
      for (const shot of result.shots) {
        if (!shot.framedPath) continue;
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
};

export type DraftAgent = Agent<unknown, AgentOutputType>;

function buildDraftAgents({ screenshotTool }: BuildAgentsOptions): { linkedinAgent: DraftAgent; newsletterAgent: DraftAgent } {
  const linkedinAgent: DraftAgent = new Agent({
    name: "LinkedIn Draft Agent",
    handoffDescription: "Writes a LinkedIn post for the weekly update.",
    instructions:
      "You write LinkedIn posts for a small dev team's weekly update.\n" +
      SHARED_RULES,
    model: AGENT_MODEL,
    tools: [screenshotTool],
  });

  const newsletterAgent: DraftAgent = new Agent({
    name: "Newsletter Draft Agent",
    handoffDescription: "Writes a sponsor-facing newsletter for the weekly update.",
    instructions:
      "You write sponsor-facing newsletters for a small dev team's weekly update.\n" +
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
  const prompt = buildUserPrompt(options.source, kind, options.mood, resolveToneInstruction(options.mood));
  const sampleBlock = (options.writingSamples ?? [])
    .filter((sample) => sample.trim().length > 0)
    .map((sample, index) => `Sample ${index + 1}:\n${sample.trim()}`)
    .join("\n\n");
  const fullPrompt = sampleBlock
    ? `${prompt}\n\nWriting samples from the team (calibrate voice, do not lift sentences verbatim):\n${sampleBlock}`
    : prompt;
  return run<DraftAgent, unknown>(agent, fullPrompt, { maxTurns: 6 });
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
