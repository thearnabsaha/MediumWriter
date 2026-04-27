export type StyleSummary = {
  avgSentenceLength: number;
  vocabLevel: "simple" | "moderate" | "advanced";
  tone: string;
  totalSamples: number;
};

const TONE_KEYWORDS: Record<string, string[]> = {
  motivational: [
    "you can",
    "believe",
    "dream",
    "never give up",
    "achieve",
    "succeed",
    "potential",
    "growth",
  ],
  casual: [
    "yeah",
    "kinda",
    "stuff",
    "thing is",
    "honestly",
    "tbh",
    "lol",
    "anyway",
  ],
  analytical: [
    "data",
    "research",
    "study",
    "analysis",
    "evidence",
    "results",
    "according to",
    "statistics",
  ],
  storytelling: [
    "once",
    "remember when",
    "i was",
    "she said",
    "he told",
    "that day",
    "years ago",
  ],
  professional: [
    "leverage",
    "stakeholder",
    "strategy",
    "implement",
    "framework",
    "optimize",
    "deliverable",
  ],
  educational: [
    "let me explain",
    "in simple terms",
    "for example",
    "this means",
    "step by step",
    "here's how",
  ],
};

function countSentences(text: string): number {
  const matches = text.match(/[.!?]+(\s|$)/g);
  return matches ? matches.length : 1;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function detectVocabLevel(text: string): StyleSummary["vocabLevel"] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "simple";
  const longWords = words.filter((w) => w.replace(/[^a-z]/g, "").length >= 8);
  const ratio = longWords.length / words.length;
  if (ratio < 0.08) return "simple";
  if (ratio < 0.18) return "moderate";
  return "advanced";
}

function detectTone(text: string): string {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS)) {
    scores[tone] = keywords.reduce(
      (acc, kw) => acc + (lower.includes(kw) ? 1 : 0),
      0,
    );
  }
  const sorted = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([tone]) => tone);

  if (sorted.length === 0) return "neutral conversational";
  return sorted.join(" + ");
}

export function summarizeStyle(blocks: string[]): StyleSummary | null {
  const cleaned = blocks.map((b) => b.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;

  const combined = cleaned.join("\n\n");
  const totalWords = countWords(combined);
  const totalSentences = countSentences(combined);
  const avgSentenceLength =
    totalSentences > 0 ? Math.round(totalWords / totalSentences) : 0;

  return {
    avgSentenceLength,
    vocabLevel: detectVocabLevel(combined),
    tone: detectTone(combined),
    totalSamples: cleaned.length,
  };
}

export function formatStyleSummary(summary: StyleSummary | null): string {
  if (!summary) return "";
  return [
    `- Detected tone: ${summary.tone}`,
    `- Average sentence length: ${summary.avgSentenceLength} words`,
    `- Vocabulary level: ${summary.vocabLevel}`,
    `- Based on ${summary.totalSamples} writing sample(s)`,
  ].join("\n");
}
