"use client";

import { useEffect, useRef, useState } from "react";
import { Cpu, RefreshCw, Search, Send, X } from "lucide-react";
import { useStore } from "@/lib/store";
import OutputPreview from "./OutputPreview";
import Spinner from "./Spinner";

const MAX_PROMPT_LENGTH = 2000;

type ModelInfo = { id: string; label: string; index: number };

type ResearchSnippet = {
  title: string;
  url: string;
  content: string;
};

export default function WriteBlock() {
  const styleBlocks = useStore((s) => s.styleBlocks);
  const lastOutput = useStore((s) => s.lastOutput);
  const lastPrompt = useStore((s) => s.lastPrompt);
  const setLastOutput = useStore((s) => s.setLastOutput);
  const setLastPrompt = useStore((s) => s.setLastPrompt);

  const [prompt, setPrompt] = useState("");
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const [useResearch, setUseResearch] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchSourcesCount, setResearchSourcesCount] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (lastPrompt) setPrompt(lastPrompt);
    if (lastOutput) setOutput(lastOutput);
  }, [lastPrompt, lastOutput]);

  const fetchResearch = async (
    topic: string,
    signal: AbortSignal,
  ): Promise<ResearchSnippet[]> => {
    setIsResearching(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: topic, maxResults: 5 }),
        signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Research failed (${res.status})`);
      }
      const data = (await res.json()) as { results?: ResearchSnippet[] };
      return (data.results ?? []).slice(0, 5);
    } finally {
      setIsResearching(false);
    }
  };

  const runGeneration = async (topic: string) => {
    if (!topic.trim() || isStreaming) return;
    setError(null);
    setOutput("");
    setActiveModel(null);
    setFallbackNote(null);
    setResearchSourcesCount(0);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let research: ResearchSnippet[] | undefined;
      if (useResearch) {
        try {
          research = await fetchResearch(topic.trim(), controller.signal);
          setResearchSourcesCount(research.length);
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          setError(
            `Research failed: ${(err as Error).message}. Continuing without research.`,
          );
          research = undefined;
        }
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: topic.trim(),
          styleBlocks: styleBlocks.map((b) => b.content),
          research,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          throw new Error(
            data?.error ??
              "All AI models are rate-limited right now. Please try again in a minute.",
          );
        }
        throw new Error(data?.error ?? `Request failed (${res.status})`);
      }

      if (!res.body) {
        throw new Error("Streaming not supported in this browser.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let nlIndex: number;
        while ((nlIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, nlIndex).trim();
          buffer = buffer.slice(nlIndex + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line) as
              | { type: "model"; id: string; label: string; index: number }
              | { type: "token"; value: string }
              | {
                  type: "fallback";
                  from: string;
                  to: string;
                  reason: string;
                }
              | { type: "done" }
              | { type: "error"; message: string };

            if (event.type === "model") {
              setActiveModel({
                id: event.id,
                label: event.label,
                index: event.index,
              });
            } else if (event.type === "token") {
              acc += event.value;
              setOutput(acc);
            } else if (event.type === "fallback") {
              setFallbackNote(
                `Switched from ${event.from} to ${event.to} (${event.reason})`,
              );
            } else if (event.type === "error") {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            // If a line wasn't valid JSON, surface its content as a fallback.
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      // Flush any trailing buffered content as a token (best-effort).
      if (buffer.trim()) {
        try {
          const tail = JSON.parse(buffer.trim());
          if (tail?.type === "token" && typeof tail.value === "string") {
            acc += tail.value;
            setOutput(acc);
          }
        } catch {
          // ignore
        }
      }

      setLastOutput(acc);
      setLastPrompt(topic.trim());
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("Generation cancelled.");
      } else {
        setError((err as Error).message ?? "Something went wrong.");
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleGenerate = () => runGeneration(prompt);

  const handleRegenerate = () => {
    const topic = prompt.trim() || lastPrompt;
    if (topic) runGeneration(topic);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleMarkdownChange = (next: string) => {
    setOutput(next);
    setLastOutput(next);
  };

  return (
    <section className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <label
          htmlFor="topic"
          className="mb-2 block text-sm font-semibold text-ink dark:text-neutral-100"
        >
          What do you want to write about?
        </label>
        <textarea
          id="topic"
          value={prompt}
          onChange={(e) =>
            setPrompt(e.target.value.slice(0, MAX_PROMPT_LENGTH))
          }
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleGenerate();
            }
          }}
          rows={3}
          placeholder="e.g. Why most side projects fail in the first month — and how to avoid it"
          className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-base text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800">
            <input
              type="checkbox"
              checked={useResearch}
              onChange={(e) => setUseResearch(e.target.checked)}
              className="h-3.5 w-3.5 cursor-pointer accent-accent"
            />
            <Search size={12} />
            Research with Tavily
          </label>

          {activeModel && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent dark:border-accent/40 dark:bg-accent/15"
              title={`Model: ${activeModel.id}`}
            >
              <Cpu size={12} />
              {activeModel.label}
              {isStreaming && (
                <span className="ml-1 h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
              )}
            </span>
          )}

          {isResearching && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Spinner size={10} />
              Researching...
            </span>
          )}

          {researchSourcesCount > 0 && !isResearching && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <Search size={12} />
              {researchSourcesCount} source{researchSourcesCount === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col text-xs text-ink-muted dark:text-neutral-400">
            <span>
              {prompt.length} / {MAX_PROMPT_LENGTH}
              {styleBlocks.length > 0 && (
                <>
                  {" · "}
                  Using {styleBlocks.length} style sample
                  {styleBlocks.length === 1 ? "" : "s"}
                </>
              )}
            </span>
            <span className="mt-0.5 hidden sm:inline">
              Tip: press{" "}
              <kbd className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">
                Ctrl
              </kbd>
              +
              <kbd className="rounded bg-neutral-200 px-1 dark:bg-neutral-700">
                Enter
              </kbd>{" "}
              to generate
            </span>
          </div>

          <div className="flex items-center gap-2">
            {output && !isStreaming && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
            )}
            {isStreaming ? (
              <button
                type="button"
                onClick={handleStop}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
              >
                <X size={14} />
                Stop
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={14} />
                Generate Article
              </button>
            )}
          </div>
        </div>

        {fallbackNote && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {fallbackNote}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          >
            {error}
          </div>
        )}
      </div>

      <div className="flex min-h-[400px] flex-1 flex-col rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-6">
        {(isStreaming || isResearching) && !output && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted dark:text-neutral-400">
            <Spinner />
            {isResearching
              ? "Searching the web for fresh context..."
              : activeModel
                ? `${activeModel.label} is crafting your article...`
                : "Crafting your article..."}
          </div>
        )}
        {(output || (!isStreaming && !error)) && (
          <OutputPreview
            markdown={output}
            isStreaming={isStreaming}
            onMarkdownChange={handleMarkdownChange}
          />
        )}
      </div>
    </section>
  );
}
