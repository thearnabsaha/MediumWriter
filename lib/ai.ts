import { formatStyleSummary, summarizeStyle } from "./styleProcessor";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ResearchSnippet = {
  title: string;
  url: string;
  content: string;
};

export type BuildPromptArgs = {
  topic: string;
  styleBlocks: string[];
  research?: ResearchSnippet[];
};

const SYSTEM_PROMPT = `You are an expert Medium blog writer who writes viral, engaging articles.

Write the article in MARKDOWN using ONLY these elements (Medium's editor accepts only these on paste):
- # for the title (use exactly ONE # title at the top)
- ## for section headings (NEVER use ### or deeper)
- **bold** and *italic* for emphasis
- - for bullet lists
- 1. for numbered lists
- > for blockquotes
- [text](url) for links
- --- on its own line for section breaks

STRICT RULES — these will break Medium if you violate them:
- NEVER use code fences (no \`\`\`), NEVER use inline code backticks
- NEVER use tables
- NEVER use images or HTML tags
- NEVER use ### or deeper headings
- NEVER include footnotes, citations, or reference markers like [1]

ARTICLE STRUCTURE (follow exactly):
1. # Catchy, click-worthy title (one line)
2. Hook intro: 2-3 SHORT paragraphs (each max 3 lines) that grab attention
3. 3-5 body sections, each starting with ## heading, with:
   - Short paragraphs (max 2-3 lines each)
   - Bullet lists where they help readability
   - Occasional **bold** for key phrases
4. Include these EXACT placeholders, each at least once, in natural spots:
   - 👉 Add your link here
   - 👉 Add your personal story here
5. ## Conclusion section with a strong wrap-up
6. Final paragraph as a clear Call-to-Action (ask readers to clap, comment, follow, or try something)

VOICE:
- Conversational, like talking to a friend
- Simple English (8th grade reading level)
- Short sentences (avg 12-18 words)
- Direct address: use "you" often
- One idea per paragraph

Output ONLY the markdown article. No preamble, no explanations, no closing remarks.`;

export function buildMessages({
  topic,
  styleBlocks,
  research,
}: BuildPromptArgs): ChatMessage[] {
  const summary = summarizeStyle(styleBlocks);
  const summaryText = formatStyleSummary(summary);

  const styleSamples = styleBlocks
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b, i) => `--- SAMPLE ${i + 1} ---\n${b}`)
    .join("\n\n");

  const styleSection =
    styleBlocks.length > 0
      ? `\n\nSTYLE CONTEXT (mimic this writing voice):\n${summaryText}\n\nWRITING SAMPLES FROM THE USER:\n${styleSamples}\n\nMatch the tone, sentence rhythm, and vocabulary of these samples while writing the article on the topic below.`
      : "";

  const researchSection =
    research && research.length > 0
      ? `\n\nRESEARCH CONTEXT (recent web findings — use selectively, paraphrase, do NOT add citations or footnote markers; only weave in the facts naturally):\n${research
          .slice(0, 5)
          .map(
            (r, i) =>
              `--- SOURCE ${i + 1}: ${r.title} (${r.url}) ---\n${r.content}`,
          )
          .join("\n\n")}`
      : "";

  const userContent = `TOPIC:\n${topic.trim()}${researchSection}${styleSection}\n\nNow write the full Medium article in markdown following all the rules above.`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

export type ModelEntry = {
  /** Exact Groq model id passed to the API. */
  id: string;
  /** Short human-friendly label shown in the UI chip. */
  label: string;
};

/**
 * Ordered fallback chain. The route tries the first model first; on rate-limit
 * or quota errors it falls through to the next. If all are exhausted the
 * client receives HTTP 429.
 */
export const MODEL_FALLBACK_CHAIN: ModelEntry[] = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { id: "openai/gpt-oss-safeguard-20b", label: "GPT-OSS Safeguard 20B" },
];

export const TEMPERATURE = 0.7;
export const MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// Rewrite-from-article mode
// ---------------------------------------------------------------------------

export type BuildRewriteArgs = {
  /** The user's existing article whose substance/ideas should be preserved. */
  oldArticle: string;
  /** A reference article whose voice, structure, and rhythm should be mimicked. */
  templateArticle: string;
  /** Optional extra style samples (saved Style Blocks) to reinforce voice. */
  styleBlocks?: string[];
};

const REWRITE_SYSTEM_PROMPT = `You are an expert Medium blog rewriter. Your job: take the SOURCE ARTICLE the user already wrote and rewrite it as a fresh, viral-ready Medium article that reads as if the author of the TEMPLATE ARTICLE wrote it.

Preserve from SOURCE ARTICLE:
- The core ideas, arguments, examples, and any specific facts or data
- The author's intent and main takeaways
- Any links or proper nouns mentioned (keep them as-is)

Adopt from TEMPLATE ARTICLE:
- Tone and voice (formal vs. casual, warm vs. direct, etc.)
- Sentence rhythm and average sentence length
- Paragraph density (short punchy paragraphs vs. flowing prose)
- Section structure and pacing (how the writer opens, transitions, builds, closes)
- Word choice and signature phrases (use sparingly, do NOT plagiarize)
- The way headings, bullets, and emphasis are used

DO NOT:
- Copy sentences verbatim from the TEMPLATE ARTICLE
- Add facts, claims, or examples that are not in the SOURCE ARTICLE
- Drop important ideas from the SOURCE ARTICLE
- Add citations, footnote markers, or reference numbers

OUTPUT FORMAT — Medium-safe MARKDOWN only (Medium's editor accepts only these on paste):
- # for the title (exactly ONE # title at the top)
- ## for section headings (NEVER use ### or deeper)
- **bold** and *italic* for emphasis
- - for bullet lists, 1. for numbered lists
- > for blockquotes
- [text](url) for links
- --- on its own line for section breaks

STRICT RULES — these break Medium if you violate them:
- NEVER use code fences (no \`\`\`), NEVER use inline code backticks
- NEVER use tables, images, or HTML tags
- NEVER use ### or deeper headings

ARTICLE STRUCTURE (still follow this Medium-friendly shape):
1. # Catchy, click-worthy title (rewrite the source's title in the template's headline style)
2. Hook intro: 2-3 short paragraphs that grab attention
3. 3-5 body sections, each with ## heading, short paragraphs, and bullets where useful
4. Include these EXACT placeholders, each at least once, in natural spots:
   - 👉 Add your link here
   - 👉 Add your personal story here
5. ## Conclusion section with a strong wrap-up
6. Final paragraph as a clear Call-to-Action

Output ONLY the rewritten markdown article. No preamble, no explanations, no closing remarks.`;

export function buildRewriteMessages({
  oldArticle,
  templateArticle,
  styleBlocks,
}: BuildRewriteArgs): ChatMessage[] {
  const extraSamples = (styleBlocks ?? [])
    .map((b) => b.trim())
    .filter(Boolean);

  const extraSection =
    extraSamples.length > 0
      ? `\n\nADDITIONAL STYLE SAMPLES FROM THE SAME AUTHOR AS THE TEMPLATE (reinforce the voice):\n${extraSamples
          .map((b, i) => `--- EXTRA SAMPLE ${i + 1} ---\n${b}`)
          .join("\n\n")}`
      : "";

  const userContent = `TEMPLATE ARTICLE (mimic this writing style — voice, rhythm, structure):\n${templateArticle.trim()}${extraSection}\n\n---\n\nSOURCE ARTICLE (rewrite this — keep all ideas, facts, and links intact, but in the template's style):\n${oldArticle.trim()}\n\nNow rewrite the SOURCE ARTICLE as a fresh Medium article in the TEMPLATE ARTICLE's style, following all the rules above.`;

  return [
    { role: "system", content: REWRITE_SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}
