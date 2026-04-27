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

STRICT RULES — these will break Medium or hurt the article if violated:
- NEVER use code fences (no \`\`\`), NEVER use inline code backticks
- NEVER use tables
- NEVER use images or HTML tags
- NEVER use ### or deeper headings
- NEVER include footnotes, citations, or reference markers like [1]
- NEVER use emojis. ZERO emojis anywhere in the output. No 🎯, no 👉, no 🚀, no 🧠 — none.
- NEVER paste a raw URL — always use [descriptive text](url)

USE MEDIUM FEATURES RICHLY:
- **Bold** key terms, names, and pivotal phrases (at least one per section).
- *Italicize* for emphasis, asides, or single-concept highlights.
- Use a > blockquote at least once to spotlight a powerful sentence.
- Use bullet lists when listing 3+ parallel items, numbered lists for steps/sequences.
- Use --- between major sections for visual rhythm.

ARTICLE STRUCTURE (follow exactly):
1. # Catchy, click-worthy title (one line)
2. Hook intro: 2-3 SHORT paragraphs (each max 3 lines) that grab attention
3. 3-5 body sections, each starting with ## heading, with:
   - Short paragraphs (max 2-3 lines each)
   - Bullet lists where they help readability
   - At least one **bold** phrase per section
4. Include these EXACT plain-text placeholders, each at least once, in natural spots (no emojis, no decorations — just the text):
   - [Add your link here]
   - [Add your personal story here]
5. ## Conclusion section with a strong wrap-up
6. Final paragraph as a clear Call-to-Action (ask readers to clap, comment, follow, or try something)

PHOTO SUGGESTIONS:
- Where the article would benefit from a photo, insert ONE LINE in this exact format:
  > Photo suggestion: [search "keywords here" on Unsplash](https://unsplash.com/s/photos/keywords-here)
  Replace "keywords here" with 2-4 visually concrete keywords drawn from the section.
- Add at most 2 photo suggestions across the article, only where they genuinely help.

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
  /**
   * Optional reference article whose voice/structure should be mimicked.
   * If omitted, the model polishes the source in place using its own voice.
   */
  templateArticle?: string;
  /** Optional extra style samples (saved Style Blocks) to reinforce voice. */
  styleBlocks?: string[];
  /** Optional Tavily research for sprinkling real links into the rewrite. */
  research?: ResearchSnippet[];
};

/** Estimate word count of plain markdown by stripping markup and counting tokens. */
export function estimateWordCount(markdown: string): number {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return 0;
  return stripped.split(" ").filter(Boolean).length;
}

const REWRITE_RULES_COMMON = `OUTPUT FORMAT — Medium-safe MARKDOWN only (Medium's editor accepts only these on paste):
- # for the title (exactly ONE # title at the top)
- ## for section headings (NEVER use ### or deeper)
- **bold** for keywords and key phrases (use generously — at least one bold per paragraph where natural)
- *italic* for emphasis, asides, or highlighting a single concept
- - for bullet lists, 1. for numbered lists
- > for blockquotes (pull-quotes that highlight a powerful sentence)
- [link text](https://url) for links — embed naturally inside sentences, never as bare URLs
- --- on its own line as a section break between major parts

USE MEDIUM FEATURES RICHLY:
- Bold key terms, names, and pivotal phrases.
- Italicize for tone shifts, internal monologue, or asides.
- Use blockquotes to spotlight one strong sentence per article (or two in long pieces).
- Use bullet lists when listing 3+ parallel items.
- Use numbered lists for steps, rankings, or sequences.
- Use --- between major sections so the reader gets visual rhythm.
- Embed every external link inline inside descriptive anchor text — NEVER paste raw URLs.

STRICT RULES — these BREAK Medium or hurt the article if violated:
- NEVER use code fences (no \`\`\`), NEVER use inline code backticks (\`)
- NEVER use tables, HTML tags, raw <img>, or <div>
- NEVER use ### or deeper headings
- NEVER add citations, footnote markers, or reference numbers like [1], [2], (Source)
- NEVER use emojis. ZERO emojis anywhere in the output. No 🎯, no 👉, no 🚀, no 🧠 — none.
- NEVER paste a raw URL — always use [descriptive text](url)

PHOTO SUGGESTIONS:
- Where the article would benefit from a photo (hero, between major sections), insert ONE LINE that reads exactly like this format:
  > Photo suggestion: [search "keywords here" on Unsplash](https://unsplash.com/s/photos/keywords-here)
  Replace "keywords here" with 2-4 visually concrete keywords drawn from the section.
  Use the > blockquote prefix so it visually stands out and the user can click through to find an image.
- Add at most 2-3 photo suggestions across the article, only where they genuinely help.`;

const REWRITE_SYSTEM_PROMPT_TEMPLATED = `You are an expert Medium blog rewriter. Your job: take the SOURCE ARTICLE the user already wrote and rewrite it as a fresh, polished Medium article that reads as if the author of the TEMPLATE ARTICLE wrote it.

Preserve from SOURCE ARTICLE:
- The core ideas, arguments, examples, and any specific facts or data
- The author's intent and main takeaways
- Any links or proper nouns mentioned (keep them as-is, but reformat as inline [text](url) anchors)

Adopt from TEMPLATE ARTICLE:
- Tone and voice (formal vs. casual, warm vs. direct, etc.)
- Sentence rhythm and average sentence length
- Paragraph density (short punchy paragraphs vs. flowing prose)
- Section structure and pacing (how the writer opens, transitions, builds, closes)
- Word choice and signature phrases (use sparingly, do NOT plagiarize)
- The way headings, bullets, and emphasis are used

DO NOT:
- Copy sentences verbatim from the TEMPLATE ARTICLE
- Add facts, claims, or examples that are not in the SOURCE ARTICLE (the RESEARCH CONTEXT, if provided, is the only allowed source of new facts and external links)
- Drop important ideas from the SOURCE ARTICLE

WORD COUNT TARGET:
- The rewrite should be APPROXIMATELY THE SAME LENGTH as the SOURCE ARTICLE (within ±15% of its word count). Do NOT pad. Do NOT drastically shorten.

ARTICLE STRUCTURE:
1. # Catchy, click-worthy title (rewrite the source's title in the template's headline style)
2. Hook intro: 2-3 short paragraphs that grab attention
3. 3-5 body sections, each with ## heading, short paragraphs, bullets/numbered lists where they help, and at least one **bold** phrase per section
4. At least one > blockquote pull-quote spotlighting a powerful sentence
5. ## Conclusion section with a strong wrap-up
6. Final paragraph as a clear Call-to-Action (clap, comment, follow, subscribe)

${REWRITE_RULES_COMMON}

Output ONLY the rewritten markdown article. No preamble, no explanations, no closing remarks.`;

const REWRITE_SYSTEM_PROMPT_NEUTRAL = `You are an expert Medium blog editor. Your job: take the SOURCE ARTICLE the user already wrote and rewrite it as a polished Medium-ready version of itself, KEEPING the user's own voice intact.

Preserve from SOURCE ARTICLE:
- The user's voice, tone, vocabulary, and personality (do NOT make it more formal, do NOT make it more casual — match what's there)
- Every core idea, argument, example, fact, and data point
- All links and proper nouns (reformat as inline [text](url) anchors but keep them all)
- The author's intent and main takeaways

Upgrade in the rewrite:
- Tighten sentences. Fix awkward phrasing. Trim filler words.
- Restructure into clear ## sections with proper Medium-style headings if the source is one long blob.
- Add Medium formatting (bold for keywords, italic for emphasis, > blockquotes for power lines, bullet/numbered lists where helpful, --- between major sections).
- If RESEARCH CONTEXT is provided, weave 2-4 of its real links naturally into the article as inline anchors to add credibility — but only when they genuinely support a sentence already in the source.

DO NOT:
- Change the author's voice or vocabulary register
- Add new facts, claims, or examples (the RESEARCH CONTEXT is the only allowed source of new external links)
- Drop ideas from the source

WORD COUNT TARGET:
- The rewrite should be APPROXIMATELY THE SAME LENGTH as the SOURCE ARTICLE (within ±15% of its word count). Do NOT pad. Do NOT drastically shorten.

ARTICLE STRUCTURE:
1. # Catchy, click-worthy title (refine the source's title — keep its meaning)
2. Hook intro that matches the source's opening intent
3. 3-5 body sections with ## headings, short paragraphs, and Medium formatting
4. At least one > blockquote pull-quote
5. ## Conclusion section
6. Final CTA paragraph

${REWRITE_RULES_COMMON}

Output ONLY the rewritten markdown article. No preamble, no explanations, no closing remarks.`;

export function buildRewriteMessages({
  oldArticle,
  templateArticle,
  styleBlocks,
  research,
}: BuildRewriteArgs): ChatMessage[] {
  const extraSamples = (styleBlocks ?? [])
    .map((b) => b.trim())
    .filter(Boolean);

  const trimmedTemplate = templateArticle?.trim() ?? "";
  const hasTemplate = trimmedTemplate.length > 0;

  const wordCount = estimateWordCount(oldArticle);
  const minWords = Math.max(150, Math.round(wordCount * 0.85));
  const maxWords = Math.round(wordCount * 1.15);
  const wordCountHint = wordCount
    ? `\n\nWORD COUNT: The SOURCE ARTICLE is approximately ${wordCount} words. Your rewrite must be between ${minWords} and ${maxWords} words.`
    : "";

  const extraSection =
    extraSamples.length > 0
      ? `\n\nADDITIONAL STYLE SAMPLES (reinforce the voice):\n${extraSamples
          .map((b, i) => `--- EXTRA SAMPLE ${i + 1} ---\n${b}`)
          .join("\n\n")}`
      : "";

  const researchSection =
    research && research.length > 0
      ? `\n\nRESEARCH CONTEXT (real, recent web sources — use 2-4 of these as inline [link text](url) anchors where they genuinely support a sentence already in the SOURCE ARTICLE; do NOT add new facts beyond what the source claims; do NOT cite or footnote, just embed the link inline):\n${research
          .slice(0, 5)
          .map(
            (r, i) =>
              `--- SOURCE ${i + 1}: ${r.title} (${r.url}) ---\n${r.content.slice(0, 600)}`,
          )
          .join("\n\n")}`
      : "";

  const userContent = hasTemplate
    ? `TEMPLATE ARTICLE (mimic this writing style — voice, rhythm, structure; do NOT copy sentences):\n${trimmedTemplate}${extraSection}${researchSection}\n\n---\n\nSOURCE ARTICLE (rewrite this — keep all ideas, facts, and links intact, in the template's style):\n${oldArticle.trim()}${wordCountHint}\n\nNow rewrite the SOURCE ARTICLE as a polished Medium article in the TEMPLATE ARTICLE's style, following all the rules above.`
    : `SOURCE ARTICLE (rewrite this — keep the author's voice and vocabulary, just polish it for Medium):\n${oldArticle.trim()}${extraSection}${researchSection}${wordCountHint}\n\nNow rewrite the SOURCE ARTICLE as a polished Medium-ready version of itself, keeping the author's own voice intact, following all the rules above.`;

  const systemPrompt = hasTemplate
    ? REWRITE_SYSTEM_PROMPT_TEMPLATED
    : REWRITE_SYSTEM_PROMPT_NEUTRAL;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}
