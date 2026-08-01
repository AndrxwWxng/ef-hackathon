import Link from "next/link";

export default function Landing() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-6 py-20 sm:py-28">
      <section className="flex flex-col gap-8">
        <p className="font-mono text-xs uppercase tracking-widest text-[var(--muted-foreground)]">
          Weekly partner updates, on autopilot
        </p>
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
          Turn a week of dev work into a sponsor-ready update in five minutes.
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-[var(--muted-foreground)]">
          Multimail pulls your commits, PRs, voice notes, and freeform updates from
          the week, then writes a matched set of drafts: a newsletter, a
          LinkedIn post, and an X post. Same week, three depths, one story.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="#waitlist"
            className="inline-flex h-11 items-center justify-center rounded-full bg-[var(--foreground)] px-6 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-80"
          >
            Join the waitlist
          </a>
          <Link
            href="/app"
            className="inline-flex h-11 items-center justify-center rounded-full border border-[var(--border)] px-6 text-sm font-medium transition-colors hover:bg-[var(--muted)]"
          >
            Preview the app
          </Link>
        </div>
      </section>

      <section className="mt-24 grid gap-10 border-t border-[var(--border)] pt-12 sm:grid-cols-3">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Source-first</h3>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            GitHub commits and PRs are the source of truth. Pasted notes and
            audio add context. Outputs are derived, never invented.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Three matched formats</h3>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            One run produces a newsletter, a LinkedIn post, and an X post. Each
            reads at the depth its channel expects.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Draft, don&apos;t blast</h3>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            Every output is a draft your team reviews and edits. The system
            aims to be right ~80% and easy to fix the rest.
          </p>
        </div>
      </section>

      <section
        id="waitlist"
        className="mt-24 flex flex-col gap-6 border-t border-[var(--border)] pt-12"
      >
        <h2 className="text-2xl font-semibold tracking-tight">Join the waitlist</h2>
        <p className="max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)]">
          We&apos;re opening access to small dev teams first. Drop your email
          and we&apos;ll send an invite when there&apos;s room.
        </p>
        <form
          className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
          action="#"
          method="post"
        >
          <label htmlFor="waitlist-email" className="sr-only">
            Email
          </label>
          <input
            id="waitlist-email"
            name="email"
            type="email"
            required
            placeholder="you@team.com"
            className="h-11 flex-1 rounded-full border border-[var(--border)] bg-transparent px-4 text-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--foreground)]"
          />
          <button
            type="submit"
            className="h-11 rounded-full bg-[var(--foreground)] px-6 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-80"
          >
            Join waitlist
          </button>
        </form>
        <p className="text-xs text-[var(--muted-foreground)]">
          No spam. Just an invite when access opens.
        </p>
      </section>
    </main>
  );
}