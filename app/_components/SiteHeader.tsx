"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function Logo({ paperColor }: { paperColor: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill="currentColor" />
      <path
        d="M5 19V6l7 8 7-8v13"
        stroke={paperColor}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith("/app");

  return (
    <header
      className={
        "sticky top-0 z-50 w-full border-b backdrop-blur-md " +
        (isWorkspace
          ? "border-[var(--app-line)] bg-[var(--app-bg)]/90 text-[var(--app-ink)]"
          : "border-[var(--border)]/60 bg-[var(--background)]/90 text-[var(--foreground)]")
      }
    >
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex h-11 w-full max-w-[1600px] items-center justify-between px-3 sm:px-5"
      >
        <Link
          href="/"
          aria-label="Multimail home"
          className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4"
        >
          <Logo paperColor={isWorkspace ? "#fbfcfe" : "#fbf6ea"} />
          <span className="font-serif text-[1rem] font-medium leading-none tracking-[-0.02em]">
            Multimail
          </span>
        </Link>

        <Link
          href={isWorkspace ? "/" : "/app"}
          className={
            "rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80 " +
            (isWorkspace
              ? "text-[var(--app-ink)] hover:bg-[var(--app-soft)]"
              : "bg-[var(--ink)] text-[var(--paper)]")
          }
        >
          {isWorkspace ? "← Home" : "Open app"}
        </Link>
      </nav>
    </header>
  );
}
