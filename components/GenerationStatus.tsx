"use client";

import { Cpu, Search } from "lucide-react";
import Spinner from "./Spinner";
import type { ModelInfo } from "@/lib/useArticleStream";

type Props = {
  activeModel: ModelInfo | null;
  isStreaming: boolean;
  fallbackNote: string | null;
  error: string | null;
  isResearching?: boolean;
  researchSourcesCount?: number;
};

export default function GenerationStatus({
  activeModel,
  isStreaming,
  fallbackNote,
  error,
  isResearching = false,
  researchSourcesCount = 0,
}: Props) {
  return (
    <>
      {(activeModel || isResearching || researchSourcesCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
              {researchSourcesCount} source
              {researchSourcesCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}

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
    </>
  );
}
