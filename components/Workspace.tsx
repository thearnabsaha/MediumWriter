"use client";

import { useState } from "react";
import { PenLine, Wand2 } from "lucide-react";
import WriteBlock from "./WriteBlock";
import RewriteBlock from "./RewriteBlock";

type Mode = "generate" | "rewrite";

const TABS: Array<{ id: Mode; label: string; icon: React.ReactNode; hint: string }> = [
  {
    id: "generate",
    label: "Generate from topic",
    icon: <PenLine size={14} />,
    hint: "Start with a topic prompt",
  },
  {
    id: "rewrite",
    label: "Rewrite from article",
    icon: <Wand2 size={14} />,
    hint: "Reshape an existing article in a template's style",
  },
];

export default function Workspace() {
  const [mode, setMode] = useState<Mode>("generate");

  return (
    <div className="flex h-full flex-col gap-4">
      <nav
        role="tablist"
        aria-label="Writing mode"
        className="inline-flex w-fit gap-1 self-start rounded-full border border-neutral-200 bg-white p-1 shadow-sm dark:border-neutral-800 dark:bg-neutral-900"
      >
        {TABS.map((t) => {
          const active = mode === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMode(t.id)}
              title={t.hint}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition ${
                active
                  ? "bg-ink text-white dark:bg-neutral-100 dark:text-ink"
                  : "text-ink-muted hover:bg-neutral-100 hover:text-ink dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1">
        {mode === "generate" ? <WriteBlock /> : <RewriteBlock />}
      </div>
    </div>
  );
}
