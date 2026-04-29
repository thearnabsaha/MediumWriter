import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { z } from "zod";
import { buildThumbnailPromptMessages } from "@/lib/ai";
import {
  buildFallbackStream,
  NDJSON_RESPONSE_HEADERS,
  openInitialStream,
} from "@/lib/groqStream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  /** The article we're making a thumbnail for. */
  markdown: z
    .string()
    .min(1, "Markdown cannot be empty")
    .max(40000, "Markdown is too long (max 40000 characters)"),
  /** Where the thumbnail will be used — drives aspect ratio + safe-area. */
  target: z.enum(["medium", "x"]),
});

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
    const issue = parsed.error.issues[0];
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

  const messages = buildThumbnailPromptMessages({
    markdown: parsed.data.markdown,
    target: parsed.data.target,
  });

  const groq = new Groq({ apiKey });

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
