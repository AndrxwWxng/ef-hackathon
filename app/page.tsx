import Link from "next/link";

function ArtifactMockup() {
  return (
    <div className="relative isolate overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--paper)] shadow-[0_30px_80px_-40px_rgba(15,13,8,0.35)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--border)]" />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">
          multimail · week 32 · 3 drafts
        </span>
        <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--accent-deep)]">
          ready
        </span>
      </div>

      <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">newsletter</span>
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">487 words</span>
          </div>
          <div className="font-serif text-[15px] font-medium leading-snug">
            What we shipped this week — a faster ingest path, two integration fixes, and a quieter dashboard.
          </div>
          <div className="space-y-1.5 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
            <div className="h-2 w-full rounded bg-[var(--muted)]" />
            <div className="h-2 w-[88%] rounded bg-[var(--muted)]" />
            <div className="h-2 w-[72%] rounded bg-[var(--muted)]" />
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] text-[var(--paper)]">copy</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">edit</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 bg-[var(--background)] p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">linkedin</span>
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">~1,400 chars</span>
          </div>
          <div className="font-serif text-[15px] font-medium leading-snug">
            Shipped: ingest 4× faster, two long-standing integrations stable, and an inbox-worthy digest that doesn&apos;t read like a changelog.
          </div>
          <div className="space-y-1.5 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
            <div className="h-2 w-[92%] rounded bg-[var(--border)]" />
            <div className="h-2 w-[64%] rounded bg-[var(--border)]" />
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] text-[var(--paper)]">copy</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">edit</span>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-foreground)]">x post</span>
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">267 chars</span>
          </div>
          <div className="font-serif text-[15px] font-medium leading-snug">
            Week 32: ingest 4× faster, two flaky integrations stabilized, a digest your sponsors will actually open.
          </div>
          <div className="mt-2 flex items-center gap-1">
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">#[weeknotes]</span>
            <span className="font-mono text-[10px] text-[var(--muted-foreground)]">#[changelog]</span>
          </div>
          <div className="mt-auto flex items-center gap-1.5 pt-2">
            <span className="rounded-full bg-[var(--ink)] px-2 py-0.5 text-[10px] text-[var(--paper)]">copy</span>
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--muted-foreground)]">edit</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceChip({ label, count, accent }: { label: string; count: string; accent: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--paper)] px-3 py-1.5">
      <span
        aria-hidden
        className={
          "h-1.5 w-1.5 rounded-full " + (accent ? "bg-[var(--accent)]" : "bg-[var(--muted-foreground)]")
        }
      />
      <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--foreground)]">{label}</span>
      <span className="font-mono text-[11px] text-[var(--muted-foreground)]">{count}</span>
    </div>
  );
}

export default function Landing() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6">
      <section className="grid gap-10 pb-20 pt-16 sm:pt-24 lg:grid-cols-12 lg:gap-12 lg:pb-28 lg:pt-32">
        <div className="flex flex-col gap-7 lg:col-span-7 lg:gap-8">
          <h1 className="font-serif text-[2.6rem] font-medium leading-[0.98] tracking-[-0.02em] text-[var(--ink)] sm:text-[3.4rem] lg:text-[4.1rem]">
            Turn a week of dev work into a sponsor-ready update.
          </h1>
          <p className="max-w-xl text-[1.1rem] leading-relaxed text-[var(--muted-foreground)] sm:text-[1.15rem]">
            Multimail reads the week from your repos and notes, then writes three matched drafts — a
            newsletter, a LinkedIn post, and an X post. Same week, three depths, one story your
            partners can actually read.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="#waitlist"
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--ink)] px-6 text-sm font-medium text-[var(--paper)] transition-transform hover:-translate-y-px"
            >
              Join the waitlist
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 8h10M9 4l4 4-4 4" />
              </svg>
            </a>
            <Link
              href="/app"
              className="inline-flex h-12 items-center justify-center rounded-full border border-[var(--rule)]/20 bg-[var(--paper)] px-6 text-sm font-medium text-[var(--ink)] transition-colors hover:border-[var(--ink)]"
            >
              Preview the app
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2 text-[var(--muted-foreground)]">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em]">Pulls from</span>
            <SourceChip label="GitHub" count="47 commits" accent />
            <SourceChip label="PRs" count="9 merged" accent />
            <SourceChip label="Voice notes" count="3 m" accent={false} />
            <SourceChip label="Notes" count="2" accent={false} />
          </div>
        </div>

        <div className="relative lg:col-span-5">
          <div className="absolute -left-6 -top-6 -z-10 h-32 w-32 rounded-full bg-[var(--accent)]/30 blur-2xl" />
          <div className="absolute -bottom-10 -right-6 -z-10 h-40 w-40 rounded-full bg-[var(--accent-soft)] blur-3xl" />
          <ArtifactMockup />
          <div className="mt-4 flex items-center justify-between px-1 font-mono text-[11px] text-[var(--muted-foreground)]">
            <span>~4 min 12 sec</span>
            <span>sources · 4 · drafts · 3</span>
          </div>
        </div>
      </section>

      <section className="grid gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
        <div className="flex flex-col gap-3 bg-[var(--background)] p-7">
          <div className="font-serif text-3xl font-medium text-[var(--accent-deep)]">04×</div>
          <div className="font-serif text-[1.05rem] font-medium leading-snug">
            Faster from <span className="text-[var(--muted-foreground)]">week closed</span> to ready-to-send.
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            The bar is five minutes from the last merged PR to three drafts waiting in your inbox.
          </p>
        </div>
        <div className="flex flex-col gap-3 bg-[var(--background)] p-7">
          <div className="font-serif text-3xl font-medium text-[var(--accent-deep)]">~80%</div>
          <div className="font-serif text-[1.05rem] font-medium leading-snug">
            Of every draft lands ready to send.
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            The other twenty percent gets a sentence and a save. Not a rewrite, not a vibes-check.
          </p>
        </div>
        <div className="flex flex-col gap-3 bg-[var(--background)] p-7">
          <div className="font-serif text-3xl font-medium text-[var(--accent-deep)]">03</div>
          <div className="font-serif text-[1.05rem] font-medium leading-snug">
            Matched drafts from one run.
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">
            Newsletter, LinkedIn, and X. Each reads at the depth its channel expects — from the same source.
          </p>
        </div>
      </section>

      <section className="grid gap-10 py-24 lg:grid-cols-12 lg:gap-16">
        <div className="lg:col-span-5">
          <div className="font-serif text-[1.6rem] font-medium leading-[1.05] tracking-[-0.01em] sm:text-[2rem]">
            One week of <span className="text-[var(--accent-deep)]">messy</span> source data becomes three drafts that read like your team wrote them.
          </div>
        </div>
        <div className="lg:col-span-7">
          <ol className="flex flex-col divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {[
              {
                n: "01",
                title: "Pull the week.",
                body: "Commits, merged PRs, the voice notes you dropped in Slack, the doc you pasted in. Multimail treats your repos as the source of truth and the rest as seasoning.",
              },
              {
                n: "02",
                title: "Group it the way you'd write it.",
                body: "Weekly themes surface on their own — not a flat dump of every commit. The model picks the things worth saying out loud and skips the noise.",
              },
              {
                n: "03",
                title: "Hand you three drafts.",
                body: "A newsletter for sponsors who want the picture. A LinkedIn post for partners in the feed. An X post for the engineers in your replies. Same week, matched depths.",
              },
            ].map((step) => (
              <li key={step.n} className="grid grid-cols-[3.5rem_1fr] gap-4 py-7">
                <div className="font-mono text-[13px] text-[var(--muted-foreground)]">{step.n}</div>
                <div className="flex flex-col gap-2">
                  <div className="font-serif text-[1.2rem] font-medium leading-snug">{step.title}</div>
                  <p className="max-w-prose text-[0.97rem] leading-relaxed text-[var(--muted-foreground)]">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="my-8 rounded-2xl bg-[var(--ink)] px-8 py-12 text-[var(--paper)] sm:px-12 sm:py-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7">
            <p className="font-serif text-[1.4rem] leading-snug sm:text-[1.7rem]">
              <span className="text-[var(--accent-soft)]">&ldquo;</span>The first week we ran Multimail we stopped arguing about who writes the
              Friday update. The draft was already in Slack and we just trimmed two sentences.
              <span className="text-[var(--accent-soft)]">&rdquo;</span>
            </p>
            <div className="mt-5 flex items-center gap-3">
              <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] font-mono text-xs text-[var(--paper)]">
                MK
              </span>
              <div className="text-sm">
                <div className="font-medium text-[var(--paper)]">Maya K.</div>
                <div className="text-[var(--paper)]/60">Engineering lead, 6-person team · pilot access</div>
              </div>
            </div>
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-[var(--paper)]/15 bg-[var(--paper)]/5 p-5 font-mono text-[12px] leading-relaxed text-[var(--paper)]/75 backdrop-blur-sm">
              <div className="mb-3 text-[10px] uppercase tracking-[0.18em] text-[var(--paper)]/50">
                before / after
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="mb-1 text-[var(--paper)]/50">before</div>
                  <div>90 min writing the Friday email, three Slack threads arguing tone.</div>
                </div>
                <div>
                  <div className="mb-1 text-[var(--paper)]/50">after</div>
                  <div>4 min trimming the draft. Same email, calmer tone, fewer threads.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-10 border-t border-[var(--border)] py-20 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="font-serif text-[1.6rem] font-medium leading-[1.05] tracking-[-0.01em] sm:text-[1.9rem]">
            Drafts, not blasts.
          </div>
        </div>
        <div className="lg:col-span-7">
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              {
                title: "Source-first.",
                body: "GitHub commits and PRs are the source of truth. Notes and audio add context. Nothing in the drafts is invented.",
              },
              {
                title: "Voice stays yours.",
                body: "We use your pasted samples to calibrate tone. The drafts read like your team — because they read from your team's words.",
              },
              {
                title: "Edits are first-class.",
                body: "Adjust a line, regenerate, keep going. No more 'delete and start over' when the brief changes on Wednesday.",
              },
            ].map((item) => (
              <div key={item.title} className="flex flex-col gap-2 border-t border-[var(--rule)]/30 pt-4">
                <div className="font-medium text-[var(--ink)]">{item.title}</div>
                <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section
        id="waitlist"
        className="mt-8 mb-20 grid gap-10 rounded-2xl border border-[var(--border)] bg-[var(--paper)] p-8 sm:p-12 lg:grid-cols-12 lg:gap-12"
      >
        <div className="flex flex-col gap-5 lg:col-span-7">
          <div className="font-serif text-[1.8rem] font-medium leading-[1.05] tracking-[-0.01em] sm:text-[2.2rem]">
            We&apos;re opening access to small dev teams first.
          </div>
          <p className="max-w-xl text-[1rem] leading-relaxed text-[var(--muted-foreground)]">
            Drop your work email. We&apos;ll send an invite when there&apos;s room and a short note when it&apos;s your
            turn. No drip campaigns, no &ldquo;10 tips to write better updates.&rdquo;
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5 lg:justify-center">
          <form className="flex flex-col gap-3 sm:flex-row" action="#" method="post">
            <label htmlFor="waitlist-email" className="sr-only">
              Email
            </label>
            <input
              id="waitlist-email"
              name="email"
              type="email"
              required
              placeholder="you@team.com"
              className="h-12 flex-1 rounded-full border border-[var(--border)] bg-transparent px-5 text-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--ink)]"
            />
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center rounded-full bg-[var(--accent)] px-6 text-sm font-medium text-[var(--paper)] transition-transform hover:-translate-y-px"
            >
              Request invite
            </button>
          </form>
          <p className="text-xs text-[var(--muted-foreground)]">
            ~120 teams on the list · first invites going out next sprint.
          </p>
        </div>
      </section>

      <footer className="flex flex-col items-start justify-between gap-3 border-t border-[var(--border)] py-10 text-xs text-[var(--muted-foreground)] sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <span aria-hidden className="grid h-5 w-5 place-items-center rounded bg-[var(--accent)] text-[var(--paper)]">
            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 4h12M2 8h8M2 12h12" />
            </svg>
          </span>
          <span className="font-serif text-[0.95rem] text-[var(--foreground)]">Multimail</span>
          <span className="opacity-60">·</span>
          <span>Built for small dev teams shipping in the open.</span>
        </div>
        <div className="flex items-center gap-4 font-mono uppercase tracking-[0.18em]">
          <span>v0.1 · hackathon build</span>
          <Link href="/app" className="hover:text-[var(--foreground)]">Open app →</Link>
        </div>
      </footer>
    </main>
  );
}
