import { useMemo } from "react";
import { FaLinkedin } from "react-icons/fa";
import {
  IoChatbubbleOutline,
  IoPaperPlaneOutline,
  IoRepeat,
  IoThumbsUpOutline,
} from "react-icons/io5";
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
    <div className="w-[520px] max-w-full overflow-hidden rounded-xl border border-black/10 bg-white text-[#1f1f1f] shadow-[0_24px_60px_-44px_rgba(15,23,42,0.35)]">
      <div className="flex items-center justify-between border-b border-black/[0.06] bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FaLinkedin className="h-4 w-4 text-[#0a66c2]" aria-hidden />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#5e5e5e]">
            LinkedIn preview
          </span>
        </div>
        <span className="font-mono text-[10.5px] text-[#5e5e5e]">
          {charCount.toLocaleString()} chars
        </span>
      </div>

      <div className="px-5 py-4">
        <header className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0a66c2] to-[#004182] text-[14px] font-semibold text-white">
            {initials(authorName ?? "MM")}
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold leading-tight text-[#0a0a0a]">
              {authorName ?? "Multimail Team"}
              <span className="font-normal text-[#5e5e5e]">· 1st</span>
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

        <div className="mt-3 text-[14px] leading-[1.55] text-[#1f1f1f]">
          {displayLines.length <= 1 ? (
            <p className="whitespace-pre-wrap">{displayLines[0] ?? body}</p>
          ) : (
            <div className="space-y-3">
              <p className="whitespace-pre-wrap">{displayLines[0]}</p>
              <Markdown source={displayLines.slice(1).join("\n\n")} />
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-black/[0.06] pt-2.5 text-[12px] text-[#5e5e5e]">
          <div className="flex items-center gap-1.5">
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#0a66c2] text-[7px] text-white">
              👍
            </span>
            <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#6dae4f] text-[7px] text-white">
              🎉
            </span>
            <span>84</span>
          </div>
          <div>12 comments · 3 reposts</div>
        </div>

        <div className="mt-2.5 flex items-center justify-between border-t border-black/[0.06] pt-1.5 text-[13px] font-medium text-[#5e5e5e]">
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

function IconAction({ label }: { label: string }) {
  const Icon =
    label === "Like"
      ? IoThumbsUpOutline
      : label === "Comment"
        ? IoChatbubbleOutline
        : label === "Repost"
          ? IoRepeat
          : IoPaperPlaneOutline;
  return (
    <button
      type="button"
      className="flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-[12.5px] transition-colors hover:bg-black/[0.04]"
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}
