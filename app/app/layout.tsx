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
    <div className="app-scope min-h-full bg-[var(--app-bg)] text-[var(--app-ink)]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 [background-image:linear-gradient(to_right,var(--app-grid)_1px,transparent_1px),linear-gradient(to_bottom,var(--app-grid)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_45%,transparent_78%)]"
      />
      {children}
    </div>
  );
}
