import { NextRequest } from "next/server";
import { z } from "zod";
import { tavilySearch } from "@/lib/tavily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  query: z
    .string()
    .min(1, "Query cannot be empty")
    .max(500, "Query is too long (max 500 characters)"),
  maxResults: z.number().int().min(1).max(10).optional(),
});

export async function POST(req: NextRequest) {
  if (!process.env.TAVILY_API_KEY) {
    return new Response(
      JSON.stringify({
        error:
          "Server is missing TAVILY_API_KEY. Add it to .env.local to enable research.",
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
    return new Response(
      JSON.stringify({
        error: parsed.error.issues[0]?.message ?? "Invalid request",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const result = await tavilySearch({
      query: parsed.data.query,
      maxResults: parsed.data.maxResults ?? 5,
    });
    return new Response(
      JSON.stringify({
        query: result.query,
        answer: result.answer,
        results: result.results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Research failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
