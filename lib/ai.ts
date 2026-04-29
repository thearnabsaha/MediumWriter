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

// ---------------------------------------------------------------------------
// X (Twitter) Article mode — long-form article for x.com/i/article/compose
// ---------------------------------------------------------------------------

export type BuildXArticleArgs = {
  /** The user's topic prompt when subMode is "topic". */
  prompt?: string;
  /** The user's existing article when subMode is "rewrite". */
  sourceArticle?: string;
  /** Optional saved style samples to reinforce voice. */
  styleBlocks?: string[];
  /** Optional Tavily research for inline links and credibility. */
  research?: ResearchSnippet[];
};

const X_ARTICLE_RULES_COMMON = `OUTPUT FORMAT — X-Article-safe MARKDOWN only:
X (Twitter) Articles support a clean subset of markdown. Use ONLY these:
- ## for top-level section headings (X Articles have a separate title field — do NOT include a # title in the body)
- ### for subsections (only if needed; prefer ## sections)
- **bold** for keywords and pivotal phrases (use generously)
- *italic* for emphasis, asides, single-concept highlights
- ~~strikethrough~~ where it serves the rhetoric (sparingly)
- - for bullet lists, 1. for numbered lists
- > for blockquotes (pull-quotes that highlight a powerful sentence)
- [link text](https://url) for links — embed inside sentences, never as bare URLs
- --- on its own line as a section break

USE X FEATURES RICHLY:
- **Bold** key terms and pivotal phrases (at least one per section).
- *Italicize* for tone shifts and asides.
- Use a > blockquote to spotlight at least one strong sentence.
- Use bullet lists when listing 3+ parallel items, numbered lists for steps/sequences.
- Use --- between major sections for visual rhythm.
- Embed every external link inline inside descriptive anchor text.

VIRAL X VOICE:
- HOOK FIRST. The very first paragraph (before the first ##) must be a sharp, scroll-stopping opener — a counter-intuitive claim, a vivid image, a contrarian observation, or a sharp question. 1-3 short sentences max.
- Short, punchy paragraphs. 1-3 sentences. Lots of whitespace.
- Direct address: use "you" often. Talk to one reader.
- One idea per paragraph. No filler. No hedging.
- Concrete > abstract. Use specific numbers, names, examples.
- Confident, opinionated tone — but earned, not arrogant.
- End with a single-sentence kicker: a takeaway, a challenge, or a CTA.

STRICT RULES — these BREAK X Articles or hurt the post if violated:
- NO # H1 heading anywhere — the article title is a separate field on X
- NO code fences (no \`\`\`), NO inline code backticks
- NO tables, NO HTML tags, NO raw <img>
- NO emojis. ZERO emojis anywhere in the output. None.
- NO citations, footnote markers, or reference numbers like [1], [2], (Source)
- NO raw URLs — always use [descriptive text](url)
- NO hashtag spam — at most ONE relevant hashtag, only if it adds reach (usually skip them)

CHARACTER LIMIT:
- X Articles cap at 25,000 characters. Aim for 1,200-3,500 characters of focused, high-density writing — long enough to be substantive, short enough to actually finish on mobile.

PHOTO SUGGESTIONS:
- Where the article would benefit from a photo, insert ONE LINE in this exact format:
  > Photo suggestion: [search "keywords here" on Unsplash](https://unsplash.com/s/photos/keywords-here)
  Replace "keywords here" with 2-4 visually concrete keywords drawn from the section.
- Add at most 1-2 photo suggestions across the article.`;

const X_ARTICLE_SYSTEM_PROMPT_TOPIC = `You are an expert X (Twitter) Article writer who writes scroll-stopping, high-engagement long-form posts for X.

Your job: take a TOPIC and write a viral X Article that hooks the reader in the first sentence and keeps them reading to the end.

ARTICLE STRUCTURE (no title in body — X has a separate title field):
1. HOOK paragraph (1-3 short sentences, no heading above it). Counter-intuitive, sharp, specific. This is the most important sentence in the entire article.
2. 3-5 body sections, each with ## heading. Inside each section:
   - 2-4 short paragraphs (1-3 sentences each)
   - At least one **bold** phrase
   - Bullets/numbered lists where they help
3. At least one > blockquote pull-quote spotlighting a powerful sentence.
4. Final paragraph: a single-sentence kicker — a takeaway, a challenge, or a CTA. Punchy.

${X_ARTICLE_RULES_COMMON}

Output ONLY the X Article markdown body. No title (X provides its own title field). No preamble, no explanations, no closing remarks.`;

const X_ARTICLE_SYSTEM_PROMPT_REWRITE = `You are an expert X (Twitter) Article writer. Your job: take the SOURCE ARTICLE the user wrote (a Medium-style or generic long-form article) and convert it into a viral X Article — preserving every core idea while adapting the voice and shape for X's audience.

Preserve from SOURCE ARTICLE:
- The core ideas, arguments, examples, and any specific facts or data
- The author's intent and main takeaways
- All links and proper nouns (reformat as inline [text](url) anchors)

Adapt for X:
- A sharp HOOK as the very first sentence (no heading above it, no # title — X has a separate title field)
- Tighter, punchier paragraphs (1-3 sentences each)
- More direct address ("you")
- More confident, opinionated tone
- Whitespace and rhythm — X readers scroll fast
- If the source has a # title at the top, drop it (the title goes in X's separate title field, not the body)

DO NOT:
- Add facts or claims that are not in the SOURCE ARTICLE (the RESEARCH CONTEXT, if provided, is the only allowed source of new external links)
- Drop important ideas from the source
- Inflate the length — X Articles should feel tight

ARTICLE STRUCTURE (no title in body):
1. HOOK paragraph — sharp, scroll-stopping, 1-3 short sentences
2. 3-5 body sections, each with ## heading, short paragraphs, bold/italic/lists
3. At least one > blockquote pull-quote
4. Final single-sentence kicker as the CTA / takeaway

${X_ARTICLE_RULES_COMMON}

Output ONLY the X Article markdown body. No title. No preamble, no explanations.`;

export function buildXArticleMessages({
  prompt,
  sourceArticle,
  styleBlocks,
  research,
}: BuildXArticleArgs): ChatMessage[] {
  const samples = (styleBlocks ?? [])
    .map((b) => b.trim())
    .filter(Boolean);

  const styleSection =
    samples.length > 0
      ? `\n\nSTYLE CONTEXT (lightly mimic this voice — vocabulary, sentence rhythm — but keep the punchy X tone above all else):\n${samples
          .map((b, i) => `--- SAMPLE ${i + 1} ---\n${b}`)
          .join("\n\n")}`
      : "";

  const researchSection =
    research && research.length > 0
      ? `\n\nRESEARCH CONTEXT (real, recent web sources — weave 2-4 of these in as inline [link text](url) anchors where they genuinely support a claim; do NOT add new facts beyond the article's own argument; do NOT cite or footnote, just embed inline):\n${research
          .slice(0, 5)
          .map(
            (r, i) =>
              `--- SOURCE ${i + 1}: ${r.title} (${r.url}) ---\n${r.content.slice(0, 600)}`,
          )
          .join("\n\n")}`
      : "";

  const trimmedSource = sourceArticle?.trim() ?? "";

  if (trimmedSource) {
    const userContent = `SOURCE ARTICLE (convert this into a viral X Article — keep all ideas, facts, and links intact, but reshape voice and structure for X):\n${trimmedSource}${styleSection}${researchSection}\n\nNow write the X Article body in markdown following all the rules above. No # title — X has a separate title field.`;
    return [
      { role: "system", content: X_ARTICLE_SYSTEM_PROMPT_REWRITE },
      { role: "user", content: userContent },
    ];
  }

  const trimmedPrompt = prompt?.trim() ?? "";
  const userContent = `TOPIC:\n${trimmedPrompt}${styleSection}${researchSection}\n\nNow write the full X Article body in markdown following all the rules above. No # title — X has a separate title field.`;

  return [
    { role: "system", content: X_ARTICLE_SYSTEM_PROMPT_TOPIC },
    { role: "user", content: userContent },
  ];
}

// ---------------------------------------------------------------------------
// Translation mode — turn an existing Medium / X article into German
// ---------------------------------------------------------------------------

export type TranslateTarget = "medium" | "x";

export type BuildTranslateArgs = {
  /** The English markdown article to translate. */
  markdown: string;
  /** Where the translation will be pasted — affects the allowed Markdown subset. */
  target: TranslateTarget;
};

const TRANSLATE_RULES_COMMON = `STRICT RULES:
- Output ONLY the translated markdown. No preamble, no explanations, no notes, no "Here is the translation".
- PRESERVE the markdown structure 1-for-1: every heading stays a heading at the same level, every list item stays a list item, every blockquote stays a blockquote, every horizontal rule (---) stays.
- PRESERVE bold (**text**), italic (*text*), and strikethrough (~~text~~) on the SAME phrases — translate the inner words but keep the markers around the equivalent German phrase.
- PRESERVE every link's URL exactly. Translate ONLY the visible link text inside [ ]. Example: [my new book](https://example.com/book) → [mein neues Buch](https://example.com/book).
- PRESERVE every "Photo suggestion:" line literally as-is — keep the English keyword search inside the Unsplash URL (Unsplash works better with English keywords). Translate only the prose label "Photo suggestion" to "Foto-Vorschlag" if you wish, but the search keywords inside the URL stay in English.
- PRESERVE proper nouns (people, brands, products, place names) and acronyms exactly. Do NOT translate them.
- PRESERVE numbers, dates, and statistics exactly.
- PRESERVE inline placeholders like [Add your link here] — translate to [Füge hier deinen Link ein] but keep the square brackets.

GERMAN STYLE:
- Use natural, idiomatic German that a native speaker would write — not literal word-for-word translation.
- Use the informal "du" form throughout (this is the conversational register Medium and X readers expect).
- Keep sentences punchy. If the English uses short, sharp sentences, the German should too.
- Use German typographic conventions: „Anführungszeichen" instead of "double quotes" where dialogue or direct quotes appear, German number formatting (12.345,67 only when actually formatting numbers — leave clean numerals like 2026 alone).
- Translate idioms to their natural German equivalent rather than literally. "Hit the ground running" → "voll durchstarten", not "den Boden rennend treffen".

ZERO EMOJIS. None. The translated output must contain no emoji glyphs even if the source somehow does.`;

const TRANSLATE_SYSTEM_PROMPT_MEDIUM = `You are an expert German translator specializing in Medium articles. Your job: translate the given English Medium article into natural, idiomatic German while preserving Medium's exact markdown formatting.

Allowed markdown elements (Medium's editor accepts only these):
- # for the title (keep exactly ONE # title at the top)
- ## for section headings (NEVER use ### or deeper)
- **bold**, *italic*
- - for bullets, 1. for numbered lists
- > for blockquotes
- [text](url) for links
- --- for section breaks

${TRANSLATE_RULES_COMMON}

Output ONLY the German Medium article in markdown.`;

const TRANSLATE_SYSTEM_PROMPT_X = `You are an expert German translator specializing in X (Twitter) Articles. Your job: translate the given English X Article into natural, idiomatic German while preserving X's exact markdown formatting.

Allowed markdown elements:
- ## for top-level section headings (X Articles have a separate title field — do NOT add a # title in the body, and if the English source has a # title at the top, demote it to ## or drop it)
- ### / #### for subsections (only if the source uses them)
- **bold**, *italic*, ~~strikethrough~~
- - for bullets, 1. for numbered lists
- > for blockquotes
- [text](url) for links
- --- for section breaks

${TRANSLATE_RULES_COMMON}

Output ONLY the German X Article in markdown.`;

export function buildTranslateMessages({
  markdown,
  target,
}: BuildTranslateArgs): ChatMessage[] {
  const systemPrompt =
    target === "x"
      ? TRANSLATE_SYSTEM_PROMPT_X
      : TRANSLATE_SYSTEM_PROMPT_MEDIUM;

  const userContent = `Translate the following ${
    target === "x" ? "X Article" : "Medium article"
  } into natural, idiomatic German. Follow every rule above.\n\n--- ENGLISH ARTICLE ---\n${markdown.trim()}\n--- END ENGLISH ARTICLE ---\n\nNow output the full German translation as markdown only. No commentary.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}

// ---------------------------------------------------------------------------
// Thumbnail-prompt mode — write a ChatGPT/DALL-E image prompt for the article
// ---------------------------------------------------------------------------

export type ThumbnailTarget = "medium" | "x";

/**
 * Visual style families distilled from real X-Article header references.
 * Each family is a self-contained mini art-direction brief; the prompt builder
 * tells the model to pick ONE family per generation (or honors the user's
 * locked choice) so output is consistent and recognizable rather than
 * generic AI slop.
 */
export type ThumbnailStyle =
  | "auto"
  | "scrapbook-collage"
  | "editorial-flatlay"
  | "dark-diagram"
  | "cinematic-character"
  | "halftone-classical";

export const THUMBNAIL_STYLE_LABELS: Record<ThumbnailStyle, string> = {
  auto: "Auto (let the AI pick)",
  "scrapbook-collage": "Scrapbook collage",
  "editorial-flatlay": "Editorial flat-lay",
  "dark-diagram": "Dark diagrammatic UI",
  "cinematic-character": "Cinematic character on void",
  "halftone-classical": "Halftone classical illustration",
};

export type BuildThumbnailPromptArgs = {
  /** The article we're making a thumbnail for. */
  markdown: string;
  /** Where the thumbnail will be used — drives aspect ratio + safe area. */
  target: ThumbnailTarget;
  /** Optional locked style; if omitted or "auto", the AI picks the best fit. */
  style?: ThumbnailStyle;
};

/**
 * The five reference style families. Each entry is a tight art-direction
 * brief — what the image looks like, palette, lighting, composition cues,
 * and any concrete prop ideas. These are reused for both Medium and X targets,
 * with the canvas-shape advice layered on top.
 */
const STYLE_FAMILIES: Record<Exclude<ThumbnailStyle, "auto">, string> = {
  "scrapbook-collage": `SCRAPBOOK COLLAGE — a torn off-white paper texture as the canvas, with a single hand-drawn ink-and-watercolor cartoon character (or pair of characters) at the focal center performing a concrete action that expresses the article's main idea. Around the character, scatter 4-7 small "pinned" reference elements: mock screenshots of social posts or notes, hand-drawn sticker icons (file icons, RSS feed, PDFs, lightbulb, brain), and curved hand-drawn arrows showing flow from left to right. Use a casual sketchbook palette: pencil/ink lines, soft watercolor washes (denim blue, ochre, slate, dusty olive), small accent flecks of red or teal. Lighting reads as flat ambient daylight on paper. Loose, lived-in, hand-made energy — NOT polished vector graphics. Inspiration: artists like Jean Jullien or sketchbook editorial illustrators.`,

  "editorial-flatlay": `EDITORIAL FLAT-LAY — a clean off-white or warm-cream solid background panel with rounded corners, premium publication feel. The focal element is a tight horizontal row of 8-10 solid-color circular icon-stamps (deep navy or charcoal disks with simple monoline white icons inside — chat bubble, brain, gauge, shield-with-plus, moon, clock, folder, etc.) sitting in the lower-central third of the frame. Optionally, one small accent disk in a warm coral or saffron at the far left of the row breaks the rhythm. The upper half of the image is intentionally EMPTY (off-white) so a title can be added later in the editor. Mood: confident, minimal, "premium product launch" energy. Lighting: flat even diffused light, no shadows. Inspiration: Stripe Press, Linear changelog visuals, Notion product covers.`,

  "dark-diagram": `DARK DIAGRAMMATIC UI — a pitch-black background. The focal arrangement is a hand-drawn whiteboard-style diagram in chalky white strokes: 3-7 rounded rectangle "panels" (some glassy translucent purple or deep emerald, some thin-stroke white outlines) connected by hand-drawn white arrows with slightly wobbly lines. The center panel may contain a single photo cutout (a person's face, an object, or a key visual) or a punchy 1-2 word handwritten label. Side panels contain small monoline icons (play button, checkmark, gear) or short handwritten labels (Sleep, Exercise, Episode 1). Color: ~85% black background, white strokes, ONE saturated accent color (deep purple, emerald, or electric coral) on the focal panel only. Energy: Excalidraw / whiteboard / late-night strategy session. Lighting: subtle inner glow on the accent panels, otherwise flat.`,

  "cinematic-character": `CINEMATIC CHARACTER ON VOID — a pitch-black background filling the entire frame with massive negative space. ONE single photoreal or stylized 3D character (a person, creature, mascot, or stylized object) is positioned on the RIGHT third of the frame, three-quarter or slight-front view, looking toward the camera or off to the left. The LEFT two-thirds of the frame are completely empty black void — that empty space is the point and is where a title will be overlaid later in the editor. Subject is rim-lit from one side with subtle volumetric falloff so the silhouette pops cleanly off the black. Mood: bold, viral, slightly absurd or uncanny — confident and meme-aware. Palette: 95% black, with the subject providing the only color (skin tones, fabric, props). Inspiration: viral X / TikTok thumbnails, MrBeast-adjacent character framing.`,

  "halftone-classical": `HALFTONE CLASSICAL ILLUSTRATION — a flat saturated single-color background (electric teal, hot coral, sunflower yellow, or cobalt blue) fills the canvas. Floating in the upper-center, one large flat-color geometric accent shape (a perfect circle "sun", a thick rectangle, or a half-arch) in a complementary warm tone like burnt orange or amber. Over the accent shape, place ONE high-contrast vintage halftone-stipple illustration of a classical subject — a Greco-Roman statue head, a marble bust, an anatomy plate figure, an old-engraving animal, a botanical print — rendered in pure black-and-white halftone dots / engraving lines, mid-action and confident. The illustration is the focal element and reads at thumbnail size. Mood: bold, magazine-cover, slightly editorial-zine. Lighting: flat, no rendered shadows — the depth comes entirely from the halftone stippling. Inspiration: Higgsfield headers, vintage editorial design, modern tech-startup zine covers.`,
};

const THUMBNAIL_RULES_COMMON = `OUTPUT FORMAT:
- Output exactly ONE prompt, written as a single tightly-packed paragraph (or 2 short paragraphs at most). 90-180 words is ideal — long enough to lock in the chosen style family and the safe-area requirement, short enough to feed straight into ChatGPT.
- Do NOT wrap the prompt in quotes, code fences, or markdown. Do NOT prefix with "Prompt:" or any label. Output only the prompt text.
- Do NOT add commentary, alternatives, options, or "feel free to adjust" notes. The user copies your output verbatim into their image generator.
- ZERO emojis anywhere in the prompt.

PROMPT ANATOMY — weave all of these into one natural-prose paragraph:
1. STYLE FAMILY — name the chosen family in the first sentence (e.g. "A torn-paper scrapbook collage illustration..." or "A pitch-black cinematic character portrait..."). Lock to that family — do NOT mix two styles.
2. SUBJECT — one concrete focal scene that expresses the article's main idea. Be specific about object/person/action/spatial relationship. Avoid abstract concepts ("success", "growth"); pick a concrete visual metaphor.
3. COMPOSITION + SAFE-AREA — describe how the subject sits within the canvas and which area must remain visually quiet for crop and editor-overlay safety (see canvas-specific section above).
4. PALETTE — 2-4 named colors and their roles (e.g. "off-white paper background, denim-blue ink linework, ochre and slate watercolor washes, one small red accent fleck").
5. LIGHTING — the lighting cue from the chosen style family (flat ambient, rim-lit on black, halftone-only no-shadow, flat diffused, etc.).
6. TECHNICAL — render quality, finish, and the explicit aspect-ratio + dimensions string from the canvas-specific section above. End with the negative clause.

CRITICAL — DO NOT EMBED TITLE TEXT IN THE IMAGE:
- The article title and any subtitle will be added LATER in the X / Medium editor as a separate text overlay. The AI image must contain NO embedded title typography, NO headline, NO subtitle, NO publication name, NO byline.
- Small in-scene typography that is part of the illustration is OK (e.g. "Ep. 1" hand-lettered on a sticker icon, a fake mock tweet that is part of a collage, a hand-written "Sleep" label inside a diagram panel). These are NOT the article title — they are scene props.
- The big-typography references you may have seen ("Free Claude Tokens: 10 Habits...", "how to make viral tiktok ai character") had their title typed in by the editor on top of the AI image. Your prompt asks for the BACKGROUND IMAGE only.

NEGATIVE / EXCLUSIONS — End the prompt with this clause verbatim (or near-verbatim):
"No article-title typography, no headlines, no subtitles, no captions, no logos, no watermarks, no UI chrome, no chart axes, no AI-generated nonsense text."`;

const THUMBNAIL_SYSTEM_PROMPT_MEDIUM_HEADER = `You are an art director who writes razor-sharp image-generator prompts for Medium article cover images, in the style of high-end editorial publications.

OUTPUT CANVAS — Medium cover image:
- Aspect ratio: 16:9. Render dimensions: 1400 x 788 px (Medium's recommended size; minimum 600 x 338).
- Medium aggressively crops the cover for the homepage feed, publication feeds, social shares, mobile, and email digests. Your prompt MUST therefore demand:
  * The focal subject sits in the CENTRAL THIRD of the frame.
  * GENEROUS quiet padding on all four sides — about 15-20% of the width on the left/right and 15-20% of the height top/bottom must be visually quiet (background, sky, gradient, blur, soft texture, or empty paper) so every crop survives.
  * The composition reads at thumbnail size — one bold focal point, strong silhouette against a clean ground, high contrast.
- Mention "16:9 aspect ratio, 1400x788 px" and the safe-area padding requirement explicitly INSIDE the prompt itself.`;

const THUMBNAIL_SYSTEM_PROMPT_X_HEADER = `You are an art director who writes razor-sharp image-generator prompts for X (Twitter) Article header images, in the style of high-engagement viral X creators (Karpathy-style scrapbook collages, MrBeast-style character voids, magazine-cover halftone illustrations, Excalidraw-style dark diagrams, Stripe-Press-style editorial flat-lays).

OUTPUT CANVAS — X Article header image:
- Aspect ratio: 5:2 (ultra-wide). Render dimensions: 3840 x 1536 px (4K).
- X crops the edges in card previews and feeds. Your prompt MUST therefore demand:
  * The focal subject sits dead-center horizontally and in the CENTRAL VERTICAL THIRD.
  * GENEROUS quiet padding — at least 18-22% of the width on the LEFT and RIGHT must be empty / atmospheric (solid background, gradient, soft texture, void) because the ultra-wide format gets cropped tighter than 16:9 in card previews.
  * The composition reads at small sizes — one bold focal point, strong silhouette, high contrast.
- Because the canvas is ultra-wide, prefer wide horizontal compositions: a sweeping flat-lay, a long collage strip, a single subject offset to one third with massive empty space on the other side, or a centered focal element with broad atmospheric flanks.
- Mention "5:2 aspect ratio, 3840x1536 px (4K)" and the wide safe-area padding requirement explicitly INSIDE the prompt itself.`;

function buildStyleSelectorBlock(style: ThumbnailStyle): string {
  if (style === "auto") {
    return `STYLE SELECTION — read the article and pick the ONE style family below that best fits its tone, topic, and viral angle. Lock to that family for the entire prompt — do NOT mix two styles. State the family explicitly in your first sentence.

When in doubt:
- Technical / framework / "how it works" articles → DARK DIAGRAMMATIC UI or SCRAPBOOK COLLAGE.
- Personal essay / reflection / habits / advice → EDITORIAL FLAT-LAY or HALFTONE CLASSICAL ILLUSTRATION.
- Viral take / contrarian opinion / character-driven → CINEMATIC CHARACTER ON VOID.
- Cultural commentary / philosophy / big-idea → HALFTONE CLASSICAL ILLUSTRATION.
- Tools / product walkthroughs / SaaS → EDITORIAL FLAT-LAY or SCRAPBOOK COLLAGE.

THE FIVE STYLE FAMILIES:

1. ${STYLE_FAMILIES["scrapbook-collage"]}

2. ${STYLE_FAMILIES["editorial-flatlay"]}

3. ${STYLE_FAMILIES["dark-diagram"]}

4. ${STYLE_FAMILIES["cinematic-character"]}

5. ${STYLE_FAMILIES["halftone-classical"]}`;
  }

  const labelMap: Record<Exclude<ThumbnailStyle, "auto">, string> = {
    "scrapbook-collage": "SCRAPBOOK COLLAGE",
    "editorial-flatlay": "EDITORIAL FLAT-LAY",
    "dark-diagram": "DARK DIAGRAMMATIC UI",
    "cinematic-character": "CINEMATIC CHARACTER ON VOID",
    "halftone-classical": "HALFTONE CLASSICAL ILLUSTRATION",
  };

  return `STYLE — LOCKED. The user has chosen the ${labelMap[style]} family for this thumbnail. You MUST use this family — do not deviate, do not mix, do not propose alternatives. State the family explicitly in your first sentence.

STYLE FAMILY BRIEF:
${STYLE_FAMILIES[style]}`;
}

function buildThumbnailSystemPrompt(
  target: ThumbnailTarget,
  style: ThumbnailStyle,
): string {
  const canvasHeader =
    target === "x"
      ? THUMBNAIL_SYSTEM_PROMPT_X_HEADER
      : THUMBNAIL_SYSTEM_PROMPT_MEDIUM_HEADER;

  return `${canvasHeader}

${buildStyleSelectorBlock(style)}

Your job: read the article and write ONE concise, specific image-generator prompt that captures the article's essence using the style family above and the canvas constraints above.

${THUMBNAIL_RULES_COMMON}

Write the final prompt now. Output only the prompt.`;
}

export function buildThumbnailPromptMessages({
  markdown,
  target,
  style = "auto",
}: BuildThumbnailPromptArgs): ChatMessage[] {
  const systemPrompt = buildThumbnailSystemPrompt(target, style);

  const canvasDescription =
    target === "x"
      ? "X Article header (5:2 ultra-wide, 3840x1536 px / 4K)"
      : "Medium cover image (16:9, 1400x788 px, with safe-area padding for cropping)";

  const userContent = `Read the article below and write ONE image-generator prompt for its ${canvasDescription}. Follow every rule above. Remember: NO article-title typography in the image — the title goes in the editor as a separate overlay.\n\n--- ARTICLE ---\n${markdown.trim()}\n--- END ARTICLE ---\n\nOutput only the image prompt. No labels, no quotes, no commentary.`;

  return [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];
}
