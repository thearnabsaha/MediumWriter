import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  buildMessages,
  buildRewriteMessages,
  buildXArticleMessages,
  type ChatMessage,
  type ResearchSnippet,
} from "@/lib/ai";
import { tavilySearch } from "@/lib/tavily";
import {
  buildFallbackStream,
  NDJSON_RESPONSE_HEADERS,
  openInitialStream,
} from "@/lib/groqStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ResearchSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
});

const StyleBlocksSchema = z
  .array(z.string().max(5000, "Each style sample must be under 5000 characters"))
  .max(10, "Too many style samples (max 10)")
  .default([]);

const GenerateModeSchema = z.object({
  mode: z.literal("generate").optional(),
  prompt: z
    .string()
    .min(1, "Prompt cannot be empty")
    .max(2000, "Prompt is too long (max 2000 characters)"),
  styleBlocks: StyleBlocksSchema,
  research: z.array(ResearchSchema).max(10).optional(),
});

const RewriteModeSchema = z.object({
  mode: z.literal("rewrite"),
  oldArticle: z
    .string()
    .min(1, "Old article cannot be empty")
    .max(20000, "Old article is too long (max 20000 characters)"),
  /** Optional template article — when omitted the model polishes in place. */
  templateArticle: z
    .string()
    .max(20000, "Template article is too long (max 20000 characters)")
    .optional(),
  styleBlocks: StyleBlocksSchema,
  /** Pre-computed research snippets (e.g. when client already called /api/research). */
  research: z.array(ResearchSchema).max(10).optional(),
  /** When true, run a server-side Tavily search using the old article's gist. */
  autoResearch: z.boolean().optional(),
});

const XArticleModeSchema = z
  .object({
    mode: z.literal("x"),
    /** Sub-mode: "topic" writes from a prompt, "rewrite" converts an article. */
    subMode: z.enum(["topic", "rewrite"]),
    prompt: z
      .string()
      .max(2000, "Prompt is too long (max 2000 characters)")
      .optional(),
    sourceArticle: z
      .string()
      .max(20000, "Source article is too long (max 20000 characters)")
      .optional(),
    styleBlocks: StyleBlocksSchema,
    research: z.array(ResearchSchema).max(10).optional(),
    autoResearch: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.subMode === "topic"
        ? !!v.prompt && v.prompt.trim().length > 0
        : !!v.sourceArticle && v.sourceArticle.trim().length > 0,
    (v) => ({
      message:
        v.subMode === "topic"
          ? "prompt is required when subMode is 'topic'"
          : "sourceArticle is required when subMode is 'rewrite'",
      path: v.subMode === "topic" ? ["prompt"] : ["sourceArticle"],
    }),
  );

const RequestSchema = z.union([
  XArticleModeSchema,
  RewriteModeSchema,
  GenerateModeSchema,
]);

/**
 * Derive a short, search-engine-friendly research query from a long article.
 *
 * Heuristic: take the first markdown # title if present, otherwise the first
 * 12 non-trivial words from the body. Cap at ~150 chars so Tavily gets a tight
 * query and we don't blow the request size.
 */
function deriveResearchQuery(article: string): string {
  const titleMatch = article.match(/^\s*#\s+(.+)$/m);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim().slice(0, 150);
  }
  const stripped = article
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "";
  const words = stripped.split(" ").filter((w) => w.length > 2);
  return words.slice(0, 12).join(" ").slice(0, 150);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "Server is missing GROQ_API_KEY. Add it to .env.local.",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    // For our union schema, dispatch on the request's `mode` field so we surface
    // the validation message from the matching branch (rewrite vs generate vs x).
    const rawMode =
      typeof body === "object" && body !== null
        ? (body as { mode?: unknown }).mode
        : undefined;
    const requestedMode =
      rawMode === "rewrite" ? "rewrite" : rawMode === "x" ? "x" : "generate";

    const branchSchema =
      requestedMode === "rewrite"
        ? RewriteModeSchema
        : requestedMode === "x"
          ? XArticleModeSchema
          : GenerateModeSchema;
    const branchParsed = branchSchema.safeParse(body);
    const issue = branchParsed.success
      ? parsed.error.issues[0]
      : branchParsed.error.issues[0];
    const path = issue?.path?.join(".");
    const message = issue?.message
      ? path
        ? `${path}: ${issue.message}`
        : issue.message
      : "Invalid request";

    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  let messages: ChatMessage[];
  if (parsed.data.mode === "rewrite") {
    let rewriteResearch: ResearchSnippet[] | undefined =
      parsed.data.research as ResearchSnippet[] | undefined;

    // If the client asked for auto-research and didn't already supply snippets,
    // do a quick server-side Tavily call using a query derived from the old
    // article. We swallow Tavily errors so the rewrite still proceeds even when
    // Tavily is unreachable or unkeyed — the model just gets no extra links.
    if (
      parsed.data.autoResearch &&
      (!rewriteResearch || rewriteResearch.length === 0) &&
      process.env.TAVILY_API_KEY
    ) {
      try {
        const query = deriveResearchQuery(parsed.data.oldArticle);
        if (query) {
          const tavily = await tavilySearch({
            query,
            maxResults: 5,
            searchDepth: "advanced",
            includeAnswer: false,
          });
          rewriteResearch = tavily.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          }));
        }
      } catch {
        // intentionally non-fatal — fall through with no research
      }
    }

    messages = buildRewriteMessages({
      oldArticle: parsed.data.oldArticle,
      templateArticle: parsed.data.templateArticle,
      styleBlocks: parsed.data.styleBlocks,
      research: rewriteResearch,
    });
  } else if (parsed.data.mode === "x") {
    let xResearch: ResearchSnippet[] | undefined =
      parsed.data.research as ResearchSnippet[] | undefined;

    // Auto-research for X mode: derive a query from either the source article
    // (rewrite sub-mode) or the topic prompt (topic sub-mode), then enrich with
    // up to 5 Tavily results. Failures are non-fatal.
    if (
      parsed.data.autoResearch &&
      (!xResearch || xResearch.length === 0) &&
      process.env.TAVILY_API_KEY
    ) {
      try {
        const seed =
          parsed.data.subMode === "rewrite"
            ? (parsed.data.sourceArticle ?? "")
            : (parsed.data.prompt ?? "");
        const query = deriveResearchQuery(seed);
        if (query) {
          const tavily = await tavilySearch({
            query,
            maxResults: 5,
            searchDepth: "advanced",
            includeAnswer: false,
          });
          xResearch = tavily.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          }));
        }
      } catch {
        // intentionally non-fatal
      }
    }

    messages = buildXArticleMessages({
      prompt: parsed.data.prompt,
      sourceArticle: parsed.data.sourceArticle,
      styleBlocks: parsed.data.styleBlocks,
      research: xResearch,
    });
  } else {
    messages = buildMessages({
      topic: parsed.data.prompt,
      styleBlocks: parsed.data.styleBlocks,
      research: parsed.data.research as ResearchSnippet[] | undefined,
    });
  }

  const groq = new Groq({ apiKey });

  // Open the first model BEFORE returning the response so we can return a
  // proper 429 when EVERY model is exhausted. Once any model starts producing
  // tokens, we switch to streaming mode and stay at HTTP 200 even if later
  // fallbacks happen mid-stream (we surface those via `fallback` events).
  const initial = await openInitialStream(groq, messages);
  if (!initial.ok) {
    if (initial.nonRetryableMessage) {
      return new Response(
        JSON.stringify({ error: initial.nonRetryableMessage }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        error:
          "All models are rate-limited or unavailable. Please try again later.",
        details: initial.failureLog,
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }

  const readable = buildFallbackStream({
    groq,
    messages,
    initialStream: initial.stream,
    initialIndex: initial.index,
  });

  return new Response(readable, {
    status: 200,
    headers: NDJSON_RESPONSE_HEADERS,
  });
}
