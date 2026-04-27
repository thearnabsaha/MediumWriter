import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  buildMessages,
  buildRewriteMessages,
  buildXArticleMessages,
  MAX_TOKENS,
  MODEL_FALLBACK_CHAIN,
  TEMPERATURE,
  type ChatMessage,
  type ResearchSnippet,
} from "@/lib/ai";
import { tavilySearch } from "@/lib/tavily";

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
 * Decide whether a Groq error means we should try the next model in the chain.
 *
 * Retryable:
 *   - 429 (rate-limit), 502/503/504 (transient server / capacity)
 *   - APIConnectionError / fetch failures (transient network)
 *   - quota / capacity / overloaded / unavailable / model_not_found / decommissioned
 *
 * NOT retryable:
 *   - 400 (bad request — same payload will fail on the next model too)
 *   - 401 / 403 (auth — same key will fail everywhere)
 */
function isRetryableGroqError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    status?: number;
    code?: string;
    name?: string;
    message?: string;
  };
  if (e.status === 429) return true;
  if (e.status === 502 || e.status === 503 || e.status === 504) return true;

  const name = (e.name ?? "").toLowerCase();
  if (
    name.includes("apiconnectionerror") ||
    name.includes("apiconnectiontimeouterror") ||
    name.includes("aborterror")
  ) {
    return true;
  }

  const msg = (e.message ?? "").toLowerCase();
  if (
    msg.includes("rate limit") ||
    msg.includes("quota") ||
    msg.includes("capacity") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("model_not_found") ||
    msg.includes("decommissioned") ||
    msg.includes("connection error") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound")
  ) {
    return true;
  }
  return false;
}

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

/** Encode one event as a single newline-terminated JSON line for the stream. */
function encodeEvent(
  encoder: TextEncoder,
  event:
    | { type: "model"; id: string; label: string; index: number }
    | { type: "token"; value: string }
    | { type: "fallback"; from: string; to: string; reason: string }
    | { type: "done" }
    | { type: "error"; message: string },
): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
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
  const encoder = new TextEncoder();

  /**
   * We open the first model BEFORE returning the response so we can return a
   * proper 429 status when EVERY model is exhausted. Once any model starts
   * producing tokens, we switch to streaming mode and stay at HTTP 200 even if
   * later fallbacks happen mid-stream (we surface those via `fallback` events).
   */
  let initialIndex = 0;
  let initialStream: AsyncIterable<{
    choices?: Array<{ delta?: { content?: string | null } }>;
  }> | null = null;
  const failureLog: string[] = [];

  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const model = MODEL_FALLBACK_CHAIN[i];
    try {
      initialStream = (await groq.chat.completions.create({
        model: model.id,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
      })) as unknown as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string | null } }>;
      }>;
      initialIndex = i;
      break;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      failureLog.push(`${model.id}: ${reason}`);
      if (!isRetryableGroqError(err)) {
        return new Response(
          JSON.stringify({
            error: `Generation failed on ${model.label}: ${reason}`,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
    }
  }

  if (!initialStream) {
    return new Response(
      JSON.stringify({
        error:
          "All models are rate-limited or unavailable. Please try again later.",
        details: failureLog,
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let currentIndex = initialIndex;
      let stream = initialStream as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string | null } }>;
      }>;

      const announceModel = (index: number) => {
        const m = MODEL_FALLBACK_CHAIN[index];
        controller.enqueue(
          encodeEvent(encoder, {
            type: "model",
            id: m.id,
            label: m.label,
            index,
          }),
        );
      };

      announceModel(currentIndex);

      while (true) {
        try {
          for await (const chunk of stream) {
            const token = chunk.choices?.[0]?.delta?.content;
            if (token) {
              controller.enqueue(
                encodeEvent(encoder, { type: "token", value: token }),
              );
            }
          }
          controller.enqueue(encodeEvent(encoder, { type: "done" }));
          controller.close();
          return;
        } catch (err) {
          const reason = err instanceof Error ? err.message : "stream error";
          if (!isRetryableGroqError(err)) {
            controller.enqueue(
              encodeEvent(encoder, {
                type: "error",
                message: `Stream failed: ${reason}`,
              }),
            );
            controller.close();
            return;
          }

          // Try the next model in the chain mid-stream.
          let nextStream: typeof stream | null = null;
          let nextIndex = currentIndex;
          for (let j = currentIndex + 1; j < MODEL_FALLBACK_CHAIN.length; j++) {
            const fromModel = MODEL_FALLBACK_CHAIN[currentIndex];
            const toModel = MODEL_FALLBACK_CHAIN[j];
            try {
              nextStream = (await groq.chat.completions.create({
                model: toModel.id,
                messages,
                temperature: TEMPERATURE,
                max_tokens: MAX_TOKENS,
                stream: true,
              })) as unknown as typeof stream;
              nextIndex = j;
              controller.enqueue(
                encodeEvent(encoder, {
                  type: "fallback",
                  from: fromModel.label,
                  to: toModel.label,
                  reason,
                }),
              );
              break;
            } catch (err2) {
              const r2 = err2 instanceof Error ? err2.message : "Unknown error";
              if (!isRetryableGroqError(err2)) {
                controller.enqueue(
                  encodeEvent(encoder, {
                    type: "error",
                    message: `Fallback to ${toModel.label} failed: ${r2}`,
                  }),
                );
                controller.close();
                return;
              }
            }
          }

          if (!nextStream) {
            controller.enqueue(
              encodeEvent(encoder, {
                type: "error",
                message:
                  "All models are rate-limited or unavailable. Please try again later.",
              }),
            );
            controller.close();
            return;
          }

          stream = nextStream;
          currentIndex = nextIndex;
          announceModel(currentIndex);
        }
      }
    },
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
