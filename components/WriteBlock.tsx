"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw, Search, Send, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useArticleStream } from "@/lib/useArticleStream";
import OutputPreview from "./OutputPreview";
import Spinner from "./Spinner";
import GenerationStatus from "./GenerationStatus";

const MAX_PROMPT_LENGTH = 2000;

type ResearchSnippet = { title: string; url: string; content: string };

export default function WriteBlock() {
  const styleBlocks = useStore((s) => s.styleBlocks);
  const lastOutput = useStore((s) => s.lastOutput);
  const lastPrompt = useStore((s) => s.lastPrompt);
  const setLastOutput = useStore((s) => s.setLastOutput);
  const setLastPrompt = useStore((s) => s.setLastPrompt);

  const [prompt, setPrompt] = useState("");
  const [useResearch, setUseResearch] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [researchSourcesCount, setResearchSourcesCount] = useState(0);

  const stream = useArticleStream();
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (lastPrompt) setPrompt(lastPrompt);
    if (lastOutput) stream.setOutput(lastOutput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPrompt, lastOutput]);

  const fetchResearch = async (
    topic: string,
  ): Promise<ResearchSnippet[]> => {
    setIsResearching(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: topic, maxResults: 5 }),
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
    if (!topic.trim() || stream.isStreaming) return;
    setResearchSourcesCount(0);

    let research: ResearchSnippet[] | undefined;
    if (useResearch) {
      try {
        research = await fetchResearch(topic.trim());
        setResearchSourcesCount(research.length);
      } catch (err) {
        stream.setError(
          `Research failed: ${(err as Error).message}. Continuing without research.`,
        );
        research = undefined;
      }
    }

    await stream.run(
      {
        mode: "generate",
        prompt: topic.trim(),
        styleBlocks: styleBlocks.map((b) => b.content),
        research,
      },
      {
        onComplete: (md) => {
          setLastOutput(md);
          setLastPrompt(topic.trim());
        },
      },
    );
  };

  const handleGenerate = () => runGeneration(prompt);

  const handleRegenerate = () => {
    const topic = prompt.trim() || lastPrompt;
    if (topic) runGeneration(topic);
  };

  const handleMarkdownChange = (next: string) => {
    stream.setOutput(next);
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
            {stream.output && !stream.isStreaming && (
              <button
                type="button"
                onClick={handleRegenerate}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={14} />
                Regenerate
              </button>
            )}
            {stream.isStreaming ? (
              <button
                type="button"
                onClick={stream.stop}
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

        <GenerationStatus
          activeModel={stream.activeModel}
          isStreaming={stream.isStreaming}
          fallbackNote={stream.fallbackNote}
          error={stream.error}
          isResearching={isResearching}
          researchSourcesCount={researchSourcesCount}
        />
      </div>

      <div className="flex min-h-[400px] flex-1 flex-col rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-6">
        {(stream.isStreaming || isResearching) && !stream.output && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted dark:text-neutral-400">
            <Spinner />
            {isResearching
              ? "Searching the web for fresh context..."
              : stream.activeModel
                ? `${stream.activeModel.label} is crafting your article...`
                : "Crafting your article..."}
          </div>
        )}
        {(stream.output || (!stream.isStreaming && !stream.error)) && (
          <OutputPreview
            markdown={stream.output}
            isStreaming={stream.isStreaming}
            onMarkdownChange={handleMarkdownChange}
          />
        )}
      </div>
    </section>
  );
}
