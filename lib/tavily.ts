/**
 * Thin wrapper around Tavily's /search endpoint.
 *
 * Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
 *
 * We use `search_depth: "advanced"` so the LLM gets richer chunks to weave
 * into the article, and cap `max_results` to keep the prompt size sane.
 */

const TAVILY_ENDPOINT = "https://api.tavily.com/search";

export type TavilySearchResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
};

export type TavilySearchResponse = {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
};

export type TavilySearchOptions = {
  query: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced" | "fast" | "ultra-fast";
  topic?: "general" | "news";
  includeAnswer?: boolean;
};

export async function tavilySearch(
  options: TavilySearchOptions,
): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error("Server is missing TAVILY_API_KEY.");
  }

  const {
    query,
    maxResults = 5,
    searchDepth = "advanced",
    topic = "general",
    includeAnswer = true,
  } = options;

  const res = await fetch(TAVILY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: searchDepth,
      topic,
      max_results: maxResults,
      include_answer: includeAnswer,
      chunks_per_source: searchDepth === "advanced" ? 3 : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Tavily request failed (${res.status}): ${text || res.statusText}`,
    );
  }

  const data = (await res.json()) as {
    query?: string;
    answer?: string;
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      score?: number;
    }>;
  };

  const results: TavilySearchResult[] = (data.results ?? [])
    .filter((r) => r.url && r.content)
    .map((r) => ({
      title: r.title ?? "Untitled",
      url: r.url ?? "",
      content: r.content ?? "",
      score: r.score,
    }));

  return {
    query: data.query ?? query,
    answer: data.answer,
    results,
  };
}
