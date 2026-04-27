# Medium Writer

An AI-powered web app that generates **Medium-ready articles** AND **viral X (Twitter) Articles** in your personal writing style. Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, Groq's GPT-OSS model family, and Tavily web research.

## What makes it Medium-ready

The app outputs articles using **only the HTML tags Medium's paste handler preserves**:

- `<h1>` (title), `<h2>` (section headings)
- `<p>`, `<strong>`, `<em>`
- `<ul>`, `<ol>`, `<li>`
- `<blockquote>`, `<a>`, `<hr>`

When you click **Copy to Medium**, the clipboard receives both `text/html` (clean Medium-safe HTML) and `text/plain` (Markdown). When you paste into Medium's editor, all your formatting — headings, bold, lists, links — is preserved.

## Features

### Three writing modes (tabs at the top)

- **Generate from topic** — enter a prompt, optionally enable Tavily research, watch the article stream in. Output is **Medium-ready**.
- **Rewrite from article** — paste an existing article and pick a template:
  - **No template** — keeps your own voice, just polishes for Medium (tightens sentences, adds structure, bold/italic/blockquotes/lists).
  - **Saved sample** — rewrites in the voice of one of your saved Style Blocks.
  - **Paste new** — paste any reference article and rewrite in its style.
  - **Auto-enrich with Tavily** (on by default) — finds real recent web links and weaves them inline.
  - **Word-count parity** — the rewrite stays within ±15% of your source's length, with a live "matches source length" badge in the preview.
- **X Article** — write a viral long-form post for [X.com Articles](https://x.com/i/article/compose). Two sub-modes:
  - **From topic** — sharp hook, punchy paragraphs, Medium-style polish but tuned for X's scrolling reader.
  - **From article** — paste any long-form article and convert it into an X Article that keeps every idea, fact, and link, but reshapes voice and rhythm.
  - **Auto-enrich with Tavily** (on by default) — pulls in real, recent web sources and weaves them in as inline anchors.
  - **X-Article-safe formatting** — uses only the tags X's editor preserves: `## H2`, `### H3`, `#### H4`, `**bold**`, `*italic*`, `~~strike~~`, lists, blockquotes, links, `---` rules. **No `# H1` in the body** (X has a separate title field).
  - **Live character meter** — shows characters used vs. X's 25,000-char limit, plus a "within limit / short / over" badge.
  - **Copy to X** + **Open X compose** — one-click clipboard copy (HTML + plain) plus a button that opens [x.com/i/article/compose](https://x.com/i/article/compose) in a new tab so you can paste immediately.

### Medium features used in every output

The system prompt instructs the model to use Medium's full formatting toolbox:

- `# Title`, `## Section headings`
- `**bold**` for keywords (at least one per section)
- `*italic*` for emphasis and asides
- `> blockquote` for pull-quotes
- `- bullet` and `1. numbered` lists
- `---` horizontal rules between major sections
- `[descriptive text](url)` inline anchors (never raw URLs)
- **Photo suggestions** as clickable Unsplash search links inside blockquotes, e.g.
  `> Photo suggestion: [search "morning coffee" on Unsplash](https://unsplash.com/s/photos/morning-coffee)`

### Hard guarantees

- **Zero emojis** — the prompt forbids them and the client strips any that slip through (defense in depth using `\p{Extended_Pictographic}`).
- **Medium-safe HTML only** — no code fences, no tables, no `<img>` tags, no `###+` headings.
- **Live model chip** — shows which Groq model is currently generating, with a fallback chain:
  1. `openai/gpt-oss-120b` (highest quality)
  2. `openai/gpt-oss-20b` (faster, cheaper)
  3. `openai/gpt-oss-safeguard-20b` (final fallback)

  If all three are rate-limited or unavailable, the app returns a clean **429** with a friendly retry message. Mid-stream fallbacks are also surfaced as a toast.

### Other niceties

- **Style Block** — save up to 5 of your previous writing samples. The AI mimics your tone, sentence length, and vocabulary in both modes.
- **Sexy SVG favicon** — gradient "M" mark with green accent, light/dark friendly.
- **Medium-style preview** — serif typography, generous line-height, max-width prose.
- **Copy to Medium** — one-click clipboard copy with formatting preserved (`text/html` + `text/plain`).
- **Inline edit** — toggle edit mode to tweak the output before copying.
- **Export as Markdown** — download the raw `.md` file.
- **Regenerate / Rewrite again** — try a different take.
- **Dark mode** — toggle in the header.

## Setup (local)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the env template and add your keys:

   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local`:

   ```
   GROQ_API_KEY=gsk_...           # https://console.groq.com/keys
   TAVILY_API_KEY=tvly-...        # https://app.tavily.com (optional, only needed for research toggle)
   ```

3. Run the dev server:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Deploy to Vercel

This app is fully Vercel-compatible.

### One-time setup

1. Push the project to a GitHub repo.
2. On [vercel.com](https://vercel.com), click **Add New Project** and import the repo.
3. In **Project Settings -> Environment Variables**, add:
   - `GROQ_API_KEY` (Production, Preview, Development)
   - `TAVILY_API_KEY` (Production, Preview, Development) — optional, only needed for the research toggle
4. Click **Deploy**.

The included [vercel.json](vercel.json) raises the function timeout for the streaming routes:

- `/api/generate` — 60s (long-form streaming)
- `/api/research` — 30s

> Note: the 60s `maxDuration` requires a Pro plan. On Hobby, drop it to 10s in `vercel.json` — generation still works but very long articles may be cut off near the end.

### CLI deploy (optional)

```bash
npm i -g vercel
vercel login
vercel               # deploy a preview
vercel --prod        # deploy to production
```

When prompted, set `GROQ_API_KEY` and `TAVILY_API_KEY` via `vercel env add`.

## How style adaptation works

When you save writing samples in the Style Block, the app:

1. Stores them in `localStorage` (per-device, no server).
2. On generation, runs a heuristic analysis to extract average sentence length, vocabulary level, and tone keywords.
3. Injects a `STYLE CONTEXT` block into the system prompt along with the raw samples, so the LLM mimics your voice.

## How the model fallback works

`/api/generate` opens the first model in the chain. On any of these errors it transparently falls through to the next model:

- HTTP `429` (rate limit)
- HTTP `502 / 503 / 504`
- Errors mentioning `rate limit`, `quota`, `capacity`, `unavailable`, `overloaded`, `model_not_found`, `decommissioned`

If the **first** call to every model fails before any tokens stream, the route returns HTTP 429 with `details` listing each model's failure. If a model fails **mid-stream**, the route emits a `fallback` event so the UI can show a toast like *"Switched from GPT-OSS 120B to GPT-OSS 20B (rate limit reached)"*.

## API

### `POST /api/generate`

Streams Medium-safe (or X-Article-safe) Markdown using a JSON-line (NDJSON) wire format. Three modes via the `mode` field.

**Generate mode (Medium):**

```json
{
  "mode": "generate",
  "prompt": "string (1-2000 chars)",
  "styleBlocks": ["string (max 5000 chars each)"],
  "research": [{ "title": "...", "url": "...", "content": "..." }]
}
```

**Rewrite mode (Medium):**

```json
{
  "mode": "rewrite",
  "oldArticle": "string (1-20000 chars)",
  "templateArticle": "string (max 20000 chars, optional)",
  "styleBlocks": ["string (max 5000 chars each)"],
  "autoResearch": true,
  "research": [{ "title": "...", "url": "...", "content": "..." }]
}
```

**X Article mode:**

```json
{
  "mode": "x",
  "subMode": "topic | rewrite",
  "prompt": "string (required when subMode is 'topic', max 2000 chars)",
  "sourceArticle": "string (required when subMode is 'rewrite', max 20000 chars)",
  "styleBlocks": ["string (max 5000 chars each)"],
  "autoResearch": true,
  "research": [{ "title": "...", "url": "...", "content": "..." }]
}
```

When `autoResearch` is `true` and no `research` is supplied, the route runs a server-side Tavily search using a query derived from the old article (rewrite/x-rewrite) or the prompt (x-topic) and feeds the results into the prompt as `RESEARCH CONTEXT`. Tavily failures are non-fatal — generation proceeds without extra links.

Response: `application/x-ndjson; charset=utf-8` with one event per line:

```
{"type":"model","id":"openai/gpt-oss-120b","label":"GPT-OSS 120B","index":0}
{"type":"token","value":"# "}
{"type":"token","value":"Why "}
...
{"type":"fallback","from":"GPT-OSS 120B","to":"GPT-OSS 20B","reason":"rate limit"}
{"type":"token","value":"..."}
{"type":"done"}
```

### `POST /api/research`

Runs a Tavily web search.

```json
{
  "query": "string (1-500 chars)",
  "maxResults": 5
}
```

Returns:

```json
{
  "query": "...",
  "answer": "Tavily's synthesized answer",
  "results": [
    { "title": "...", "url": "...", "content": "...", "score": 0.91 }
  ]
}
```

## Project structure

```
app/
  api/generate/route.ts   # streaming Groq endpoint, generate + rewrite + x modes, fallback chain
  api/research/route.ts   # Tavily web search endpoint
  icon.svg                # favicon (32x32 / 64x64 SVG)
  apple-icon.tsx          # iOS home-screen icon (dynamic 180x180 PNG via next/og)
  layout.tsx              # fonts, dark-mode wrapper, metadata
  page.tsx                # two-column layout
  globals.css             # Medium-style typography
components/
  Workspace.tsx           # tabbed container (Generate / Rewrite / X Article)
  WriteBlock.tsx          # generate-mode UI, research toggle
  RewriteBlock.tsx        # rewrite-mode UI, template selector, auto-research, word-count meter
  XArticleBlock.tsx       # X-Article UI, sub-mode toggle, char meter, auto-research
  GenerationStatus.tsx    # model chip + fallback note + research status
  StyleBlock.tsx
  OutputPreview.tsx       # target-aware preview (medium | x), Copy + Open compose
  DarkModeToggle.tsx
  Spinner.tsx
lib/
  ai.ts                   # MODEL_FALLBACK_CHAIN + prompt builders + word-count helper
  useArticleStream.ts     # NDJSON parser hook + emoji stripper
  styleProcessor.ts       # heuristic style summary
  markdownToMediumHtml.ts # Medium-safe HTML converter
  markdownToXHtml.ts      # X-Article-safe HTML converter
  copyToMedium.ts         # clipboard with text/html + text/plain
  copyToX.ts              # X-Article clipboard + open-compose helper
  store.ts                # Zustand + localStorage
  tavily.ts               # Tavily search wrapper
vercel.json               # function maxDuration overrides
```

## Tech stack

- Next.js 14 (App Router)
- TypeScript 5
- Tailwind CSS 3
- Groq SDK (`openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `openai/gpt-oss-safeguard-20b`)
- Tavily Search API (`/search`, advanced depth)
- Zustand with localStorage persist
- react-markdown + remark-gfm + rehype-sanitize
- turndown (HTML -> Markdown for inline edits)
- Zod (request validation)
