import OpenAI from "openai";
import { SAMPLE_WEEK, summarizeSource, type WeeklySource } from "./sample-week";

export const TEXT_MODEL = "gpt-5.6-terra";
export const IMAGE_MODEL = "gpt-5.6";

let cachedClient: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_KEY is not set in the environment");
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

export function getSource(source?: WeeklySource): WeeklySource {
  return source ?? SAMPLE_WEEK;
}

export function buildSourceContext(source: WeeklySource): string {
  return summarizeSource(source);
}

type DraftKind = "newsletter" | "linkedin" | "x";

export type DraftRequest = {
  kind: DraftKind;
  source: WeeklySource;
  mood?: string;
  writingSamples?: string[];
};

const KIND_INSTRUCTIONS: Record<DraftKind, string> = {
  newsletter:
    "Write a 350–550 word sponsor-facing newsletter. Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3–5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, and specific. Use Markdown for structure (headings with ##, bold with **, lists with -). Reference concrete items from the source. Do not invent partners, metrics, or testimonials.",
  linkedin:
    "Write a LinkedIn post of roughly 800–1,400 characters. Open with the single most interesting shipped item in one short line, then 3-5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Use minimal Markdown (line breaks, occasional **bold** for emphasis). Tone is direct and status-forward. Reference concrete items from the source. Do not invent partners, metrics, or testimonials.",
  x: "Write a single X (Twitter) post, 240-280 characters total. Lead with the week's main shipping beat, weave in one or two concrete details, end on a forward note. Lowercase is fine. No hashtags unless natural. Do not invent partners, metrics, or testimonials.",
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
    typeof arg1 === "string"
      ? { kind: arg1, source: maybeSource ?? getSource() }
      : arg1;
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
        content:
          "You write matched drafts for a small dev team's weekly update. " +
          "You only use information present in the supplied source data. " +
          "You never invent partner names, metrics, or testimonials. " +
          "You avoid em dashes; use hyphens, colons, or rewrite instead.",
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

export async function generateImage(
  prompt: string,
): Promise<{ base64: string }> {
  const client = getOpenAIClient();
  const response = await client.responses.create({
    model: IMAGE_MODEL,
    input: prompt,
    tools: [{ type: "image_generation" }],
  });
  for (const item of response.output) {
    if (
      item.type === "image_generation_call" &&
      item.status === "completed" &&
      item.result
    ) {
      return { base64: item.result };
    }
  }
  throw new Error("No completed image_generation_call in response output");
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
    `Editorial illustration for a small dev team's weekly update. ` +
    `Theme: ${themes}. ` +
    `Style: flat, modern, minimal, warm neutral palette with one accent color, no logos, no text, no faces. ` +
    `Composition: ${aspect}.`
  );
}
