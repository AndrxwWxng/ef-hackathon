type Props = {
  body: string;
  week?: string;
  author?: string;
};

export function NewsletterPreview({ body, week, author }: Props) {
  const dateLine = week ?? new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--app-line)] bg-white text-[#1f2937] shadow-[0_24px_60px_-44px_rgba(15,23,42,0.35)]">
      <div className="border-b border-[#e5e7eb] bg-[#f8fafc] px-6 py-3">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-[#64748b]">
          <span>Sponsor Dispatch</span>
          <span>Issue · {dateLine}</span>
        </div>
      </div>
      <div className="mx-auto max-w-[640px] px-8 py-10 sm:px-12 sm:py-14">
        <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#9ca3af]">
          Polar Relay · weekly
        </div>
        <h1 className="mt-3 font-serif text-[2rem] font-semibold leading-[1.1] tracking-[-0.01em] text-[#0f172a] sm:text-[2.4rem]">
          Sponsor dispatch
        </h1>
        <div className="mt-2 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[#94a3b8]">
          <span>{dateLine}</span>
          <span>·</span>
          <span>{author ?? "Multimail Team"}</span>
        </div>
        <hr className="my-8 border-t border-[#e5e7eb]" />
        <article className="font-serif text-[1.05rem] leading-[1.7] text-[#1f2937]">
          <MarkdownLite source={body} />
        </article>
        <hr className="my-10 border-t border-[#e5e7eb]" />
        <footer className="flex flex-col gap-2 font-sans text-[12px] text-[#64748b]">
          <div>You are receiving this because you sponsor Polar Relay.</div>
          <div className="font-mono uppercase tracking-[0.18em]">© Polar Relay · {new Date().getFullYear()}</div>
        </footer>
      </div>
    </div>
  );
}

function MarkdownLite({ source }: { source: string }) {
  const blocks = parseLite(source);
  return (
    <>
      {blocks.map((block, idx) => {
        const key = `n-${idx}`;
        if (block.kind === "heading") {
          if (block.level === 1)
            return (
              <h1 key={key} className="mt-6 text-[1.7rem] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0f172a]">
                {block.text}
              </h1>
            );
          if (block.level === 2)
            return (
              <h2 key={key} className="mt-7 text-[1.3rem] font-semibold leading-tight tracking-[-0.01em] text-[#0f172a]">
                {block.text}
              </h2>
            );
          return (
            <h3 key={key} className="mt-5 text-[1.1rem] font-semibold leading-snug text-[#0f172a]">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "paragraph") {
          return (
            <p key={key} className="my-3">
              {renderLiteInline(block.text)}
            </p>
          );
        }
        if (block.kind === "list") {
          if (block.ordered)
            return (
              <ol key={key} className="my-3 list-decimal space-y-1.5 pl-6">
                {block.items.map((it, i) => (
                  <li key={`${key}-${i}`}>{renderLiteInline(it)}</li>
                ))}
              </ol>
            );
          return (
            <ul key={key} className="my-3 list-disc space-y-1.5 pl-6">
              {block.items.map((it, i) => (
                <li key={`${key}-${i}`}>{renderLiteInline(it)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "quote") {
          return (
            <blockquote key={key} className="my-4 border-l-4 border-[#94a3b8] pl-4 text-[#475569]">
              {block.text}
            </blockquote>
          );
        }
        return <hr key={key} className="my-6 border-t border-[#e5e7eb]" />;
      })}
    </>
  );
}

type LiteBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

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
      blocks.push({ kind: "heading", level: h[1].length as 1 | 2 | 3, text: h[2] });
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

function renderLiteInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+]\([^)]+\))/g;
  let last = 0;
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    const key = `li-${n++}`;
    if (t.startsWith("**")) parts.push(<strong key={key}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) parts.push(<em key={key}>{t.slice(1, -1)}</em>);
    else if (t.startsWith("[")) {
      const lm = /^\[([^\]]+)]\(([^)]+)\)$/.exec(t);
      if (lm)
        parts.push(
          <a key={key} href={lm[2]} target="_blank" rel="noreferrer noopener" className="text-[#1d4ed8] underline">
            {lm[1]}
          </a>,
        );
    }
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
