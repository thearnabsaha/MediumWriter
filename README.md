# Medium Writer

An AI-powered web app that generates Medium-ready articles in your personal writing style. Built with Next.js 14 (App Router), TypeScript, Tailwind CSS, Groq's GPT-OSS model family, and Tavily web research.

## What makes it Medium-ready

The app outputs articles using **only the HTML tags Medium's paste handler preserves**:

- `<h1>` (title), `<h2>` (section headings)
- `<p>`, `<strong>`, `<em>`
- `<ul>`, `<ol>`, `<li>`
- `<blockquote>`, `<a>`, `<hr>`

When you click **Copy to Medium**, the clipboard receives both `text/html` (clean Medium-safe HTML) and `text/plain` (Markdown). When you paste into Medium's editor, all your formatting — headings, bold, lists, links — is preserved.

## Features

- **Write Block** — enter a topic, click Generate, watch the article stream in.
- **Live model chip** — shows which Groq model is currently generating, with a fallback chain:
  1. `openai/gpt-oss-120b` (highest quality)
  2. `openai/gpt-oss-20b` (faster, cheaper)
  3. `openai/gpt-oss-safeguard-20b` (final fallback)

  If all three are rate-limited or unavailable, the app returns a clean **429** with a friendly retry message. Mid-stream fallbacks are also surfaced as a toast.
- **Tavily research toggle** — when enabled, the app first runs a Tavily web search (advanced depth, 5 sources) and feeds the findings into the LLM prompt as a `RESEARCH CONTEXT` block. The LLM weaves the facts in naturally — no inline citations or footnote markers (so Medium paste stays clean).
- **Style Block** — save up to 5 of your previous writing samples. The AI mimics your tone, sentence length, and vocabulary.
- **Medium-style preview** — serif typography, generous line-height, max-width prose.
- **Copy to Medium** — one-click clipboard copy with formatting preserved.
- **Inline edit** — toggle edit mode to tweak the output before copying.
- **Export as Markdown** — download the raw `.md` file.
- **Regenerate** — try a different take on the same topic.
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

Streams Medium-safe Markdown using a JSON-line (NDJSON) wire format.

Request body:

```json
{
  "prompt": "string (1-2000 chars)",
  "styleBlocks": ["string (max 5000 chars each)"],
  "research": [{ "title": "...", "url": "...", "content": "..." }]
}
```

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
  api/generate/route.ts   # streaming Groq endpoint with model fallback chain
  api/research/route.ts   # Tavily web search endpoint
  layout.tsx              # fonts, dark-mode wrapper
  page.tsx                # two-column layout
  globals.css             # Medium-style typography
components/
  WriteBlock.tsx          # NDJSON stream parser, model chip, research toggle
  StyleBlock.tsx
  OutputPreview.tsx
  DarkModeToggle.tsx
  Spinner.tsx
lib/
  ai.ts                   # MODEL_FALLBACK_CHAIN + prompt builder
  styleProcessor.ts       # heuristic style summary
  markdownToMediumHtml.ts # Medium-safe HTML converter
  copyToMedium.ts         # clipboard with text/html + text/plain
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
