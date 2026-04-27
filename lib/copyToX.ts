import {
  markdownToXHtml,
  wrapAsClipboardHtml,
} from "./markdownToXHtml";

/**
 * Copy the article to the clipboard in an X-Article-friendly format.
 *
 * We write BOTH:
 *   - text/html  -> X's paste handler reads this and preserves headings,
 *                   bold, italic, strikethrough, lists, blockquotes, links.
 *   - text/plain -> raw markdown fallback for editors that don't accept HTML.
 *
 * Falls back gracefully if `navigator.clipboard.write` or `ClipboardItem` are
 * unavailable (older browsers, insecure contexts).
 */
export async function copyXArticleToClipboard(markdown: string): Promise<{
  ok: boolean;
  format: "html" | "text" | "none";
}> {
  if (typeof navigator === "undefined") {
    return { ok: false, format: "none" };
  }

  const html = wrapAsClipboardHtml(markdownToXHtml(markdown));

  try {
    if (
      typeof window !== "undefined" &&
      typeof window.ClipboardItem !== "undefined" &&
      navigator.clipboard?.write
    ) {
      const item = new window.ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([markdown], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return { ok: true, format: "html" };
    }
  } catch {
    // fall through to plain-text fallback
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(markdown);
      return { ok: true, format: "text" };
    }
  } catch {
    // ignore
  }

  return { ok: false, format: "none" };
}

/**
 * Open X Articles compose in a new tab so the user can paste the article.
 */
export function openXArticleCompose() {
  if (typeof window === "undefined") return;
  window.open(
    "https://x.com/i/article/compose",
    "_blank",
    "noopener,noreferrer",
  );
}
