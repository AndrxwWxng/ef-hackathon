import {
  Agent,
  imageGenerationTool,
  run,
  setDefaultOpenAIKey,
  type AgentOutputItem,
  type RunItem,
} from "@openai/agents";
import { SAMPLE_WEEK, summarizeSource, type WeeklySource } from "./sample-week";

export const TEXT_MODEL = "gpt-5";
export const IMAGE_MODEL = "gpt-image-1";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_KEY is not set in the environment");
  }
  setDefaultOpenAIKey(apiKey);
  configured = true;
}

export function getSource(source?: WeeklySource): WeeklySource {
  return source ?? SAMPLE_WEEK;
}

export function buildSourceContext(source: WeeklySource): string {
  return summarizeSource(source);
}

export type DraftKind = "newsletter" | "linkedin" | "x";

const AUDIENCE_INSTRUCTIONS =
  "Audience: a non-technical sponsor or partner. They want to know what changed, " +
  "what it means for them, and what is next. " +
  "Voice the work in plain language. Keep concrete specs, numbers, and named features " +
  "when they matter to the reader. " +
  "Strip engineer-flavored identifiers that do not help the reader: do not mention " +
  "commit SHAs, repository paths, PR numbers, voice-note IDs, or internal tags. " +
  "Frame the writing as a progress check, not a play-by-play. Lead with the win, not the diff. " +
  "You never invent partners, metrics, or testimonials. " +
  "You avoid em dashes; use hyphens, colons, or rewrite instead.";

const KIND_INSTRUCTIONS: Record<DraftKind, string> = {
  newsletter:
    "Write a 350-550 word sponsor-facing newsletter. Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3-5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, and specific. Use Markdown for structure (headings with ##, bold with **, lists with -).",
  linkedin:
    "Write a LinkedIn post of roughly 800-1,400 characters. Open with the single most interesting shipped item in one short line, then 3-5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Use minimal Markdown (line breaks, occasional **bold** for emphasis). Tone is direct and status-forward.",
  x: "Write a single X (Twitter) post, 240-280 characters total. Lead with the week's main shipping beat, weave in one or two concrete details, end on a forward note. Lowercase is fine. No hashtags unless natural.",
};

const TONE_INSTRUCTIONS: Record<string, string> = {
  "default": "Use a natural, professional tone.",
  "calm and measured": "Use a calm, measured tone. Short sentences. No hype words.",
  "warm and personal": "Use a warm, first-person, personal tone. Speak directly to the reader.",
  "direct and punchy": "Use a direct, punchy, status-forward tone. Lead with the news.",
  "witty and a bit dry": "Use a witty, lightly dry tone. Occasional subtle humor is welcome; do not force jokes.",
  "playful and energetic": "Use a playful, energetic tone. Enthusiastic but not breathless.",
  "technical and matter-of-fact": "Use a technical, matter-of-fact tone. Engineer-coded, references files/PRs by name when useful.",
  "visionary and forward-looking": "Use a visionary, forward-looking tone. Frame the week's work inside a longer arc.",
};

const TEXT_AGENT_INSTRUCTIONS =
  "You write matched drafts for a small dev team's weekly update. " +
  AUDIENCE_INSTRUCTIONS +
  " Return ONLY the draft text, no preamble, no labels.";

const IMAGE_AGENT_INSTRUCTIONS =
  "You generate editorial illustrations for a small dev team's weekly update. " +
  "Use the image_generation tool exactly once per request. " +
  "Begin your tool message with the verb 'Draw' (the docs note that draw-style prompts perform better). " +
  "Never include text, logos, faces, commit SHAs, or repository paths in the prompt. " +
  "After the tool returns, reply with a single short line confirming the aspect ratio used.";

function resolveToneInstruction(mood?: string): string {
  if (!mood) return TONE_INSTRUCTIONS.default;
  const key = mood.trim().toLowerCase();
  if (TONE_INSTRUCTIONS[key]) return TONE_INSTRUCTIONS[key];
  return `Use a tone that matches this mood/voice guidance: "${mood}". Apply it consistently across the draft.`;
}

function textAgent(): Agent {
  return new Agent({
    name: "weekly-draft-writer",
    model: TEXT_MODEL,
    instructions: TEXT_AGENT_INSTRUCTIONS,
    modelSettings: {
      reasoning: { effort: "low" },
    },
  });
}

function imageAgent(): Agent {
  return new Agent({
    name: "weekly-illustration",
    model: TEXT_MODEL,
    instructions: IMAGE_AGENT_INSTRUCTIONS,
    modelSettings: {
      reasoning: { effort: "low" },
    },
    tools: [
      imageGenerationTool({
        model: IMAGE_MODEL,
        quality: "low",
        outputFormat: "png",
      }),
    ],
  });
}

type RunShape = {
  finalOutput: unknown;
  newItems: RunItem[];
  output: AgentOutputItem[];
};

function extractFinalText(result: RunShape): string {
  const fromOutput = result.finalOutput;
  if (typeof fromOutput === "string" && fromOutput.trim()) {
    return fromOutput.trim();
  }
  if (Array.isArray(fromOutput)) {
    const joined = fromOutput
      .map((item) =>
        typeof item === "string"
          ? item
          : item && typeof item === "object" && "text" in item
            ? String((item as { text: unknown }).text ?? "")
            : "",
      )
      .join("")
      .trim();
    if (joined) return joined;
  }
  if (fromOutput && typeof fromOutput === "object") {
    const obj = fromOutput as Record<string, unknown>;
    for (const key of ["text", "output_text", "content", "value"]) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  for (const item of result.newItems) {
    if (item.type !== "message_output_item") continue;
    const content = (item as unknown as {
      rawItem?: { content?: Array<{ text?: string; type?: string }> };
    }).rawItem?.content;
    if (!Array.isArray(content)) continue;
    const text = content
      .filter((p) => p && (p.type === "output_text" || typeof p.text === "string"))
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error(`Empty response from ${TEXT_MODEL}`);
}

function extractBase64Image(result: RunShape): { base64: string } {
  for (const item of result.newItems) {
    if (item.type !== "tool_call_output_item") continue;
    const toolItem = item as unknown as {
      rawItem?: { type?: string; status?: string; result?: string; output?: string };
      output?: unknown;
    };
    const raw = toolItem.rawItem;
    const rawType = raw?.type;
    const isImageGen =
      rawType === "image_generation_call" || rawType === "image_generation";
    if (!isImageGen) continue;
    const status = raw?.status;
    if (status && status !== "completed") continue;
    const candidate =
      (typeof raw?.result === "string" ? raw.result : undefined) ??
      (typeof raw?.output === "string" ? raw.output : undefined) ??
      (typeof toolItem.output === "string" ? (toolItem.output as string) : undefined);
    if (candidate && candidate.length > 0) {
      return { base64: candidate };
    }
  }
  throw new Error("No completed image_generation_call in run output");
}

export type DraftRequest = {
  kind: DraftKind;
  source: WeeklySource;
  mood?: string;
  writingSamples?: string[];
};

function buildDraftPrompt(req: DraftRequest): string {
  const { kind, source, mood, writingSamples } = req;
  const context = buildSourceContext(source);

  const sampleBlock =
    writingSamples && writingSamples.filter(Boolean).length > 0
      ? `\n\nWriting samples from the team (calibrate voice, do not lift sentences verbatim):\n` +
        writingSamples
          .filter((s) => s.trim().length > 0)
          .map((s, i) => `Sample ${i + 1}:\n${s.trim()}`)
          .join("\n\n")
      : "";

  const toneLine = resolveToneInstruction(mood);

  return (
    `Source data for the week (do not invent beyond this):\n\n` +
    context +
    sampleBlock +
    `\n\nTarget mood/tone (apply throughout): ${mood ? mood : "(no override, use neutral default)"}. ` +
    `Guidance: ${toneLine}.` +
    `\n\nTask: ${KIND_INSTRUCTIONS[kind]}\n\n` +
    `Return ONLY the draft text, no preamble, no labels.`
  );
}

export async function generateTextDraft(
  kind: DraftKind,
  source: WeeklySource,
): Promise<string>;
export async function generateTextDraft(req: DraftRequest): Promise<string>;
export async function generateTextDraft(
  kindOrReq: DraftKind | DraftRequest,
  maybeSource?: WeeklySource,
): Promise<string> {
  ensureConfigured();
  const req: DraftRequest =
    typeof kindOrReq === "string"
      ? { kind: kindOrReq, source: maybeSource ?? getSource() }
      : kindOrReq;
  const result = await run(textAgent(), buildDraftPrompt(req), {});
  const text = extractFinalText(result);
  return text.replace(/—/g, "-");
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
  const source = req.source ?? getSource();
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
