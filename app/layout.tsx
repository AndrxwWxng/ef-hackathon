import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Multimail: Weekly partner updates from your dev work",
  description:
    "Turn a week of commits, PRs, voice notes, and freeform updates into a newsletter, LinkedIn post, and X post in under five minutes.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="w-full border-b border-[var(--border)]">
          <nav className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-mono text-sm tracking-tight">
              Multimail
            </Link>
            <div className="flex items-center gap-6 text-sm">
              <Link
                href="/app"
                className="text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
              >
                Open app
              </Link>
              <a
                href="#waitlist"
                className="rounded-full bg-[var(--foreground)] px-4 py-2 text-[var(--background)] transition-opacity hover:opacity-80"
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