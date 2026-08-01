import { BadgeCheck, Eye, Heart, MessageCircle, Repeat2, Share } from "lucide-react";
import { Markdown } from "./Markdown";

type Props = {
  body: string;
  authorName?: string;
  authorHandle?: string;
};

export function XPreview({ body, authorName, authorHandle }: Props) {
  const trimmed = body.trim();
  const charCount = trimmed.length;
  return (
    <div className="overflow-hidden rounded-xl border border-black/10 bg-black text-[#e7e9ea] shadow-[0_24px_60px_-44px_rgba(0,0,0,0.6)]">
      <div className="border-b border-[#2f3336] bg-black px-4 py-2">
        <div className="flex items-center justify-between font-mono text-[10.5px] uppercase tracking-[0.16em] text-[#71767b]">
          <span>X · Post</span>
          <span>{charCount} / 280</span>
        </div>
      </div>
      <article className="px-4 py-3 sm:px-5 sm:py-4">
        <header className="flex items-start gap-3">
          <div
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1d9bf0] to-[#0a2540] font-serif text-base font-semibold text-white"
          >
            {initials(authorName ?? "MM")}
          </div>
          <div className="flex min-w-0 flex-1 flex-col text-[15px] leading-snug">
            <div className="flex items-center gap-1">
              <span className="truncate font-bold text-[#e7e9ea]">{authorName ?? "Multimail"}</span>
              <BadgeCheck className="h-4 w-4 shrink-0 text-[#1d9bf0]" fill="currentColor" aria-hidden />
              <span className="text-[#71767b]">@{authorHandle ?? "multimail"}</span>
            </div>
            <div className="-mt-0.5">
              <PostBody body={trimmed} />
            </div>
            <div className="-mt-0.5 flex items-center gap-1 text-[13px] text-[#71767b]">
              <span>Just now</span>
              <span aria-hidden>·</span>
              <span>Visible to everyone</span>
            </div>
          </div>
        </header>

        <div className="mt-3 flex max-w-md items-center justify-between text-[#71767b]">
          <Action icon="reply" />
          <Action icon="repost" count="3" />
          <Action icon="like" count="42" active />
          <Action icon="view" count="1.2K" />
          <Action icon="share" />
        </div>
      </article>
    </div>
  );
}

function PostBody({ body }: { body: string }) {
  const lines = body.split("\n");
  if (lines.length === 1) {
    return (
      <div className="whitespace-pre-wrap text-[15px] leading-[1.45] text-[#e7e9ea]">
        {body}
      </div>
    );
  }
  const lead = lines[0];
  return (
    <div className="space-y-2">
      <p className="whitespace-pre-wrap text-[15px] leading-[1.45]">{lead}</p>
      {lines.slice(1).some((l) => l.includes("#")) ? (
        <Markdown source={lines.slice(1).join("\n")} />
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-[1.45] text-[#e7e9ea]">
          {lines.slice(1).join("\n")}
        </p>
      )}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "MM";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Action({
  icon,
  count,
  active,
}: {
  icon: "reply" | "repost" | "like" | "view" | "share";
  count?: string;
  active?: boolean;
}) {
  const icons = {
    reply: MessageCircle,
    repost: Repeat2,
    like: Heart,
    view: Eye,
    share: Share,
  } as const;
  const Icon = icons[icon];
  const color = active ? "text-[#f91880]" : icon === "repost" ? "text-[#00ba7c]" : "text-[#71767b]";
  const filled = active && icon === "like";
  return (
    <button type="button" className={`group flex items-center gap-1 rounded-full px-2 py-1 text-[12px] transition-colors hover:bg-white/5 ${color}`}>
      <Icon
        className="h-[18px] w-[18px]"
        fill={filled ? "currentColor" : "none"}
        strokeWidth={1.6}
        aria-hidden
      />
      {count ? <span>{count}</span> : null}
    </button>
  );
}
