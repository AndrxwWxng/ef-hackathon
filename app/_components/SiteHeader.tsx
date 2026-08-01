"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
        className="mx-auto flex h-11 w-full max-w-[1400px] items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          aria-label="Multimail home"
          className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4"
        >
          <span className="grid h-5 w-5 place-items-center rounded-md bg-[var(--app-ink)] text-[var(--app-paper)]">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M3 5h10M3 10h6M3 8h10" />
            </svg>
          </span>
          <span className="font-serif text-[0.95rem] font-medium tracking-[-0.02em]">
            Multimail
          </span>
        </Link>

        <Link
          href="/app"
          className={
            "rounded-full px-3 py-1 text-[12px] font-medium transition-opacity hover:opacity-80 " +
            (isWorkspace
              ? "bg-[var(--app-ink)] text-[var(--app-paper)]"
              : "bg-[var(--ink)] text-[var(--paper)]")
          }
        >
          {isWorkspace ? "Workspace" : "Open app"}
        </Link>
      </nav>
    </header>
  );
}
