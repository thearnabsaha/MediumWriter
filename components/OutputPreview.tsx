"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  Check,
  Clipboard,
  Download,
  ExternalLink,
  Languages,
  Loader2,
  Pencil,
  PencilOff,
  X,
} from "lucide-react";
import TurndownService from "turndown";
import { copyArticleToClipboard, downloadAsMarkdown } from "@/lib/copyToMedium";
import { copyXArticleToClipboard, openXArticleCompose } from "@/lib/copyToX";
import { useArticleStream } from "@/lib/useArticleStream";

export type OutputTarget = "medium" | "x";

type Props = {
  markdown: string;
  isStreaming: boolean;
  onMarkdownChange?: (next: string) => void;
  /** Where the user is going to paste this article. Affects copy helper + button labels. */
  target?: OutputTarget;
};

type Language = "en" | "de";

const mediumSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    "h1",
    "h2",
    "p",
    "strong",
    "em",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "br",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [["href"], ["title"]],
  },
};

const xSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    "h2",
    "h3",
    "h4",
    "p",
    "strong",
    "em",
    "del",
    "s",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "hr",
    "br",
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [["href"], ["title"]],
  },
};

export default function OutputPreview({
  markdown,
  isStreaming,
  onMarkdownChange,
  target = "medium",
}: Props) {
  const [copied, setCopied] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [language, setLanguage] = useState<Language>("en");
  const [germanMarkdown, setGermanMarkdown] = useState("");
  const editorRef = useRef<HTMLDivElement | null>(null);

  const translateStream = useArticleStream("/api/translate");

  // Whenever the upstream English article changes (regenerate, edit, switch
  // tabs), invalidate the cached German translation and snap back to English.
  useEffect(() => {
    setGermanMarkdown("");
    setLanguage("en");
    translateStream.reset();
    // We intentionally don't depend on translateStream.reset (stable ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markdown]);

  // While translation is streaming, mirror the partial output into the
  // displayed German markdown so the user watches it land in real time.
  useEffect(() => {
    if (translateStream.isStreaming) {
      setGermanMarkdown(translateStream.output);
      setLanguage("de");
    }
  }, [translateStream.isStreaming, translateStream.output]);

  // When the stream completes, the final cleaned output (post-emoji-strip) is
  // the canonical German version.
  useEffect(() => {
    if (
      !translateStream.isStreaming &&
      translateStream.output &&
      !translateStream.error
    ) {
      setGermanMarkdown(translateStream.output);
    }
  }, [
    translateStream.isStreaming,
    translateStream.output,
    translateStream.error,
  ]);

  const turndown = useMemo(() => {
    const td = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    });
    td.addRule("strikethrough", {
      filter: ["s", "del"],
      replacement: (content) =>
        target === "x" ? `~~${content}~~` : content,
    });
    return td;
  }, [target]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => {
      setCopied(false);
      setCopyMessage(null);
    }, 2200);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (editing) setEditing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const displayedMarkdown =
    language === "de" ? germanMarkdown : markdown;

  const isTranslating = translateStream.isStreaming;
  const hasGerman = germanMarkdown.trim().length > 0;
  const canEditCurrent = language === "en" && !!onMarkdownChange;

  const handleTranslate = useCallback(async () => {
    if (!markdown.trim() || isTranslating) return;
    if (hasGerman && language === "en") {
      // We already have a German version cached — just flip the toggle without
      // burning tokens.
      setLanguage("de");
      return;
    }
    await translateStream.run({
      markdown: markdown.trim(),
      target,
    });
  }, [hasGerman, isTranslating, language, markdown, target, translateStream]);

  const handleShowEnglish = () => {
    if (isTranslating) return;
    setLanguage("en");
  };

  const handleStopTranslation = () => {
    translateStream.stop();
  };

  const handleCopy = async () => {
    if (!displayedMarkdown.trim()) return;
    const result =
      target === "x"
        ? await copyXArticleToClipboard(displayedMarkdown)
        : await copyArticleToClipboard(displayedMarkdown);
    setCopied(result.ok);
    const langSuffix = language === "de" ? " (German)" : "";
    setCopyMessage(
      result.ok
        ? result.format === "html"
          ? target === "x"
            ? `Copied${langSuffix}! Paste into X Articles and your formatting will be preserved.`
            : `Copied${langSuffix}! Paste into Medium and your formatting will be preserved.`
          : `Copied${langSuffix} as plain text (your browser doesn't support rich copy).`
        : "Copy failed. Please select and copy manually.",
    );
  };

  const handleExport = () => {
    if (!displayedMarkdown.trim()) return;
    const langPart = language === "de" ? "-de" : "";
    const targetPart = target === "x" ? "x-article" : "article";
    downloadAsMarkdown(displayedMarkdown, `${targetPart}${langPart}.md`);
  };

  const toggleEdit = () => {
    if (editing && editorRef.current && canEditCurrent) {
      const html = editorRef.current.innerHTML;
      const md = turndown.turndown(html);
      onMarkdownChange?.(md);
    }
    setEditing((e) => !e);
  };

  const hasContent = displayedMarkdown.trim().length > 0;

  const headerLabel = isStreaming
    ? "Generating..."
    : isTranslating
      ? language === "de"
        ? germanMarkdown
          ? "Translating to German..."
          : `${translateStream.activeModel?.label ?? "AI"} is translating to German...`
        : "Translating to German..."
      : hasContent
        ? language === "de"
          ? "Preview · German (DE)"
          : "Preview · English"
        : "Output will appear here";

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-ink-muted dark:text-neutral-400">
          {isTranslating && (
            <Loader2
              size={14}
              className="animate-spin text-accent"
              aria-hidden
            />
          )}
          {headerLabel}
        </h3>

        {hasContent && !isStreaming && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Translate / language toggle. Always visible while we have an
                English source so the user can flip back-and-forth without
                re-translating once the German version exists. */}
            {!isTranslating && language === "en" && (
              <button
                type="button"
                onClick={handleTranslate}
                disabled={!markdown.trim()}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                title={
                  hasGerman
                    ? "Show the cached German translation"
                    : "Translate this article to German with AI"
                }
              >
                <Languages size={14} />
                {hasGerman ? "Show German" : "Translate to German"}
              </button>
            )}
            {!isTranslating && language === "de" && (
              <button
                type="button"
                onClick={handleShowEnglish}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                title="Switch back to the English version"
              >
                <Languages size={14} />
                Show English
              </button>
            )}
            {!isTranslating && language === "de" && (
              <button
                type="button"
                onClick={() => translateStream.run({
                  markdown: markdown.trim(),
                  target,
                })}
                disabled={!markdown.trim()}
                className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200 dark:hover:bg-amber-900"
                title="Re-translate from the original English"
              >
                <Languages size={14} />
                Re-translate
              </button>
            )}
            {isTranslating && (
              <button
                type="button"
                onClick={handleStopTranslation}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
                title="Stop the translation"
              >
                <X size={14} />
                Stop translating
              </button>
            )}

            <button
              type="button"
              onClick={handleCopy}
              disabled={isTranslating}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black disabled:opacity-50 dark:bg-neutral-100 dark:text-ink dark:hover:bg-white"
            >
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied
                ? "Copied"
                : target === "x"
                  ? language === "de"
                    ? "Copy German to X"
                    : "Copy to X"
                  : language === "de"
                    ? "Copy German to Medium"
                    : "Copy to Medium"}
            </button>
            {target === "x" && (
              <button
                type="button"
                onClick={openXArticleCompose}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                title="Open X Articles compose in a new tab"
              >
                <ExternalLink size={14} />
                Open X compose
              </button>
            )}
            <button
              type="button"
              onClick={toggleEdit}
              disabled={isTranslating || !canEditCurrent}
              title={
                !canEditCurrent && language === "de"
                  ? "Switch back to English to edit"
                  : undefined
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              {editing ? <PencilOff size={14} /> : <Pencil size={14} />}
              {editing ? "Done editing" : "Edit"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={isTranslating}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Download size={14} />
              {language === "de" ? "Export .md (DE)" : "Export .md"}
            </button>
          </div>
        )}
      </div>

      {copyMessage && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {copyMessage}
        </div>
      )}

      {translateStream.error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          Translation failed: {translateStream.error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-6 shadow-inner dark:border-neutral-800 dark:bg-neutral-900 sm:p-8">
        {!hasContent ? (
          <div className="flex h-full min-h-[300px] items-center justify-center">
            <p className="max-w-xs text-center text-sm text-ink-muted dark:text-neutral-500">
              {target === "x"
                ? "Enter a topic or paste an article, then generate to create an X-ready Article."
                : "Enter a topic and click Generate to create a Medium-ready article."}
            </p>
          </div>
        ) : editing ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="medium-prose focus:outline-none"
            dangerouslySetInnerHTML={{
              __html: renderHtmlForEdit(displayedMarkdown, target),
            }}
          />
        ) : (
          <article
            className="medium-prose"
            lang={language === "de" ? "de" : "en"}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[
                [
                  rehypeSanitize,
                  target === "x" ? xSanitizeSchema : mediumSanitizeSchema,
                ],
              ]}
              components={
                target === "x"
                  ? {
                      h1: ({ children }) => <h2>{children}</h2>,
                      h5: ({ children }) => <h4>{children}</h4>,
                      h6: ({ children }) => <h4>{children}</h4>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {children}
                        </a>
                      ),
                    }
                  : {
                      h3: ({ children }) => <h2>{children}</h2>,
                      h4: ({ children }) => <h2>{children}</h2>,
                      h5: ({ children }) => <h2>{children}</h2>,
                      h6: ({ children }) => <h2>{children}</h2>,
                      a: ({ href, children }) => (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                        >
                          {children}
                        </a>
                      ),
                    }
              }
            >
              {displayedMarkdown}
            </ReactMarkdown>
            {(isStreaming || isTranslating) && (
              <span
                aria-hidden
                className="ml-0.5 inline-block h-5 w-0.5 animate-pulse bg-ink align-middle dark:bg-neutral-100"
              />
            )}
          </article>
        )}
      </div>
    </div>
  );
}

/**
 * Lightweight markdown -> HTML for the contentEditable surface. Uses the
 * appropriate target-specific converter so the editing surface always shows
 * the same constrained markup that will end up on the clipboard.
 */
function renderHtmlForEdit(markdown: string, target: OutputTarget): string {
  if (target === "x") {
    const { markdownToXHtml } =
      require("@/lib/markdownToXHtml") as typeof import("@/lib/markdownToXHtml");
    return markdownToXHtml(markdown);
  }
  const { markdownToMediumHtml } =
    require("@/lib/markdownToMediumHtml") as typeof import("@/lib/markdownToMediumHtml");
  return markdownToMediumHtml(markdown);
}
