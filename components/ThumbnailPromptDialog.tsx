"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  Image as ImageIcon,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { useArticleStream } from "@/lib/useArticleStream";
import {
  THUMBNAIL_STYLE_LABELS,
  type ThumbnailStyle,
} from "@/lib/ai";

export type ThumbnailTarget = "medium" | "x";

type Props = {
  open: boolean;
  onClose: () => void;
  markdown: string;
  target: ThumbnailTarget;
};

const STYLE_OPTIONS: Array<{ id: ThumbnailStyle; label: string; hint: string }> = [
  {
    id: "auto",
    label: THUMBNAIL_STYLE_LABELS.auto,
    hint: "Read the article and pick the best-fitting style family",
  },
  {
    id: "scrapbook-collage",
    label: THUMBNAIL_STYLE_LABELS["scrapbook-collage"],
    hint: "Torn paper texture, hand-drawn ink-and-watercolor character, sticker icons, mock screenshots — Karpathy / sketchbook editorial",
  },
  {
    id: "editorial-flatlay",
    label: THUMBNAIL_STYLE_LABELS["editorial-flatlay"],
    hint: "Cream-on-charcoal, row of solid navy circular icon-stamps, premium publication feel — Stripe Press / Linear",
  },
  {
    id: "dark-diagram",
    label: THUMBNAIL_STYLE_LABELS["dark-diagram"],
    hint: "Pitch-black background, glassy panels connected by hand-drawn arrows, single accent color — Excalidraw whiteboard",
  },
  {
    id: "cinematic-character",
    label: THUMBNAIL_STYLE_LABELS["cinematic-character"],
    hint: "Pitch-black void, single 3D / photoreal character offset right, massive empty space left — viral X / TikTok header",
  },
  {
    id: "halftone-classical",
    label: THUMBNAIL_STYLE_LABELS["halftone-classical"],
    hint: "Flat saturated background, classical bust / engraving in halftone, one bold accent shape — Higgsfield / magazine zine",
  },
];

const SPECS: Record<ThumbnailTarget, {
  label: string;
  ratio: string;
  size: string;
  cropNote: string;
}> = {
  medium: {
    label: "Medium cover image",
    ratio: "16:9",
    size: "1400 × 788 px",
    cropNote:
      "Medium crops covers into thumbnails for the homepage feed, social shares, and mobile — the prompt asks for the focal subject in the central third with generous safe-area padding so all crops survive.",
  },
  x: {
    label: "X Article header",
    ratio: "5:2",
    size: "3840 × 1536 px (4K)",
    cropNote:
      "The 5:2 ultra-wide format gets cropped tighter than 16:9 in feed cards — the prompt demands extra horizontal safe-area padding so card previews stay readable.",
  },
};

/**
 * Open ChatGPT in a new tab, with the generated prompt pre-filled in the URL
 * if the browser allows. ChatGPT supports `?q=...` as the seed prompt.
 */
function openInChatGPT(prompt: string) {
  if (typeof window === "undefined") return;
  const url = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}&hints=search`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function ThumbnailPromptDialog({
  open,
  onClose,
  markdown,
  target,
}: Props) {
  const stream = useArticleStream("/api/thumbnail");
  const [copied, setCopied] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [style, setStyle] = useState<ThumbnailStyle>("auto");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const lastSourceRef = useRef<{
    markdown: string;
    target: ThumbnailTarget;
    style: ThumbnailStyle;
  } | null>(null);

  const spec = SPECS[target];

  const runForStyle = useCallback(
    (nextStyle: ThumbnailStyle) => {
      if (!markdown.trim()) return;
      lastSourceRef.current = { markdown, target, style: nextStyle };
      setHasGenerated(false);
      stream.reset();
      stream
        .run({ markdown: markdown.trim(), target, style: nextStyle })
        .then(() => setHasGenerated(true));
    },
    // stream.run / stream.reset are stable identities from useArticleStream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markdown, target],
  );

  // Auto-generate when the dialog opens for a fresh (markdown, target, style)
  // tuple. Re-opening for the same tuple shows the cached prompt without
  // burning tokens; user hits Regenerate or changes the style for a new pass.
  useEffect(() => {
    if (!open) return;
    const last = lastSourceRef.current;
    const isFresh =
      !last ||
      last.markdown !== markdown ||
      last.target !== target ||
      last.style !== style;
    if (isFresh && markdown.trim()) {
      runForStyle(style);
    } else if (!isFresh) {
      setHasGenerated(true);
    }
    // We intentionally only react to opens or to (markdown/target/style) flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, markdown, target, style]);

  // Focus the close button when the dialog opens — keeps keyboard focus
  // trapped enough for an Escape-to-close UX without a full focus-trap library.
  useEffect(() => {
    if (open) closeBtnRef.current?.focus();
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !stream.isStreaming) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, stream.isStreaming]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(t);
  }, [copied]);

  if (!open) return null;

  const promptText = stream.output.trim();
  const canCopy = !!promptText && !stream.isStreaming;

  const handleCopy = async () => {
    if (!canCopy) return;
    try {
      await navigator.clipboard?.writeText(promptText);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const handleRegenerate = () => {
    if (stream.isStreaming || !markdown.trim()) return;
    runForStyle(style);
  };

  const handleStyleChange = (nextStyle: ThumbnailStyle) => {
    if (stream.isStreaming || nextStyle === style) {
      setStyle(nextStyle);
      return;
    }
    setStyle(nextStyle);
    // The effect on (style) will trigger a regenerate automatically when the
    // dialog is open and the tuple changes.
  };

  const handleClose = () => {
    if (stream.isStreaming) stream.stop();
    onClose();
  };

  const activeStyleHint =
    STYLE_OPTIONS.find((o) => o.id === style)?.hint ?? "";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="thumbnail-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !stream.isStreaming) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-start justify-between gap-3 border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
          <div>
            <h2
              id="thumbnail-dialog-title"
              className="flex items-center gap-2 text-base font-semibold text-ink dark:text-neutral-100"
            >
              <ImageIcon size={18} className="text-accent" />
              Thumbnail prompt — {spec.label}
            </h2>
            <p className="mt-1 text-xs text-ink-muted dark:text-neutral-400">
              <strong className="text-ink dark:text-neutral-300">
                {spec.ratio}
              </strong>{" "}
              · {spec.size}
            </p>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={handleClose}
            className="rounded-full p-1 text-ink-muted transition hover:bg-neutral-100 hover:text-ink dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-5 py-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <strong>Safe-area note:</strong> {spec.cropNote}
          </div>

          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-950">
            <label
              htmlFor="thumb-style-select"
              className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted dark:text-neutral-400"
            >
              <Palette size={12} className="text-violet-500" />
              Visual style
            </label>
            <select
              id="thumb-style-select"
              value={style}
              onChange={(e) => handleStyleChange(e.target.value as ThumbnailStyle)}
              disabled={stream.isStreaming}
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            >
              {STYLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-muted dark:text-neutral-500">
              {activeStyleHint}
            </p>
          </div>

          {stream.activeModel && stream.isStreaming && (
            <div className="flex items-center gap-2 text-xs text-ink-muted dark:text-neutral-400">
              <Loader2
                size={14}
                className="animate-spin text-accent"
                aria-hidden
              />
              {stream.activeModel.label} is composing your prompt...
            </div>
          )}
          {stream.fallbackNote && (
            <div className="text-xs text-amber-700 dark:text-amber-300">
              {stream.fallbackNote}
            </div>
          )}
          {stream.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              {stream.error}
            </div>
          )}

          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm leading-relaxed text-ink shadow-inner dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100">
            {promptText ? (
              <p className="whitespace-pre-wrap">{promptText}</p>
            ) : stream.isStreaming ? (
              <p className="text-ink-muted dark:text-neutral-500">
                Reading the article and composing a prompt for {spec.label.toLowerCase()}...
              </p>
            ) : (
              <p className="text-ink-muted dark:text-neutral-500">
                Click <strong>Generate prompt</strong> to create an image-generator prompt for this article.
              </p>
            )}
          </div>

          <p className="text-xs text-ink-muted dark:text-neutral-500">
            Paste this prompt into ChatGPT&apos;s image generator (or any DALL·E /
            GPT-Image / similar tool). The prompt explicitly asks for{" "}
            <strong>{spec.ratio}</strong> aspect ratio with generous safe-area
            padding so the result survives Medium / X cropping.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3 dark:border-neutral-800">
          {stream.isStreaming ? (
            <button
              type="button"
              onClick={stream.stop}
              className="inline-flex items-center gap-1.5 rounded-full border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
            >
              <X size={14} />
              Stop
            </button>
          ) : (
            <>
              {!hasGenerated && !promptText && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  disabled={!markdown.trim()}
                  className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50 dark:bg-neutral-100 dark:text-ink dark:hover:bg-white"
                >
                  <Sparkles size={14} />
                  Generate prompt
                </button>
              )}
              {(hasGenerated || promptText) && (
                <button
                  type="button"
                  onClick={handleRegenerate}
                  className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                >
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              )}
              <button
                type="button"
                onClick={handleCopy}
                disabled={!canCopy}
                className="inline-flex items-center gap-1.5 rounded-full border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                {copied ? <Check size={14} /> : <Clipboard size={14} />}
                {copied ? "Copied" : "Copy prompt"}
              </button>
              <button
                type="button"
                onClick={() => openInChatGPT(promptText)}
                disabled={!canCopy}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-50 dark:bg-neutral-100 dark:text-ink dark:hover:bg-white"
                title="Opens chatgpt.com in a new tab with this prompt pre-filled"
              >
                <Sparkles size={14} />
                Open in ChatGPT
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
