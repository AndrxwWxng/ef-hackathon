import { Fragment, type ReactNode } from "react";

type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language?: string; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      i += 1;
      continue;
    }

    const fence = /^```(\w+)?\s*$/.exec(trimmed);
    if (fence) {
      const lang = fence[1];
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push({ kind: "code", language: lang, text: buf.join("\n") });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", text: buf.join("\n").trim() });
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
      if (t.trim() === "") break;
      if (/^(#{1,6})\s+/.test(t.trim())) break;
      if (/^>\s?/.test(t.trim())) break;
      if (/^```/.test(t.trim())) break;
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

const ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ESCAPE[c] ?? c);
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  let counter = 0;
  const remaining = text;
  const tokenRegex =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(!\[[^\]]*]\([^)]+\))|(\[[^\]]+]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRegex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      out.push(remaining.slice(lastIndex, match.index));
    }
    const tok = match[0];
    const key = `${keyPrefix}-${counter++}`;
    if (tok.startsWith("`")) {
      out.push(<code key={key} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.85em]">{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("![") && tok.includes("](")) {
      const m = /^!\[([^\]]*)]\(([^)]+)\)$/.exec(tok);
      if (m) {
        const alt = escapeAttr(m[1]);
        const src = escapeAttr(m[2]);
        out.push(
          // eslint-disable-next-line @next/next/no-img-element
          <img key={key} src={src} alt={alt} className="my-2 max-h-72 rounded-md border border-black/10" />,
        );
      }
    } else if (tok.startsWith("*[") || tok.startsWith("[") && tok.includes("](")) {
      const m = /^\[([^\]]+)]\(([^)]+)\)$/.exec(tok);
      if (m) {
        out.push(
          <a key={key} href={escapeAttr(m[2])} target="_blank" rel="noreferrer noopener" className="underline decoration-1 underline-offset-2">
            {m[1]}
          </a>,
        );
      }
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    lastIndex = match.index + tok.length;
  }
  if (lastIndex < remaining.length) {
    out.push(remaining.slice(lastIndex));
  }
  return out;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseBlocks(source);
  return (
    <>
      {blocks.map((block, idx) => {
        const key = `b-${idx}`;
        switch (block.kind) {
          case "heading": {
            const inner = renderInline(escapeHtml(block.text), `${key}-h`);
            if (block.level === 1) return <h1 key={key} className="mt-4 text-2xl font-bold tracking-tight">{inner}</h1>;
            if (block.level === 2) return <h2 key={key} className="mt-4 text-xl font-semibold tracking-tight">{inner}</h2>;
            return <h3 key={key} className="mt-3 text-lg font-semibold tracking-tight">{inner}</h3>;
          }
          case "paragraph":
            return <p key={key} className="leading-relaxed">{renderInline(escapeHtml(block.text), key)}</p>;
          case "list":
            if (block.ordered) {
              return (
                <ol key={key} className="my-2 list-decimal space-y-1 pl-6">
                  {block.items.map((item, i) => (
                    <li key={`${key}-${i}`}>{renderInline(escapeHtml(item), `${key}-${i}`)}</li>
                  ))}
                </ol>
              );
            }
            return (
              <ul key={key} className="my-2 list-disc space-y-1 pl-6">
                {block.items.map((item, i) => (
                  <li key={`${key}-${i}`}>{renderInline(escapeHtml(item), `${key}-${i}`)}</li>
                ))}
              </ul>
            );
          case "code":
            return (
              <pre key={key} className="my-2 overflow-x-auto rounded-md bg-black/5 p-3 font-mono text-[0.85em]">
                <code>{block.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={key} className="my-2 border-l-4 border-current/30 pl-4 italic opacity-90">
                {block.text.split("\n").map((line, i, arr) => (
                  <Fragment key={`${key}-q-${i}`}>
                    {renderInline(escapeHtml(line), `${key}-q-${i}`)}
                    {i < arr.length - 1 ? <br /> : null}
                  </Fragment>
                ))}
              </blockquote>
            );
          case "rule":
            return <hr key={key} className="my-4 border-t border-current/20" />;
        }
      })}
    </>
  );
}
