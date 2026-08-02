// Builds a self-contained HTML email for the newsletter.
// Mirrors the visual structure of app/app/_components/NewsletterPreview.tsx,
// but uses inline styles + a 600px table layout so it renders consistently
// across Gmail, Outlook, Apple Mail, etc.

const COLOR_INK = "#0a0a0a";
const COLOR_BODY = "#1f2937";
const COLOR_MUTED = "#6b7280";
const COLOR_RULE = "rgba(15, 23, 42, 0.12)";
const COLOR_LINK = "#1d4ed8";
const COLOR_BG = "#ffffff";
const FONT_SERIF = "Georgia, 'Times New Roman', serif";
const FONT_SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

type LiteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+]\([^)]+\))/g,
    (match) => {
      if (match.startsWith("**")) {
        return `<strong style="color:${COLOR_INK};font-weight:600;">${match.slice(2, -2)}</strong>`;
      }
      if (match.startsWith("*")) {
        return `<em style="font-style:italic;">${match.slice(1, -1)}</em>`;
      }
      const lm = /^\[([^\]]+)]\(([^)]+)\)$/.exec(match);
      if (lm) {
        const href = lm[2].replace(/"/g, "%22");
        return `<a href="${href}" style="color:${COLOR_LINK};text-decoration:underline;" target="_blank" rel="noreferrer noopener">${lm[1]}</a>`;
      }
      return match;
    },
  );
}

function parseLite(input: string): LiteBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: LiteBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      i += 1;
      continue;
    }
    if (/^---+$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      blocks.push({ kind: "heading", level: Math.min(3, h[1].length) as 1 | 2 | 3, text: h[2] });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: buf.join(" ").trim() });
      continue;
    }
    const ordered = /^\d+\.\s+/.test(trimmed);
    const unordered = /^[-*+]\s+/.test(trimmed);
    if (ordered || unordered) {
      const items: string[] = [];
      while (i < lines.length) {
        const t = lines[i].trim();
        const m = ordered ? /^\d+\.\s+(.*)$/.exec(t) : /^[-*+]\s+(.*)$/.exec(t);
        if (!m) break;
        items.push(m[1]);
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length) {
      const t = lines[i];
      if (!t.trim()) break;
      if (/^(#{1,6})\s+/.test(t.trim())) break;
      if (/^>\s?/.test(t.trim())) break;
      if (/^---+\s*$/.test(t.trim())) break;
      if (/^[-*+]\s+/.test(t.trim())) break;
      if (/^\d+\.\s+/.test(t.trim())) break;
      buf.push(t);
      i += 1;
    }
    blocks.push({ kind: "paragraph", text: buf.join(" ").trim() });
  }
  return blocks;
}

function renderBlock(block: LiteBlock): string {
  if (block.kind === "heading") {
    const size =
      block.level === 1 ? "26px" : block.level === 2 ? "20px" : "17px";
    const mt = block.level === 1 ? "20px" : block.level === 2 ? "24px" : "18px";
    const lh = block.level === 1 ? "1.15" : block.level === 2 ? "1.2" : "1.3";
    return `<h${block.level} style="margin:${mt} 0 0 0;color:${COLOR_INK};font-family:${FONT_SERIF};font-size:${size};font-weight:600;letter-spacing:-0.01em;line-height:${lh};">${renderInline(block.text)}</h${block.level}>`;
  }
  if (block.kind === "paragraph") {
    return `<p style="margin:10px 0;color:${COLOR_BODY};font-family:${FONT_SERIF};font-size:16px;line-height:1.7;">${renderInline(block.text)}</p>`;
  }
  if (block.kind === "list") {
    const tag = block.ordered ? "ol" : "ul";
    const style = block.ordered
      ? "list-style-type:decimal;padding-left:24px;"
      : "list-style-type:disc;padding-left:24px;";
    const items = block.items
      .map(
        (it) =>
          `<li style="margin:0 0 6px 0;color:${COLOR_BODY};font-family:${FONT_SERIF};font-size:16px;line-height:1.7;">${renderInline(it)}</li>`,
      )
      .join("");
    return `<${tag} style="margin:12px 0;${style}">${items}</${tag}>`;
  }
  if (block.kind === "quote") {
    return `<blockquote style="margin:16px 0;padding:0 0 0 16px;border-left:2px solid #94a3b8;color:#475569;font-family:${FONT_SERIF};font-size:16px;line-height:1.7;">${renderInline(block.text)}</blockquote>`;
  }
  return `<hr style="border:none;border-top:1px solid ${COLOR_RULE};margin:24px 0;" />`;
}

export type NewsletterImage = {
  contentId: string;
  alt?: string;
  caption?: string;
};

function titleFromBody(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (h) return h[2].replace(/\*\*/g, "").trim();
  }
  return "Weekly update";
}

function bodyWithoutLeadingTitle(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i < lines.length && /^(#{1,3})\s+/.test(lines[i].trim())) {
    i += 1;
    while (i < lines.length && !lines[i].trim()) i += 1;
    return lines.slice(i).join("\n").trim();
  }
  return body.trim();
}

function renderImageBlock(img: NewsletterImage): string {
  const alt = escapeHtml(img.alt ?? "App screenshot");
  const caption = img.caption
    ? `<div style="margin:6px 0 0 0;font-family:${FONT_MONO};font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:${COLOR_MUTED};">${escapeHtml(img.caption)}</div>`
    : "";
  return `<div style="margin:0 0 18px 0;">
              <img src="cid:${escapeHtml(img.contentId)}" alt="${alt}" width="504" style="display:block;width:100%;max-width:504px;height:auto;border:1px solid ${COLOR_RULE};border-radius:10px;" />
              ${caption}
            </div>`;
}

export function buildNewsletterHtml(opts: {
  body: string;
  author?: string;
  week?: string;
  images?: NewsletterImage[];
}): string {
  const dateLine =
    opts.week ??
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const author = opts.author ?? "Multimail Team";
  const year = new Date().getFullYear();
  const title = titleFromBody(opts.body);
  const contentBody = bodyWithoutLeadingTitle(opts.body);

  const blocks = parseLite(contentBody).map(renderBlock).join("\n");
  const images = opts.images ?? [];
  const imageSection =
    images.length === 0
      ? ""
      : `
            <hr style="border:none;border-top:1px solid ${COLOR_RULE};margin:28px 0;" />
            <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;margin:0 0 12px 0;">Product shots</div>
            ${images.map(renderImageBlock).join("\n")}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;color:${COLOR_BODY};-webkit-font-smoothing:antialiased;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f5f5f4;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:${COLOR_BG};border:1px solid ${COLOR_RULE};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:40px 48px 48px 48px;">
            <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#9ca3af;">Multimail &middot; weekly</div>
            <h1 style="margin:12px 0 0 0;color:${COLOR_INK};font-family:${FONT_SERIF};font-size:34px;font-weight:600;line-height:1.1;letter-spacing:-0.02em;">${escapeHtml(title)}</h1>
            <div style="margin-top:8px;font-family:${FONT_SANS};font-size:12px;color:#9ca3af;">
              <span>${escapeHtml(dateLine)}</span>
              <span style="margin:0 6px;">&middot;</span>
              <span>${escapeHtml(author)}</span>
            </div>
            <hr style="border:none;border-top:1px solid ${COLOR_RULE};margin:28px 0;" />
            <div style="font-family:${FONT_SERIF};font-size:16px;line-height:1.7;color:${COLOR_BODY};">
${blocks}
            </div>
${imageSection}
            <hr style="border:none;border-top:1px solid ${COLOR_RULE};margin:36px 0 16px 0;" />
            <div style="font-family:${FONT_SANS};font-size:12px;color:${COLOR_MUTED};">
              <div style="margin:0 0 4px 0;">You are receiving this because you sponsor Multimail.</div>
              <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:0.12em;text-transform:uppercase;">&copy; Multimail &middot; ${year}</div>
            </div>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function buildNewsletterText(opts: {
  body: string;
  author?: string;
  week?: string;
}): string {
  const dateLine =
    opts.week ??
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const author = opts.author ?? "Multimail Team";
  const year = new Date().getFullYear();
  const title = titleFromBody(opts.body);
  return [
    "Multimail · weekly",
    title,
    `${dateLine} · ${author}`,
    "",
    opts.body.trim(),
    "",
    "---",
    "You are receiving this because you sponsor Multimail.",
    `© Multimail · ${year}`,
  ].join("\n");
}
