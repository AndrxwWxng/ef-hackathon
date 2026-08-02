/**
 * The Multimail mark — one geometry, used everywhere.
 *
 * The glyph is an `M` whose middle drops into a `V`, so it reads as a monogram
 * and as an envelope flap at the same time. It is drawn once, at 32×32, and
 * every surface consumes one of three wrappers:
 *
 *   MultimailMark    plate + knockout  → headers, footers, favicon, chrome
 *   MultimailGlyph   stroke only       → inside circles and other tight plates
 *   MultimailLockup  mark + wordmark   → anywhere the name is spelled out
 *
 * The plate version knocks the glyph out through a mask rather than painting it
 * in a second colour, so the whole mark is a single `currentColor` shape and
 * works on any background without being told what sits behind it.
 */

/** Glyph path, in the shared 32×32 box. Do not edit in one place only. */
const GLYPH = "M9 22.2V10l7 7.3 7-7.3v12.2";
const STROKE = 3.1;

type MarkProps = React.SVGProps<SVGSVGElement> & {
  /** Override when marks of differing geometry share a document. */
  maskId?: string;
  title?: string;
};

/** Rounded plate with the glyph knocked out. The primary mark. */
export function MultimailMark({
  maskId = "multimail-mark",
  title,
  ...props
}: MarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="32" height="32">
        <rect width="32" height="32" rx="7.5" fill="#fff" />
        <path
          d={GLYPH}
          stroke="#000"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
      <rect width="32" height="32" rx="7.5" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}

/**
 * The glyph on its own, for when the container already provides the plate —
 * a circular avatar, say, where a second rounded square would fight it.
 */
export function MultimailGlyph({ title, ...props }: MarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d={GLYPH}
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Horizontal lockup: mark + "Multimail". */
export function MultimailLockup({
  size = "md",
  className = "",
  markClassName = "",
  title,
}: {
  size?: "sm" | "md";
  className?: string;
  /** Colour the mark apart from the wordmark, e.g. accent in the footer. */
  markClassName?: string;
  title?: string;
}) {
  const mark = size === "sm" ? "h-5 w-5" : "h-6 w-6";
  const word = size === "sm" ? "text-[0.95rem]" : "text-[1rem]";

  return (
    <span className={"inline-flex items-center gap-2 " + className}>
      <MultimailMark className={`${mark} shrink-0 ${markClassName}`} title={title} />
      <span className={`font-serif ${word} font-medium leading-none tracking-[-0.02em]`}>
        Multimail
      </span>
    </span>
  );
}
