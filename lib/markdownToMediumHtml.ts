/**
 * Medium-safe Markdown -> HTML converter.
 *
 * Medium's editor accepts only a small set of HTML tags on paste:
 *   <h1>, <h2>, <p>, <strong>, <em>, <a>, <blockquote>, <hr>, <ul>, <ol>, <li>
 *
 * This converter intentionally supports only the markdown features we constrain
 * the LLM to produce. Anything outside the whitelist is escaped or demoted so
 * pasting into Medium never breaks the article structure.
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return /^(https?:|mailto:)/i.test(trimmed);
  }
  return true;
}

/**
 * Inline formatting: bold, italic, links. Order matters because we tokenize
 * before escaping so the escape doesn't mangle our generated HTML tags.
 */
function renderInline(text: string): string {
  type Token = { type: "text" | "html"; value: string };
  let tokens: Token[] = [{ type: "text", value: text }];

  const replaceInTextTokens = (
    pattern: RegExp,
    transform: (match: RegExpExecArray) => string,
  ) => {
    const next: Token[] = [];
    for (const tok of tokens) {
      if (tok.type !== "text") {
        next.push(tok);
        continue;
      }
      let lastIndex = 0;
      const src = tok.value;
      pattern.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(src)) !== null) {
        if (m.index > lastIndex) {
          next.push({ type: "text", value: src.slice(lastIndex, m.index) });
        }
        next.push({ type: "html", value: transform(m) });
        lastIndex = m.index + m[0].length;
        if (m[0].length === 0) pattern.lastIndex++;
      }
      if (lastIndex < src.length) {
        next.push({ type: "text", value: src.slice(lastIndex) });
      }
    }
    tokens = next;
  };

  replaceInTextTokens(/\[([^\]]+)\]\(([^)]+)\)/g, (m) => {
    const label = m[1];
    const url = m[2].trim();
    if (!isSafeUrl(url)) {
      return escapeHtml(m[0]);
    }
    return `<a href="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
  });

  replaceInTextTokens(
    /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g,
    (m) => `<strong>${escapeHtml(m[1] ?? m[2] ?? "")}</strong>`,
  );

  replaceInTextTokens(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)|(?<!_)_([^_\n]+?)_(?!_)/g,
    (m) => `<em>${escapeHtml(m[1] ?? m[2] ?? "")}</em>`,
  );

  return tokens
    .map((t) => (t.type === "html" ? t.value : escapeHtml(t.value)))
    .join("");
}

type Block =
  | { type: "h1" | "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "hr" };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const flushParagraph = (paraLines: string[]) => {
    if (paraLines.length === 0) return;
    const text = paraLines.join(" ").trim();
    if (text) blocks.push({ type: "p", text });
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    const hrMatch = /^(\*\s*\*\s*\*[\s*]*|-\s*-\s*-[\s-]*|_\s*_\s*_[\s_]*)$/.test(
      trimmed,
    );
    if (hrMatch) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      blocks.push({ type: level === 1 ? "h1" : "h2", text });
      i++;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i];
      const curTrim = cur.trim();
      if (!curTrim) break;
      if (/^#{1,6}\s+/.test(curTrim)) break;
      if (curTrim.startsWith(">")) break;
      if (/^[-*+]\s+/.test(curTrim)) break;
      if (/^\d+\.\s+/.test(curTrim)) break;
      if (/^(\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)/.test(curTrim)) break;
      paraLines.push(curTrim);
      i++;
    }
    flushParagraph(paraLines);
  }

  return blocks;
}

function renderBlock(block: Block): string {
  switch (block.type) {
    case "h1":
      return `<h1>${renderInline(block.text)}</h1>`;
    case "h2":
      return `<h2>${renderInline(block.text)}</h2>`;
    case "p":
      return `<p>${renderInline(block.text)}</p>`;
    case "hr":
      return `<hr />`;
    case "blockquote": {
      const inner = block.lines
        .filter(Boolean)
        .map((l) => renderInline(l))
        .join("<br />");
      return `<blockquote><p>${inner}</p></blockquote>`;
    }
    case "ul": {
      const items = block.items
        .map((it) => `<li>${renderInline(it)}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }
    case "ol": {
      const items = block.items
        .map((it) => `<li>${renderInline(it)}</li>`)
        .join("");
      return `<ol>${items}</ol>`;
    }
  }
}

/**
 * Convert a Medium-targeted markdown document into clean HTML using only
 * Medium-safe tags. Output is suitable for clipboard `text/html`.
 */
export function markdownToMediumHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  return blocks.map(renderBlock).join("\n");
}

/**
 * Wrap the body HTML in a minimal document so the clipboard receives a
 * well-formed `text/html` payload that Medium's paste handler accepts.
 */
export function wrapAsClipboardHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;
}
