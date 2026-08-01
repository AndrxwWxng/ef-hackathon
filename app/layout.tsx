import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT", "WONK"],
});

export const metadata: Metadata = {
  title: "Multimail — Turn a week's dev work into a sponsor-ready update.",
  description:
    "Multimail compiles commits, PRs, voice notes, and freeform updates into a newsletter, LinkedIn post, and X post — matched, sourced, draft-quality in under five minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fraunces.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]">
        <header className="w-full border-b border-[var(--border)]/60">
          <nav className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
            <Link href="/" className="flex items-center gap-2">
              <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-[var(--accent)] text-[var(--paper)]">
                <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 4h12M2 8h8M2 12h12" />
                </svg>
              </span>
              <span className="font-serif text-[1.15rem] font-medium leading-none tracking-[-0.01em]">
                Multimail
              </span>
            </Link>
            <div className="flex items-center gap-2 text-sm sm:gap-6">
              <Link
                href="/app"
                className="hidden text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)] sm:inline"
              >
                Open app
              </Link>
              <a
                href="#waitlist"
                className="rounded-full bg-[var(--ink)] px-4 py-2 text-[var(--paper)] transition-transform hover:-translate-y-px"
              >
                Join waitlist
              </a>
            </div>
          </nav>
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}
