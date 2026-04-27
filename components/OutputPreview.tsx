"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import {
  Check,
  Clipboard,
  Download,
  ExternalLink,
  Pencil,
  PencilOff,
} from "lucide-react";
import TurndownService from "turndown";
import { copyArticleToClipboard, downloadAsMarkdown } from "@/lib/copyToMedium";
import { copyXArticleToClipboard, openXArticleCompose } from "@/lib/copyToX";

export type OutputTarget = "medium" | "x";

type Props = {
  markdown: string;
  isStreaming: boolean;
  onMarkdownChange?: (next: string) => void;
  /** Where the user is going to paste this article. Affects copy helper + button labels. */
  target?: OutputTarget;
};

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
  const editorRef = useRef<HTMLDivElement | null>(null);

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

  const handleCopy = async () => {
    if (!markdown.trim()) return;
    const result =
      target === "x"
        ? await copyXArticleToClipboard(markdown)
        : await copyArticleToClipboard(markdown);
    setCopied(result.ok);
    setCopyMessage(
      result.ok
        ? result.format === "html"
          ? target === "x"
            ? "Copied! Paste into X Articles and your formatting will be preserved."
            : "Copied! Paste into Medium and your formatting will be preserved."
          : "Copied as plain text (your browser doesn't support rich copy)."
        : "Copy failed. Please select and copy manually.",
    );
  };

  const handleExport = () => {
    if (!markdown.trim()) return;
    downloadAsMarkdown(markdown, target === "x" ? "x-article.md" : "article.md");
  };

  const toggleEdit = () => {
    if (editing && editorRef.current && onMarkdownChange) {
      const html = editorRef.current.innerHTML;
      const md = turndown.turndown(html);
      onMarkdownChange(md);
    }
    setEditing((e) => !e);
  };

  const hasContent = markdown.trim().length > 0;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-ink-muted dark:text-neutral-400">
          {isStreaming
            ? "Generating..."
            : hasContent
              ? "Preview"
              : "Output will appear here"}
        </h3>

        {hasContent && !isStreaming && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-white transition hover:bg-black dark:bg-neutral-100 dark:text-ink dark:hover:bg-white"
            >
              {copied ? <Check size={14} /> : <Clipboard size={14} />}
              {copied ? "Copied" : target === "x" ? "Copy to X" : "Copy to Medium"}
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
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              {editing ? <PencilOff size={14} /> : <Pencil size={14} />}
              {editing ? "Done editing" : "Edit"}
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <Download size={14} />
              Export .md
            </button>
          </div>
        )}
      </div>

      {copyMessage && (
        <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {copyMessage}
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
              __html: renderHtmlForEdit(markdown, target),
            }}
          />
        ) : (
          <article className="medium-prose">
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
              {markdown}
            </ReactMarkdown>
            {isStreaming && (
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
