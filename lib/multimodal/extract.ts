import type { IngestTakeaways, IngestTranscript, KeyPhrase } from "./types";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "of", "to", "in", "on",
  "at", "by", "with", "without", "from", "into", "out", "over", "under", "is", "are", "was",
  "were", "be", "been", "being", "this", "that", "these", "those", "it", "its", "as", "so",
  "we", "i", "you", "he", "she", "they", "them", "their", "our", "your", "my", "me", "us",
  "what", "when", "where", "why", "how", "which", "who", "whom", "do", "does", "did", "done",
  "have", "has", "had", "having", "will", "would", "should", "could", "can", "may", "might",
  "must", "shall", "not", "no", "yes", "ok", "okay", "yeah", "yep", "hey", "hi", "hello",
  "just", "very", "really", "actually", "basically", "literally", "kind", "sort", "like",
  "going", "got", "get", "getting", "go", "going", "gonna", "wanna", "want", "wanted",
  "think", "thought", "know", "knew", "feel", "felt", "see", "saw", "seen", "look", "looked",
  "make", "made", "say", "said", "tell", "told", "ask", "asked", "use", "used", "using",
  "thing", "things", "something", "anything", "everything", "nothing", "someone", "anyone",
  "people", "person", "guy", "guys", "stuff", "lot", "lots", "much", "many", "more", "less",
  "few", "all", "any", "some", "one", "two", "three", "first", "second", "third", "next",
  "last", "also", "too", "still", "now", "then", "after", "before", "during", "while",
  "because", "since", "though", "although", "however", "therefore", "thus", "hence",
  "about", "around", "between", "through", "across", "beyond", "within",
  "up", "down", "off", "on", "again", "back", "forward", "away", "near", "far", "here", "there",
  "right", "left", "front", "back", "top", "bottom", "side", "end", "start", "begin", "begun",
]);

const TONE_HINTS: Array<{ word: string; tone: string }> = [
  { word: "shipped", tone: "status-forward" },
  { word: "launched", tone: "status-forward" },
  { word: "fixed", tone: "status-forward" },
  { word: "released", tone: "status-forward" },
  { word: "thanks", tone: "grateful" },
  { word: "love", tone: "enthusiastic" },
  { word: "amazing", tone: "enthusiastic" },
  { word: "great", tone: "enthusiastic" },
  { word: "excited", tone: "enthusiastic" },
  { word: "hate", tone: "frustrated" },
  { word: "broken", tone: "frustrated" },
  { word: "blocked", tone: "frustrated" },
  { word: "concern", tone: "concerned" },
  { word: "worried", tone: "concerned" },
  { word: "careful", tone: "concerned" },
  { word: "partner", tone: "professional" },
  { word: "sponsor", tone: "professional" },
  { word: "team", tone: "professional" },
  { word: "engineer", tone: "professional" },
  { word: "engineering", tone: "professional" },
  { word: "weekly", tone: "professional" },
  { word: "update", tone: "professional" },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[`*_~>#]/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s'-]/gu, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^['-]+|['-]+$/g, ""))
    .filter((token) => token.length > 1 && !/^\d+$/.test(token));
}

export function extractKeyPhrases(text: string, limit = 12): KeyPhrase[] {
  const tokens = tokenize(text);
  if (!tokens.length) return [];
  const counts = new Map<string, number>();
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const total = tokens.length;
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map<KeyPhrase>(([phrase, count]) => ({
      phrase,
      count,
      weight: Math.min(1, (count / Math.max(1, total)) * Math.log2(2 + count)),
    }));
  return ranked;
}

export function detectTone(text: string): string {
  const lower = text.toLowerCase();
  const tally = new Map<string, number>();
  for (const hint of TONE_HINTS) {
    const re = new RegExp(`\\b${hint.word}\\b`, "gi");
    const matches = lower.match(re);
    if (matches) tally.set(hint.tone, (tally.get(hint.tone) ?? 0) + matches.length);
  }
  if (!tally.size) return "neutral";
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function pickQuotes(text: string, limit = 2): string[] {
  const sentences = splitSentences(text);
  const ranked = sentences
    .map((sentence) => {
      const tokens = tokenize(sentence).filter((t) => !STOPWORDS.has(t));
      const unique = new Set(tokens).size;
      const lengthScore = sentence.length > 220 ? 0.4 : sentence.length < 60 ? 0.5 : 1;
      const quoteScore = /["'“”]/.test(sentence) ? 1.4 : 1;
      const firstPerson = /\b(we|i|our team|our)\b/i.test(sentence) ? 1.1 : 1;
      return { sentence, score: unique * lengthScore * quoteScore * firstPerson };
    })
    .filter((item) => item.sentence.length >= 40 && item.sentence.length <= 240)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const quotes: string[] = [];
  for (const item of ranked) {
    const key = item.sentence.toLowerCase().slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    quotes.push(item.sentence);
    if (quotes.length === limit) break;
  }
  return quotes;
}

export function summarizeSentences(text: string, maxSentences = 4): string {
  const sentences = splitSentences(text);
  if (!sentences.length) return "";
  if (sentences.length <= maxSentences) return sentences.join(" ");
  const phraseSet = new Map<string, number>();
  const phraseTokens = new Map<string, Set<string>>();
  for (const sentence of sentences) {
    const tokens = new Set(tokenize(sentence).filter((t) => !STOPWORDS.has(t)));
    for (const token of tokens) {
      phraseSet.set(token, (phraseSet.get(token) ?? 0) + 1);
      if (!phraseTokens.has(token)) phraseTokens.set(token, new Set());
      phraseTokens.get(token)!.add(sentence);
    }
  }
  const scored = sentences.map((sentence) => {
    const tokens = tokenize(sentence).filter((t) => !STOPWORDS.has(t));
    let score = 0;
    for (const token of tokens) score += phraseSet.get(token) ?? 0;
    const lengthPenalty = sentence.length > 280 ? 0.6 : sentence.length < 50 ? 0.7 : 1;
    return { sentence, score: (score / Math.max(1, tokens.length)) * lengthPenalty };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .map((item) => item.sentence)
    .join(" ");
}

function deriveThemes(text: string, phrases: KeyPhrase[]): string[] {
  const themes = new Set<string>();
  for (const { phrase } of phrases.slice(0, 6)) {
    if (phrase.length < 4) continue;
    themes.add(phrase);
  }
  const pairs: Array<[RegExp, string]> = [
    [/ship|launch|release|deploy/i, "shipping"],
    [/bug|fix|broken|patch/i, "reliability"],
    [/perf|slow|fast|speed|latency/i, "performance"],
    [/design|ui|ux|visual/i, "design"],
    [/partner|sponsor|customer|client/i, "partners"],
    [/price|cost|revenue|growth/i, "growth"],
    [/auth|login|signup|onboard/i, "onboarding"],
    [/api|endpoint|webhook|integration/i, "integrations"],
    [/test|spec|coverage/i, "quality"],
    [/docs|guide|readme/i, "docs"],
    [/recruit|hiring|interview/i, "hiring"],
    [/plan|roadmap|next|backlog/i, "planning"],
  ];
  for (const [pattern, label] of pairs) {
    if (pattern.test(text)) themes.add(label);
  }
  return [...themes].slice(0, 6);
}

export function buildBullets(text: string, phrases: KeyPhrase[], limit = 4): string[] {
  const sentences = splitSentences(text);
  const scored = sentences
    .map((sentence) => {
      const tokens = tokenize(sentence).filter((t) => !STOPWORDS.has(t));
      let score = 0;
      for (const token of tokens) {
        const phrase = phrases.find((p) => p.phrase === token);
        if (phrase) score += phrase.weight;
      }
      const lengthFactor = sentence.length > 240 ? 0.55 : sentence.length < 50 ? 0.7 : 1;
      return { sentence, score: score * lengthFactor };
    })
    .filter((item) => item.sentence.length >= 35)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of scored) {
    const key = item.sentence.toLowerCase().slice(0, 36);
    if (seen.has(key)) continue;
    seen.add(key);
    const cleaned = item.sentence
      .replace(/^(so|um|uh|well|like|and then)\b[, ]*/i, "")
      .trim();
    bullets.push(cleaned);
    if (bullets.length === limit) break;
  }
  if (!bullets.length && phrases.length) {
    for (const phrase of phrases.slice(0, limit)) {
      bullets.push(`Mentioned "${phrase.phrase}" ${phrase.count} times`);
    }
  }
  return bullets;
}

export function buildTakeaways(text: string, opts: { phraseLimit?: number; bulletLimit?: number } = {}): IngestTakeaways {
  const phraseLimit = opts.phraseLimit ?? 12;
  const bulletLimit = opts.bulletLimit ?? 4;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const phrases = extractKeyPhrases(cleaned, phraseLimit);
  const themes = deriveThemes(cleaned, phrases);
  const tone = detectTone(cleaned);
  const summary = summarizeSentences(cleaned, 4);
  const bullets = buildBullets(cleaned, phrases, bulletLimit);
  const quotes = pickQuotes(cleaned, 2);
  return { summary, bullets, keyPhrases: phrases, themes, tone, quotes };
}

export function transcriptToText(transcript: IngestTranscript): string {
  return transcript.segments.length
    ? transcript.segments.map((seg) => seg.text.trim()).join(" ").replace(/\s+/g, " ").trim()
    : transcript.fullText.trim();
}

export function transcriptDurationMs(transcript: IngestTranscript): number {
  if (!transcript.segments.length) return 0;
  return transcript.segments[transcript.segments.length - 1].endMs;
}