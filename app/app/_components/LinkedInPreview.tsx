import { useMemo } from "react";
import { Markdown } from "./Markdown";

type Props = {
  body: string;
  authorName?: string;
  authorTitle?: string;
};

export function LinkedInPreview({ body, authorName, authorTitle }: Props) {
  const displayLines = useMemo(() => body.split("\n").filter((l) => l.trim().length > 0), [body]);
  const charCount = body.length;

  return (
    <div className="overflow-hidden rounded-xl border border-[#e5e7eb] bg-white text-[#1f2937] shadow-[0_24px_60px_-44px_rgba(15,23,42,0.35)]">
      <div className="border-b border-[#e5e7eb] bg-[#f3f6f8] px-4 py-2.5">
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.16em] text-[#475569]">
          <span>LinkedIn · Preview</span>
          <span>Post · {charCount.toLocaleString()} chars</span>
        </div>
      </div>
      <div className="px-5 py-4 sm:px-6 sm:py-5">
        <header className="flex items-start gap-3">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0a66c2] to-[#004182] font-serif text-lg font-semibold text-white">
            {initials(authorName ?? "MM")}
          </div>
          <div className="flex flex-col">
            <div className="text-[14px] font-semibold leading-tight text-[#0a0a0a]">
              {authorName ?? "Multimail Team"}
            </div>
            <div className="text-[12.5px] text-[#5e5e5e]">
              {authorTitle ?? "Founder, Polar Relay · weekly build notes"}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[12px] text-[#5e5e5e]">
              <span>Just now</span>
              <span aria-hidden>·</span>
              <span aria-hidden>🌐</span>
            </div>
          </div>
        </header>

        <div className="mt-3 text-[14px] leading-[1.55] text-[#1f1f1f] sm:text-[14.5px]">
          {displayLines.length <= 1 ? (
            <p className="whitespace-pre-wrap">{displayLines[0] ?? body}</p>
          ) : (
            <div className="space-y-3">
              {displayLines.slice(0, 1).map((line, i) => (
                <p key={`lead-${i}`} className="whitespace-pre-wrap">{line}</p>
              ))}
              <Markdown source={displayLines.slice(1).join("\n\n")} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#eef0f2] pt-3 text-[#5e5e5e]">
          <div className="flex items-center gap-1">
            <Reaction aria="like" />
            <Reaction aria="celebrate" />
            <Reaction aria="support" />
            <span className="-ml-1.5 text-[12px]">84</span>
          </div>
          <div className="text-[12px]">12 comments · 3 reposts</div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-[#eef0f2] pt-2 text-[13px] font-medium text-[#5e5e5e]">
          <IconAction label="Like" />
          <IconAction label="Comment" />
          <IconAction label="Repost" />
          <IconAction label="Send" />
        </div>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "MM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Reaction({ aria }: { aria: string }) {
  const palette: Record<string, string> = {
    like: "bg-[#0a66c2]",
    celebrate: "bg-[#6dae4f]",
    support: "bg-[#915f4c]",
  };
  return (
    <span
      aria-label={aria}
      className={`grid h-4 w-4 place-items-center rounded-full border-2 border-white ${palette[aria] ?? "bg-[#0a66c2]"} text-[8px] text-white`}
    >
      {aria === "like" ? "👍" : aria === "celebrate" ? "🎉" : "🤝"}
    </span>
  );
}

function IconAction({ label }: { label: string }) {
  const icon: Record<string, string> = {
    Like: "M14 9V5a3 3 0 0 0-3-3l-1 4 4 3Zm0 0H4v8h10l2-3",
    Comment: "M3 5h10v6H6l-3 3z",
    Repost: "M4 8V5l-3 3 3 3v-3h7M12 11v3l3-3-3-3v3H5",
    Send: "M2 8l12-6-4 14-3-6-5-2z",
  };
  return (
    <button type="button" className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[12.5px] hover:bg-[#f3f6f8]">
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={icon[label] ?? ""} />
      </svg>
      {label}
    </button>
  );
}
