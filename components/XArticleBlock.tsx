"use client";

import { useMemo, useState } from "react";
import { FileText, PenLine, RefreshCw, Send, Sparkles, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useArticleStream } from "@/lib/useArticleStream";
import OutputPreview from "./OutputPreview";
import Spinner from "./Spinner";
import GenerationStatus from "./GenerationStatus";

const MAX_PROMPT_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 20000;
/** X Articles are capped at 25,000 characters. */
const X_ARTICLE_CHAR_LIMIT = 25000;

type SubMode = "topic" | "rewrite";

export default function XArticleBlock() {
  const styleBlocks = useStore((s) => s.styleBlocks);

  const [subMode, setSubMode] = useState<SubMode>("topic");
  const [prompt, setPrompt] = useState("");
  const [sourceArticle, setSourceArticle] = useState("");
  const [autoResearch, setAutoResearch] = useState(true);

  const stream = useArticleStream();

  const outputCharCount = useMemo(
    () => stream.output.length,
    [stream.output],
  );

  const canGenerate =
    !stream.isStreaming &&
    (subMode === "topic"
      ? prompt.trim().length > 0
      : sourceArticle.trim().length > 0);

  const handleGenerate = async () => {
    if (!canGenerate) return;
    await stream.run({
      mode: "x",
      subMode,
      ...(subMode === "topic"
        ? { prompt: prompt.trim() }
        : { sourceArticle: sourceArticle.trim() }),
      styleBlocks: styleBlocks.map((b) => b.content),
      autoResearch,
    });
  };

  const handleMarkdownChange = (next: string) => {
    stream.setOutput(next);
  };

  const isOverLimit = outputCharCount > X_ARTICLE_CHAR_LIMIT;

  return (
    <section className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink dark:text-neutral-100">
              Source
            </span>
            <div
              role="tablist"
              aria-label="X article source"
              className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 p-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
            >
              <button
                type="button"
                role="tab"
                aria-selected={subMode === "topic"}
                onClick={() => setSubMode("topic")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${
                  subMode === "topic"
                    ? "bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-ink-muted hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <PenLine size={12} />
                From topic
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={subMode === "rewrite"}
                onClick={() => setSubMode("rewrite")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition ${
                  subMode === "rewrite"
                    ? "bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-ink-muted hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                <FileText size={12} />
                From article
              </button>
            </div>
          </div>

          {subMode === "topic" ? (
            <>
              <p className="mb-2 text-xs text-ink-muted dark:text-neutral-400">
                Give a topic and the AI will write a viral X Article — sharp
                hook, punchy paragraphs, Medium-style polish but tuned for X.
                Zero emojis.
              </p>
              <textarea
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
                placeholder="e.g. The hidden cost of building in public — and why it still beats the alternative"
                className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-base text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              <div className="mt-1 text-right text-xs text-ink-muted dark:text-neutral-500">
                {prompt.length} / {MAX_PROMPT_LENGTH}
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-ink-muted dark:text-neutral-400">
                Paste any long-form article (yours, a Medium piece, anything).
                The AI keeps every idea, fact, and link — and reshapes it into a
                viral X Article. Zero emojis.
              </p>
              <textarea
                value={sourceArticle}
                onChange={(e) =>
                  setSourceArticle(e.target.value.slice(0, MAX_SOURCE_LENGTH))
                }
                rows={8}
                placeholder="Paste your full source article here..."
                className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              <div className="mt-1 text-right text-xs text-ink-muted dark:text-neutral-500">
                {sourceArticle.length.toLocaleString()} /{" "}
                {MAX_SOURCE_LENGTH.toLocaleString()}
              </div>
            </>
          )}
        </div>

        <label className="mt-1 flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-ink-muted transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900">
          <input
            type="checkbox"
            checked={autoResearch}
            onChange={(e) => setAutoResearch(e.target.checked)}
            className="h-4 w-4 rounded border-neutral-300 text-accent focus:ring-accent dark:border-neutral-600"
          />
          <Sparkles size={14} className="text-accent" />
          <span>
            <strong className="text-ink dark:text-neutral-200">
              Auto-enrich with Tavily
            </strong>{" "}
            — find real, recent web links and weave them in as inline anchors
          </span>
        </label>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-ink-muted dark:text-neutral-400">
            {subMode === "topic"
              ? prompt.trim().length > 0
                ? "Ready to write your X Article"
                : "Enter a topic"
              : sourceArticle.trim().length > 0
                ? "Ready to convert to X"
                : "Paste a source article"}
            {styleBlocks.length > 0 && (
              <>
                {" · "}Using {styleBlocks.length} style sample
                {styleBlocks.length === 1 ? "" : "s"}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {stream.output && !stream.isStreaming && (
              <button
                type="button"
                onClick={handleGenerate}
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
                disabled={!canGenerate}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-neutral-100 dark:text-ink dark:hover:bg-white"
              >
                <Send size={14} />
                Write X Article
              </button>
            )}
          </div>
        </div>

        <GenerationStatus
          activeModel={stream.activeModel}
          isStreaming={stream.isStreaming}
          fallbackNote={stream.fallbackNote}
          error={stream.error}
        />
      </div>

      <div className="flex min-h-[400px] flex-1 flex-col rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 sm:p-6">
        {stream.isStreaming && !stream.output && (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted dark:text-neutral-400">
            <Spinner />
            {stream.activeModel
              ? `${stream.activeModel.label} is writing your X Article...`
              : "Writing your X Article..."}
          </div>
        )}
        {(stream.output || (!stream.isStreaming && !stream.error)) && (
          <>
            {stream.output && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted dark:text-neutral-400">
                <span>
                  X Article body:{" "}
                  <strong
                    className={
                      isOverLimit
                        ? "text-red-700 dark:text-red-300"
                        : "text-ink dark:text-neutral-300"
                    }
                  >
                    {outputCharCount.toLocaleString()}
                  </strong>{" "}
                  / {X_ARTICLE_CHAR_LIMIT.toLocaleString()} chars
                </span>
                <span aria-hidden>·</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    isOverLimit
                      ? "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
                      : outputCharCount > 0 && outputCharCount < 800
                        ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                        : "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                  }`}
                >
                  {isOverLimit
                    ? `${(outputCharCount - X_ARTICLE_CHAR_LIMIT).toLocaleString()} over limit`
                    : outputCharCount > 0 && outputCharCount < 800
                      ? "short — consider regenerating"
                      : "within X limit"}
                </span>
                <span aria-hidden>·</span>
                <span>No # title in body — paste the title separately into X.</span>
              </div>
            )}
            <OutputPreview
              markdown={stream.output}
              isStreaming={stream.isStreaming}
              onMarkdownChange={handleMarkdownChange}
              target="x"
            />
          </>
        )}
      </div>
    </section>
  );
}
