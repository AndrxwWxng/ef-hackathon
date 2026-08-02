import {
  Agent,
  imageGenerationTool,
  run,
  setDefaultOpenAIKey,
} from "@openai/agents";
import OpenAI from "openai";
import { summarizeSource, type WeeklySource } from "./weekly-source";

export const TEXT_MODEL = "gpt-5";
export const IMAGE_MODEL = "gpt-image-1";

let configured = false;
let cachedClient: OpenAI | null = null;

function ensureConfigured(): void {
  if (configured) return;
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_KEY is not set in the environment");
  }
  setDefaultOpenAIKey(apiKey);
  cachedClient = new OpenAI({ apiKey });
  configured = true;
}

function getOpenAIClient(): OpenAI {
  ensureConfigured();
  if (!cachedClient) {
    throw new Error("OpenAI client failed to initialize");
  }
  return cachedClient;
}

export function buildSourceContext(source: WeeklySource): string {
  return summarizeSource(source);
}

export type DraftKind = "newsletter" | "linkedin" | "x";

/**
 * The source block now carries a digest produced by reading the actual diffs.
 * These rules tell the writer to treat that as the real material, and to stay
 * quiet where the evidence is thin instead of filling the gap with tone.
 */
export const GROUNDING_RULES =
  "Grounding rules:\n" +
  "- When the source contains a 'Deep read of the codebase' section, that is the authoritative account of the week. Build the draft from it. The commit list below it is corroboration, not your source of claims.\n" +
  "- An item marked confidence 'low' may be mentioned only with hedged language, or left out. Never promote it to the headline.\n" +
  "- Items listed under 'Not established by the code' are things you must not assert. Do not restate them as achievements or plans.\n" +
  "- Only cite numbers that appear in the source. Do not compute impressive-sounding derived figures.\n" +
  "- The 'what is next' beat must come from the in-progress items in the source. If there are none, write that the next step is not yet decided, or omit the beat. Never invent a roadmap.\n" +
  "- If the window contains no user-facing change, say so plainly and describe the internal work honestly. A quiet week reported accurately is better than an invented launch.\n" +
  "- If the source says the code was not read this run, keep every claim to what a commit message literally states.";

const AUDIENCE_INSTRUCTIONS =
  "Audience: non-technical readers (sponsors, partners, and general users). They do not write code and do not follow engineering workflows. Write so a curious but non-technical person can read it end-to-end and feel informed, not lost.\n" +
  "They want to know what changed, what it means for them, and what is next. Voice the work in plain language. Keep concrete specs, numbers, and named features when they matter to the reader.\n" +
  "Never reveal the product's plumbing. Do not mention GitHub, commits, pull requests, commit SHAs, repository paths, branches, merges, voice-note IDs, internal tags, or any other artifact of how the post was generated. To the reader, the writing should feel like a calm, human update from the team, not an automated digest of source code.\n" +
  "Cover only what matters to the end user or a sponsor: visible UI/visual changes, new or changed functionality, security and privacy improvements, testing/quality changes that affect reliability, and anything else a sponsor or user would actually care about. Skip internal refactors, dependency churn, tooling changes, and other developer-only work unless they have a direct, visible user benefit (and even then, frame it in user terms).\n" +
  "Keep it tight and high-signal. Lead with what shipped and why it matters, not the journey. Skip filler, throat-clearing, and restating the headline. Every sentence should earn its place.\n" +
  "Tone: natural and effortless, never forced, breathless, hype-driven, or AI-synthesized. No generic openers, no manufactured enthusiasm, no em-dash-heavy cadence. Sound like a real person who happened to write the update.\n" +
  "Frame the writing as a progress check, not a play-by-play. Lead with the win, not the diff.\n" +
  "You never invent partners, metrics, or testimonials.\n" +
  "You avoid em dashes; use hyphens, colons, or rewrite instead.";

export type DraftRequest = {
  kind: DraftKind;
  source: WeeklySource;
  mood?: string;
  writingSamples?: string[];
};

const KIND_INSTRUCTIONS: Record<DraftKind, string> = {
  newsletter:
    "Write a 350-550 word sponsor-facing newsletter for non-technical readers. Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3-5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, specific, and effortless - never synthetic or forced. Use Markdown for structure (headings with ##, bold with **, lists with -). Reference concrete user-facing items from the source. Do not invent partners, metrics, or testimonials, and do not reference GitHub, commits, PRs, or any internal artifact.",
  linkedin:
    "Write a LinkedIn post of roughly 800-1,400 characters for non-technical readers. Open with the single most interesting shipped item in one short line, then 3-5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Use minimal Markdown (line breaks, occasional **bold** for emphasis). Tone is direct, calm, and status-forward - never breathless or hype-driven. Reference concrete user-facing items from the source. Do not invent partners, metrics, or testimonials, and do not reference GitHub, commits, PRs, or any internal artifact.",
  x: "Write a single X (Twitter) post, 240-280 characters total for non-technical readers. Lead with the week's main shipping beat, weave in one or two concrete user-facing details, end on a forward note. Lowercase is fine. No hashtags unless natural. Do not invent partners, metrics, or testimonials, and do not reference GitHub, commits, PRs, or any internal artifact.",
};

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

export async function generateTextDraft(req: DraftRequest): Promise<string>;
export async function generateTextDraft(
  kind: DraftKind,
  source: WeeklySource,
): Promise<string>;
export async function generateTextDraft(
  arg1: DraftKind | DraftRequest,
  maybeSource?: WeeklySource,
): Promise<string> {
  const req: DraftRequest =
    typeof arg1 === "string" ? { kind: arg1, source: maybeSource as WeeklySource } : arg1;
  if (!req.source) {
    throw new Error("A WeeklySource is required to generate a draft");
  }
  const client = getOpenAIClient();
  const context = buildSourceContext(req.source);
  const writtenSamples = (req.writingSamples ?? []).filter((s) => s.trim().length > 0);

  const sampleBlock =
    writtenSamples.length > 0
      ? `\n\nWriting samples from the team (calibrate voice, do not lift sentences verbatim):\n` +
        writtenSamples
          .map((s, i) => `Sample ${i + 1}:\n${s.trim()}`)
          .join("\n\n")
      : "";

  const toneLine = resolveToneInstruction(req.mood);

  const completion = await client.chat.completions.create({
    model: TEXT_MODEL,
    messages: [
      {
        role: "system",
        content: AUDIENCE_INSTRUCTIONS,
      },
      {
        role: "user",
        content:
          `Source data for the week (do not invent beyond this):\n\n` +
          context +
          sampleBlock +
          `\n\nTarget mood/tone (apply throughout): ${req.mood ? req.mood : "(no override, use neutral default)"}. ` +
          `Guidance: ${toneLine}.` +
          `\n\nTask: ${KIND_INSTRUCTIONS[req.kind]}\n\n` +
          `Return ONLY the draft text, no preamble, no labels.`,
      },
    ],
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error(`Empty response from ${TEXT_MODEL}`);
  return text.replace(/—/g, "-");
}

function imageAgent(): Agent {
  return new Agent({
    name: "image-agent",
    model: TEXT_MODEL,
    instructions:
      "Generate a single image that matches the user's prompt using the image_generation tool. Do not write any text.",
    tools: [
      imageGenerationTool({
        model: IMAGE_MODEL,
      }),
    ],
  });
}

function extractBase64Image(result: unknown): { base64: string } {
  const items = (
    result as { newItems?: Array<{ rawItem?: unknown }> }
  )?.newItems;
  if (!Array.isArray(items)) {
    throw new Error("Image generation failed: no run items returned");
  }
  for (const runItem of items) {
    const raw = runItem?.rawItem as
      | { type?: string; name?: string; output?: string; result?: string }
      | undefined;
    if (!raw || raw.type !== "hosted_tool_call") continue;
    if (raw.name && raw.name !== "image_generation") continue;
    const output = raw.output ?? raw.result;
    if (typeof output !== "string" || output.length === 0) continue;
    const base64 = parseImageOutput(output);
    if (base64) return { base64 };
  }
  throw new Error("Image generation failed: no image output found");
}

function parseImageOutput(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        result?: string;
        output?: string;
        b64_json?: string;
      };
      const candidate =
        parsed.result ?? parsed.output ?? parsed.b64_json ?? null;
      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    } catch {
      // fall through and treat as raw base64
    }
  }
  return trimmed;
}

export async function generateImage(
  prompt: string,
): Promise<{ base64: string }> {
  ensureConfigured();
  const result = await run(imageAgent(), prompt, {});
  return extractBase64Image(result);
}

export type GeneratedArtifacts = {
  newsletter: string;
  linkedin: string;
  x: string;
  linkedinImage?: { base64: string };
  xImage?: { base64: string };
};

export type GenerateAllRequest = {
  source?: WeeklySource;
  mood?: string;
  writingSamples?: string[];
};

export async function generateAll(
  req: GenerateAllRequest = {},
): Promise<GeneratedArtifacts> {
  ensureConfigured();
  const source = req.source;
  if (!source) {
    throw new Error("A WeeklySource is required to generate artifacts");
  }
  const draftReq = (kind: DraftKind): DraftRequest => ({
    kind,
    source,
    mood: req.mood,
    writingSamples: req.writingSamples,
  });

  const newsletterP = generateTextDraft(draftReq("newsletter"));
  const linkedinP = generateTextDraft(draftReq("linkedin"));
  const xP = generateTextDraft(draftReq("x"));
  const linkedinImgP = generateImage(imagePromptForSource(source, "linkedin"));
  const xImgP = generateImage(imagePromptForSource(source, "x"));

  const [newsletter, linkedin, x, linkedinImage, xImage] = await Promise.all([
    newsletterP,
    linkedinP,
    xP,
    linkedinImgP,
    xImgP,
  ]);

  return { newsletter, linkedin, x, linkedinImage, xImage };
}

export function imagePromptForSource(
  source: WeeklySource,
  kind: DraftKind,
): string {
  const themes = source.pullRequests.map((p) => p.title).join("; ");
  const aspect =
    kind === "linkedin"
      ? "landscape 1200x627, suitable for a LinkedIn post card"
      : kind === "x"
        ? "square 1024x1024, suitable for an X post image"
        : "landscape 1200x600";
  return (
    `Draw an editorial illustration for a small dev team's weekly update. ` +
    `Theme: ${themes}. ` +
    `Style: flat, modern, minimal, warm neutral palette with one accent color, no logos, no text, no faces. ` +
    `Composition: ${aspect}.`
  );
}
