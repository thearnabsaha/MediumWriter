"use client";

import { useState } from "react";
import { Trash2, Plus, Sparkles } from "lucide-react";
import {
  MAX_STYLE_BLOCKS,
  MAX_STYLE_BLOCK_LENGTH,
  useStore,
} from "@/lib/store";
import { summarizeStyle } from "@/lib/styleProcessor";

export default function StyleBlock() {
  const styleBlocks = useStore((s) => s.styleBlocks);
  const addStyleBlock = useStore((s) => s.addStyleBlock);
  const removeStyleBlock = useStore((s) => s.removeStyleBlock);

  const [draft, setDraft] = useState("");
  const atCapacity = styleBlocks.length >= MAX_STYLE_BLOCKS;
  const summary = summarizeStyle(styleBlocks.map((b) => b.content));

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed || atCapacity) return;
    addStyleBlock(trimmed);
    setDraft("");
  };

  return (
    <section className="flex h-full flex-col rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <header className="mb-4">
        <h2 className="text-lg font-semibold text-ink dark:text-neutral-100">
          Your Writing Style
        </h2>
        <p className="mt-1 text-sm text-ink-muted dark:text-neutral-400">
          Paste up to {MAX_STYLE_BLOCKS} of your previous articles or paragraphs.
          The AI will mimic your tone and rhythm.
        </p>
      </header>

      <div className="mb-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, MAX_STYLE_BLOCK_LENGTH))}
          placeholder="Paste a paragraph or full article you've written before..."
          rows={6}
          disabled={atCapacity}
          className="w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-ink placeholder:text-neutral-400 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <div className="mt-2 flex items-center justify-between text-xs text-ink-muted dark:text-neutral-400">
          <span>
            {draft.length} / {MAX_STYLE_BLOCK_LENGTH}
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={!draft.trim() || atCapacity}
            className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} />
            Save sample
          </button>
        </div>
        {atCapacity && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            Maximum {MAX_STYLE_BLOCKS} samples reached. Delete one to add more.
          </p>
        )}
      </div>

      {summary && (
        <div className="mb-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-700 dark:bg-neutral-950">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-ink dark:text-neutral-200">
            <Sparkles size={12} className="text-accent" />
            Detected style
          </div>
          <ul className="space-y-0.5 text-ink-muted dark:text-neutral-400">
            <li>Tone: {summary.tone}</li>
            <li>Avg sentence: {summary.avgSentenceLength} words</li>
            <li>Vocabulary: {summary.vocabLevel}</li>
          </ul>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted dark:text-neutral-400">
          Saved samples ({styleBlocks.length}/{MAX_STYLE_BLOCKS})
        </h3>
        {styleBlocks.length === 0 ? (
          <p className="text-sm italic text-ink-muted dark:text-neutral-500">
            No samples yet. Add one above to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {styleBlocks.map((block) => (
              <li
                key={block.id}
                className="group relative rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              >
                <p className="line-clamp-3 pr-8 text-ink dark:text-neutral-200">
                  {block.content}
                </p>
                <button
                  type="button"
                  onClick={() => removeStyleBlock(block.id)}
                  aria-label="Delete sample"
                  className="absolute right-2 top-2 rounded-full p-1 text-ink-muted opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
