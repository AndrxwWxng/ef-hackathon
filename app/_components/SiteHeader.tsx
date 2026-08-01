"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function SiteHeader() {
  const pathname = usePathname();
  const isWorkspace = pathname.startsWith("/app");

  return (
    <header
      className={`sticky top-0 z-50 w-full border-b backdrop-blur-md ${
        isWorkspace
          ? "border-[#d8dde6]/80 bg-[#eef0f4]/90 text-[#0f172a] dark:border-[#232834] dark:bg-[#0b0d12]/90 dark:text-[#eef0f4]"
          : "border-[var(--border)]/60 bg-[var(--background)]/90 text-[var(--foreground)]"
      }`}
    >
      <nav
        aria-label="Primary navigation"
        className="mx-auto flex h-14 w-full max-w-[1480px] items-center justify-between px-4 sm:px-6"
      >
        <Link
          href="/"
          aria-label="Multimail home"
          className="flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4"
        >
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M3 5h14M3 10h10M3 15h14" />
          </svg>
          <span className="font-serif text-lg font-medium tracking-[-0.025em]">
            Multimail
          </span>
        </Link>

        <div className="flex items-center gap-4 sm:gap-6">
          {isWorkspace && (
            <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-[#5b6478] sm:block dark:text-[#8a93a6]">
              Workspace
            </span>
          )}
          <Link
            href={isWorkspace ? "/" : "/app"}
            className={`rounded-sm text-sm font-medium outline-none transition-opacity hover:opacity-60 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-4 ${
              isWorkspace
                ? "text-[#0f172a] dark:text-[#eef0f4]"
                : "text-[var(--foreground)]"
            }`}
          >
            {isWorkspace ? "Home" : "Open app"}
          </Link>
        </div>
      </nav>
    </header>
  );
}
