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
    <div className="w-[640px] max-w-full overflow-hidden rounded-xl border border-black/[0.08] bg-white text-[#1f2937] shadow-[0_24px_60px_-44px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between border-b border-black/[0.06] bg-white px-6 py-3">
        <div className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" className="h-4 w-4 text-[#0a0a0a]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
            <path d="m2.5 4.5 5.5 4 5.5-4" />
          </svg>
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#5e5e5e]">
            Email preview
          </span>
        </div>
        <span className="font-mono text-[10.5px] text-[#5e5e5e]">Issue · {dateLine}</span>
      </div>

      <div className="px-8 py-10 sm:px-12 sm:py-12">
        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9ca3af]">
          Polar Relay · weekly
        </div>
        <h1 className="mt-3 text-[1.9rem] font-semibold leading-[1.1] tracking-[-0.02em] text-[#0a0a0a] sm:text-[2.1rem]">
          Sponsor dispatch
        </h1>
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[#9ca3af]">
          <span>{dateLine}</span>
          <span aria-hidden>·</span>
          <span>{author ?? "Multimail Team"}</span>
        </div>
        <hr className="my-7 border-t border-black/[0.08]" />
        <article className="text-[1.02rem] leading-[1.7] text-[#1f2937]">
          <MarkdownLite source={body} />
        </article>
        <hr className="my-9 border-t border-black/[0.08]" />
        <footer className="flex flex-col gap-1 text-[11.5px] text-[#6b7280]">
          <div>You are receiving this because you sponsor Polar Relay.</div>
          <div className="font-mono uppercase tracking-[0.12em]">© Polar Relay · {new Date().getFullYear()}</div>
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
              <h1 key={key} className="mt-5 text-[1.55rem] font-semibold leading-[1.15] tracking-[-0.01em] text-[#0a0a0a]">
                {block.text}
              </h1>
            );
          if (block.level === 2)
            return (
              <h2 key={key} className="mt-6 text-[1.2rem] font-semibold leading-tight tracking-[-0.01em] text-[#0a0a0a]">
                {block.text}
              </h2>
            );
          return (
            <h3 key={key} className="mt-4 text-[1.05rem] font-semibold leading-snug text-[#0a0a0a]">
              {block.text}
            </h3>
          );
        }
        if (block.kind === "paragraph") {
          return (
            <p key={key} className="my-2.5">
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
            <blockquote key={key} className="my-4 border-l-2 border-[#94a3b8] pl-4 text-[#475569]">
              {block.text}
            </blockquote>
          );
        }
        return <hr key={key} className="my-6 border-t border-black/[0.08]" />;
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
