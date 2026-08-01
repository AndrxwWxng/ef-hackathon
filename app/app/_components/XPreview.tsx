import { SiX } from "react-icons/si";
import {
  IoChatbubbleOutline,
  IoEyeOutline,
  IoHeart,
  IoRepeat,
  IoShareOutline,
} from "react-icons/io5";
import { Markdown } from "./Markdown";

type Props = {
  body: string;
  authorName?: string;
  authorHandle?: string;
};

export function XPreview({ body, authorName, authorHandle }: Props) {
  const trimmed = body.trim();
  const charCount = trimmed.length;
  const overLimit = charCount > 280;

  return (
    <div className="w-[560px] max-w-full overflow-hidden rounded-xl border border-black/10 bg-black text-[#e7e9ea] shadow-[0_24px_60px_-44px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between border-b border-white/[0.08] bg-black px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SiX className="h-3.5 w-3.5 text-white" aria-hidden />
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#71767b]">
            X post preview
          </span>
        </div>
        <span
          className={
            "font-mono text-[10.5px] " +
            (overLimit ? "text-red-400" : "text-[#71767b]")
          }
        >
          {charCount} / 280
        </span>
      </div>

      <article className="px-4 py-3">
        <header className="flex items-start gap-3">
          <div
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#1d9bf0] to-[#0a2540] text-[14px] font-semibold text-white"
          >
            {initials(authorName ?? "MM")}
          </div>
          <div className="flex min-w-0 flex-1 flex-col text-[15px] leading-snug">
            <div className="flex items-center gap-1">
              <span className="truncate font-bold text-[#e7e9ea]">{authorName ?? "Multimail"}</span>
              <svg viewBox="0 0 22 22" className="h-4 w-4 shrink-0 text-[#1d9bf0]" fill="currentColor" aria-hidden>
                <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.275.213-1.815.568s-.972.854-1.247 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.879 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.68s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.428-1.427 2.001 2 4.588-4.587 1.427 1.428z" />
              </svg>
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
  const Icon =
    icon === "like" && active
      ? IoHeart
      : icon === "reply"
        ? IoChatbubbleOutline
        : icon === "repost"
          ? IoRepeat
          : icon === "view"
            ? IoEyeOutline
            : IoShareOutline;
  const color = active
    ? "text-[#f91880]"
    : icon === "repost"
      ? "text-[#00ba7c]"
      : "text-[#71767b]";
  return (
    <button
      type="button"
      className={"group flex items-center gap-1 rounded-full px-2 py-1 text-[12px] transition-colors hover:bg-white/5 " + color}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden />
      {count ? <span>{count}</span> : null}
    </button>
  );
}
