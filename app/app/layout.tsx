import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Workspace · Multimail",
  description:
    "Review your sources, run the week, and ship the three drafts your partners will read.",
};

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="app-scope h-full overflow-hidden bg-[var(--app-bg)] text-[var(--app-ink)]">
      {children}
    </div>
  );
}
