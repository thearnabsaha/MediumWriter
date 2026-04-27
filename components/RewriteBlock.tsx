"use client";

import { useMemo, useState } from "react";
import { FileText, RefreshCw, Sparkles, Wand2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useArticleStream } from "@/lib/useArticleStream";
import { estimateWordCount } from "@/lib/ai";
import OutputPreview from "./OutputPreview";
import Spinner from "./Spinner";
import GenerationStatus from "./GenerationStatus";

const MAX_ARTICLE_LENGTH = 20000;

type TemplateSource = "saved" | "paste" | "none";

export default function RewriteBlock() {
  const styleBlocks = useStore((s) => s.styleBlocks);
  const setLastOutput = useStore((s) => s.setLastOutput);

  const [oldArticle, setOldArticle] = useState("");
  const [templateSource, setTemplateSource] = useState<TemplateSource>(
    styleBlocks.length > 0 ? "saved" : "none",
  );
  const [selectedSavedId, setSelectedSavedId] = useState<string>(
    styleBlocks[0]?.id ?? "",
  );
  const [pastedTemplate, setPastedTemplate] = useState("");
  const [autoResearch, setAutoResearch] = useState(true);

  const stream = useArticleStream();

  const resolvedTemplate = useMemo(() => {
    if (templateSource === "saved") {
      return (
        styleBlocks.find((b) => b.id === selectedSavedId)?.content.trim() ?? ""
      );
    }
    if (templateSource === "paste") {
      return pastedTemplate.trim();
    }
    return "";
  }, [templateSource, selectedSavedId, pastedTemplate, styleBlocks]);

  const sourceWordCount = useMemo(
    () => estimateWordCount(oldArticle),
    [oldArticle],
  );
  const outputWordCount = useMemo(
    () => estimateWordCount(stream.output),
    [stream.output],
  );

  const canRewrite =
    oldArticle.trim().length > 0 &&
    (templateSource === "none" || resolvedTemplate.length > 0) &&
    !stream.isStreaming;

  const handleRewrite = async () => {
    if (!canRewrite) return;
    // Reinforce the voice with any other saved samples (excluding the chosen one
    // when its source is "saved" so we don't duplicate it in the prompt).
    const reinforcing =
      templateSource === "saved"
        ? styleBlocks
            .filter((b) => b.id !== selectedSavedId)
            .map((b) => b.content)
        : styleBlocks.map((b) => b.content);

    await stream.run(
      {
        mode: "rewrite",
        oldArticle: oldArticle.trim(),
        ...(templateSource !== "none" && resolvedTemplate
          ? { templateArticle: resolvedTemplate }
          : {}),
        styleBlocks: reinforcing,
        autoResearch,
      },
      {
        onComplete: (md) => {
          setLastOutput(md);
        },
      },
    );
  };

  const handleMarkdownChange = (next: string) => {
    stream.setOutput(next);
    setLastOutput(next);
  };

  const savedAvailable = styleBlocks.length > 0;

  const targetMin = sourceWordCount
    ? Math.max(150, Math.round(sourceWordCount * 0.85))
    : 0;
  const targetMax = sourceWordCount ? Math.round(sourceWordCount * 1.15) : 0;

  return (
    <section className="flex h-full flex-col gap-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-4">
          <label
            htmlFor="old-article"
            className="mb-1.5 block text-sm font-semibold text-ink dark:text-neutral-100"
          >
            Your old article
          </label>
          <p className="mb-2 text-xs text-ink-muted dark:text-neutral-400">
            Paste an article you already wrote. The AI will keep all your ideas,
            facts, and links — and add Medium polish (bold, italic, blockquotes,
            inline links, photo suggestions). Zero emojis.
          </p>
          <textarea
            id="old-article"
            value={oldArticle}
            onChange={(e) =>
              setOldArticle(e.target.value.slice(0, MAX_ARTICLE_LENGTH))
            }
            rows={8}
            placeholder="Paste your existing article here..."
            className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-ink-muted dark:text-neutral-500">
            <span>
              {sourceWordCount > 0 ? (
                <>
                  <strong className="text-ink dark:text-neutral-300">
                    {sourceWordCount.toLocaleString()}
                  </strong>{" "}
                  words · target rewrite ~{targetMin.toLocaleString()}–
                  {targetMax.toLocaleString()}
                </>
              ) : (
                "Word count appears here"
              )}
            </span>
            <span>
              {oldArticle.length.toLocaleString()} /{" "}
              {MAX_ARTICLE_LENGTH.toLocaleString()} chars
            </span>
          </div>
        </div>

        <div className="mb-2">
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink dark:text-neutral-100">
              Writing template{" "}
              <span className="font-normal text-ink-muted dark:text-neutral-500">
                (optional)
              </span>
            </span>
            <div className="inline-flex rounded-full border border-neutral-200 bg-neutral-50 p-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950">
              <button
                type="button"
                onClick={() => setTemplateSource("none")}
                className={`rounded-full px-3 py-1 transition ${
                  templateSource === "none"
                    ? "bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-ink-muted hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                No template
              </button>
              <button
                type="button"
                onClick={() => setTemplateSource("saved")}
                disabled={!savedAvailable}
                className={`rounded-full px-3 py-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  templateSource === "saved"
                    ? "bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-ink-muted hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                Saved sample
              </button>
              <button
                type="button"
                onClick={() => setTemplateSource("paste")}
                className={`rounded-full px-3 py-1 transition ${
                  templateSource === "paste"
                    ? "bg-white text-ink shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
                    : "text-ink-muted hover:text-ink dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                Paste new
              </button>
            </div>
          </div>
          <p className="mb-2 text-xs text-ink-muted dark:text-neutral-400">
            {templateSource === "none"
              ? "No template — the AI keeps your own voice and just polishes the article for Medium."
              : "Pick the article whose voice, rhythm, and structure you want to mimic."}
          </p>

          {templateSource === "none" ? (
            <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-3 text-xs text-ink-muted dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400">
              <strong className="text-ink dark:text-neutral-200">
                Polish in place.
              </strong>{" "}
              Your tone, vocabulary, and ideas stay intact. The AI tightens
              sentences, structures sections, and adds Medium formatting.
            </div>
          ) : templateSource === "saved" ? (
            savedAvailable ? (
              <div className="space-y-2">
                <select
                  value={selectedSavedId}
                  onChange={(e) => setSelectedSavedId(e.target.value)}
                  className="w-full rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                >
                  {styleBlocks.map((b, i) => (
                    <option key={b.id} value={b.id}>
                      Sample {i + 1} — {b.content.slice(0, 60).replace(/\s+/g, " ")}
                      ...
                    </option>
                  ))}
                </select>
                {resolvedTemplate && (
                  <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-ink-muted dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400">
                    <div className="mb-1 inline-flex items-center gap-1 font-medium text-ink dark:text-neutral-200">
                      <FileText size={12} />
                      Preview
                    </div>
                    <p className="line-clamp-4 whitespace-pre-wrap">
                      {resolvedTemplate.slice(0, 400)}
                      {resolvedTemplate.length > 400 ? "..." : ""}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-4 text-center text-xs text-ink-muted dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400">
                No saved samples yet. Add some in the Style Block on the right,
                or switch to <strong>Paste new</strong>.
              </div>
            )
          ) : (
            <div>
              <textarea
                value={pastedTemplate}
                onChange={(e) =>
                  setPastedTemplate(e.target.value.slice(0, MAX_ARTICLE_LENGTH))
                }
                rows={6}
                placeholder="Paste a reference article whose writing style you want to copy..."
                className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
              />
              <div className="mt-1 text-right text-xs text-ink-muted dark:text-neutral-500">
                {pastedTemplate.length.toLocaleString()} /{" "}
                {MAX_ARTICLE_LENGTH.toLocaleString()}
              </div>
            </div>
          )}
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-ink-muted transition hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-400 dark:hover:bg-neutral-900">
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
            {oldArticle.trim().length > 0 &&
            (templateSource === "none" || resolvedTemplate)
              ? "Ready to rewrite"
              : !oldArticle.trim()
                ? "Paste an article to rewrite"
                : "Choose a writing template (or pick No template)"}
          </div>

          <div className="flex items-center gap-2">
            {stream.output && !stream.isStreaming && (
              <button
                type="button"
                onClick={handleRewrite}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                <RefreshCw size={14} />
                Rewrite again
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
                onClick={handleRewrite}
                disabled={!canRewrite}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Wand2 size={14} />
                Rewrite Article
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
              ? `${stream.activeModel.label} is rewriting your article...`
              : "Rewriting your article..."}
          </div>
        )}
        {(stream.output || (!stream.isStreaming && !stream.error)) && (
          <>
            {stream.output && (
              <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-ink-muted dark:text-neutral-400">
                <span>
                  Source:{" "}
                  <strong className="text-ink dark:text-neutral-300">
                    {sourceWordCount.toLocaleString()}
                  </strong>{" "}
                  words
                </span>
                <span aria-hidden>·</span>
                <span>
                  Rewrite:{" "}
                  <strong className="text-ink dark:text-neutral-300">
                    {outputWordCount.toLocaleString()}
                  </strong>{" "}
                  words
                </span>
                {sourceWordCount > 0 && outputWordCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      outputWordCount >= targetMin && outputWordCount <= targetMax
                        ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
                        : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                    }`}
                  >
                    {outputWordCount >= targetMin && outputWordCount <= targetMax
                      ? "matches source length"
                      : outputWordCount < targetMin
                        ? `${(targetMin - outputWordCount).toLocaleString()} words short`
                        : `${(outputWordCount - targetMax).toLocaleString()} words over`}
                  </span>
                )}
              </div>
            )}
            <OutputPreview
              markdown={stream.output}
              isStreaming={stream.isStreaming}
              onMarkdownChange={handleMarkdownChange}
            />
          </>
        )}
      </div>
    </section>
  );
}
