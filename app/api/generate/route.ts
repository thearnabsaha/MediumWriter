import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  buildMessages,
  buildRewriteMessages,
  MAX_TOKENS,
  MODEL_FALLBACK_CHAIN,
  TEMPERATURE,
  type ChatMessage,
  type ResearchSnippet,
} from "@/lib/ai";

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
  templateArticle: z
    .string()
    .min(1, "Template article cannot be empty")
    .max(20000, "Template article is too long (max 20000 characters)"),
  styleBlocks: StyleBlocksSchema,
});

const RequestSchema = z.union([RewriteModeSchema, GenerateModeSchema]);

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
    // the validation message from the matching branch (rewrite vs generate).
    const requestedMode =
      typeof body === "object" &&
      body !== null &&
      (body as { mode?: unknown }).mode === "rewrite"
        ? "rewrite"
        : "generate";

    const branchSchema =
      requestedMode === "rewrite" ? RewriteModeSchema : GenerateModeSchema;
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
    messages = buildRewriteMessages({
      oldArticle: parsed.data.oldArticle,
      templateArticle: parsed.data.templateArticle,
      styleBlocks: parsed.data.styleBlocks,
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
