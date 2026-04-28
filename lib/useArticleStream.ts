"use client";

import { useCallback, useRef, useState } from "react";

export type ModelInfo = { id: string; label: string; index: number };

/**
 * Strip every emoji codepoint from a generated article. Defense in depth:
 * the system prompt forbids emojis, but models occasionally sneak one in.
 * Uses Unicode property escapes (Extended_Pictographic) to catch any of them.
 */
function stripEmojis(input: string): string {
  if (!input) return input;
  // \p{Extended_Pictographic} matches all emoji glyphs; \uFE0F is the
  // variation selector commonly attached after a base char to make it emoji.
  return input
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\uFE0F/g, "")
    .replace(/[\u200D\u20E3]/g, "")
    .replace(/  +/g, " ");
}

export type StreamState = {
  output: string;
  isStreaming: boolean;
  error: string | null;
  activeModel: ModelInfo | null;
  fallbackNote: string | null;
};

type StreamEvent =
  | { type: "model"; id: string; label: string; index: number }
  | { type: "token"; value: string }
  | { type: "fallback"; from: string; to: string; reason: string }
  | { type: "done" }
  | { type: "error"; message: string };

/**
 * Shared hook for the NDJSON event stream emitted by /api/generate and
 * /api/translate (any endpoint that follows our `{type, ...}` line protocol).
 *
 * Parses one JSON event per line, surfaces model + fallback events for the UI
 * chip, and gives back imperative controls (run, stop, setOutput) so different
 * components (WriteBlock, RewriteBlock, OutputPreview translate) can drive the
 * same streaming pipeline without duplicating parse + abort + error logic.
 */
export function useArticleStream(endpoint: string = "/api/generate") {
  const [output, setOutput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<ModelInfo | null>(null);
  const [fallbackNote, setFallbackNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setOutput("");
    setError(null);
    setActiveModel(null);
    setFallbackNote(null);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const run = useCallback(
    async (
      body: Record<string, unknown>,
      opts?: { onComplete?: (markdown: string) => void },
    ): Promise<void> => {
      if (isStreaming) return;
      reset();
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

        const handleLine = (line: string) => {
          if (!line) return;
          let event: StreamEvent;
          try {
            event = JSON.parse(line) as StreamEvent;
          } catch {
            return;
          }
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
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let nlIndex: number;
          while ((nlIndex = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nlIndex).trim();
            buffer = buffer.slice(nlIndex + 1);
            handleLine(line);
          }
        }

        if (buffer.trim()) handleLine(buffer.trim());

        const cleaned = stripEmojis(acc);
        if (cleaned !== acc) {
          // Replace mid-stream-rendered output (which may contain emojis) with
          // the cleaned final version before notifying listeners.
          setOutput(cleaned);
        }
        opts?.onComplete?.(cleaned);
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
    },
    [endpoint, isStreaming, reset],
  );

  return {
    output,
    isStreaming,
    error,
    activeModel,
    fallbackNote,
    setOutput,
    setError,
    setFallbackNote,
    run,
    stop,
    reset,
  };
}
