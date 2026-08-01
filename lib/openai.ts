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

const KIND_INSTRUCTIONS: Record<DraftKind, string> = {
  newsletter:
    "Write a 350–550 word sponsor-facing newsletter. Structure: a one-line headline, a 2-sentence intro that states the headline plainly, then 3–5 short sections with bolded section headers covering the week's shipped work, a 'what is next' beat, and a closing line. Tone is calm, partner-facing, and specific. Reference concrete items from the source. Do not invent partners, metrics, or testimonials.",
  linkedin:
    "Write a LinkedIn post of roughly 800–1,400 characters. Open with the single most interesting shipped item in one short line, then 3–5 short paragraphs that surface the other wins without bullet-list formatting. Close with a one-sentence forward-looking line. Tone is direct and status-forward. Reference concrete items from the source. Do not invent partners, metrics, or testimonials.",
  x: "Write a single X (Twitter) post, 240–280 characters total. Lead with the week's main shipping beat, weave in one or two concrete details, end on a forward note. Lowercase is fine. No hashtags unless natural. Do not invent partners, metrics, or testimonials.",
};

export async function generateTextDraft(
  kind: DraftKind,
  source: WeeklySource,
): Promise<string> {
  const client = getOpenAIClient();
  const context = buildSourceContext(source);
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
          `\n\nTask: ${KIND_INSTRUCTIONS[kind]}\n\n` +
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
