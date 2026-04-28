import Groq from "groq-sdk";
import {
  MAX_TOKENS,
  MODEL_FALLBACK_CHAIN,
  TEMPERATURE,
  type ChatMessage,
} from "./ai";

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
export function isRetryableGroqError(err: unknown): boolean {
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

export type StreamEvent =
  | { type: "model"; id: string; label: string; index: number }
  | { type: "token"; value: string }
  | { type: "fallback"; from: string; to: string; reason: string }
  | { type: "done" }
  | { type: "error"; message: string };

/** Encode one event as a single newline-terminated JSON line for the stream. */
function encodeEvent(encoder: TextEncoder, event: StreamEvent): Uint8Array {
  return encoder.encode(JSON.stringify(event) + "\n");
}

type GroqChunkStream = AsyncIterable<{
  choices?: Array<{ delta?: { content?: string | null } }>;
}>;

/**
 * Open the first available model in the fallback chain. If every model fails
 * before producing any tokens, returns `null` and a `failureLog` so the caller
 * can return HTTP 429.
 */
export async function openInitialStream(
  groq: Groq,
  messages: ChatMessage[],
): Promise<
  | { ok: true; stream: GroqChunkStream; index: number }
  | { ok: false; failureLog: string[]; nonRetryableMessage?: string }
> {
  const failureLog: string[] = [];

  for (let i = 0; i < MODEL_FALLBACK_CHAIN.length; i++) {
    const model = MODEL_FALLBACK_CHAIN[i];
    try {
      const stream = (await groq.chat.completions.create({
        model: model.id,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_TOKENS,
        stream: true,
      })) as unknown as GroqChunkStream;
      return { ok: true, stream, index: i };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Unknown error";
      failureLog.push(`${model.id}: ${reason}`);
      if (!isRetryableGroqError(err)) {
        return {
          ok: false,
          failureLog,
          nonRetryableMessage: `Generation failed on ${model.label}: ${reason}`,
        };
      }
    }
  }

  return { ok: false, failureLog };
}

/**
 * Build an NDJSON ReadableStream that pipes Groq tokens to the client and
 * transparently falls through to the next model on transient mid-stream
 * failures. Emits `model`, `token`, `fallback`, `error`, and `done` events.
 */
export function buildFallbackStream({
  groq,
  messages,
  initialStream,
  initialIndex,
}: {
  groq: Groq;
  messages: ChatMessage[];
  initialStream: GroqChunkStream;
  initialIndex: number;
}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let currentIndex = initialIndex;
      let stream = initialStream;

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
          let nextStream: GroqChunkStream | null = null;
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
              })) as unknown as GroqChunkStream;
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
              const r2 =
                err2 instanceof Error ? err2.message : "Unknown error";
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
}

/**
 * Standard NDJSON response headers used by both /api/generate and
 * /api/translate.
 */
export const NDJSON_RESPONSE_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
};
