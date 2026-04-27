import {
  markdownToMediumHtml,
  wrapAsClipboardHtml,
} from "./markdownToMediumHtml";

/**
 * Copy the article to the clipboard in a Medium-friendly format.
 *
 * We write BOTH:
 *   - text/html  -> Medium's paste handler reads this and preserves headings,
 *                   bold, italic, lists, blockquotes, and links.
 *   - text/plain -> raw markdown fallback for editors that don't accept HTML.
 *
 * Falls back gracefully if `navigator.clipboard.write` or `ClipboardItem` are
 * unavailable (older browsers, insecure contexts).
 */
export async function copyArticleToClipboard(markdown: string): Promise<{
  ok: boolean;
  format: "html" | "text" | "none";
}> {
  if (typeof navigator === "undefined") {
    return { ok: false, format: "none" };
  }

  const html = wrapAsClipboardHtml(markdownToMediumHtml(markdown));

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
 * Trigger a browser download of the article as a `.md` file.
 */
export function downloadAsMarkdown(markdown: string, filename = "article.md") {
  if (typeof window === "undefined") return;
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
