/**
 * X (Twitter) Article–safe Markdown -> HTML converter.
 *
 * X Articles support a slightly different tag set than Medium:
 *   <h2>, <h3>, <h4>, <p>, <strong>, <em>, <del>, <s>, <a>,
 *   <blockquote>, <hr>, <ul>, <ol>, <li>
 *
 * Notably:
 *   - X has a separate title field. The article body should NOT contain <h1>.
 *     If a model emits a leading "# Title" line, we DEMOTE it to <h2>.
 *   - Strikethrough (~~text~~) is supported on X (unlike Medium), so we keep it.
 *   - All other rules mirror the Medium converter for safety.
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
 * Inline formatting: bold, italic, strikethrough, links. Order matters because
 * we tokenize before escaping so the escape doesn't mangle generated HTML tags.
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
    /~~([^~\n]+?)~~/g,
    (m) => `<del>${escapeHtml(m[1])}</del>`,
  );

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
  | { type: "h2" | "h3" | "h4"; text: string }
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
      // X has a separate title field — H1 in the body is demoted to H2.
      // H5/H6 collapse to H4 since X only supports up to H4.
      const headingType: Block["type"] =
        level === 1 || level === 2
          ? "h2"
          : level === 3
            ? "h3"
            : "h4";
      blocks.push({ type: headingType, text });
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
    case "h2":
      return `<h2>${renderInline(block.text)}</h2>`;
    case "h3":
      return `<h3>${renderInline(block.text)}</h3>`;
    case "h4":
      return `<h4>${renderInline(block.text)}</h4>`;
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
 * Convert X-targeted markdown into clean HTML using only X-Article-safe tags.
 * Output is suitable for clipboard `text/html` when pasting into the X
 * Articles editor at https://x.com/i/article/compose.
 */
export function markdownToXHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  return blocks.map(renderBlock).join("\n");
}

/**
 * Wrap the body HTML in a minimal document so the clipboard receives a
 * well-formed `text/html` payload that X's paste handler accepts.
 */
export function wrapAsClipboardHtml(bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodyHtml}</body></html>`;
}
