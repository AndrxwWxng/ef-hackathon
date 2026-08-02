#!/usr/bin/env node
// src/publish.js — CLI entry: fan-out one source text to {x, linkedin, email}.
//
// Usage:
//   node --env-file=.env src/publish.js --file post.md            # DRY RUN (default)
//   node --env-file=.env src/publish.js --live --file post.md     # actually post
//   node --env-file=.env src/publish.js --file post.md --only x,email
//
// --dry-run is the default. --live is required to actually send.
//
// Input file format:
//
//   ---
//   subject: My newsletter title          (optional; only used for email)
//   ---
//   Body text shared by all channels.
//
// Frontmatter is the `---` block at the top. Only `subject:` is recognized;
// any other key becomes part of the body (so this is not YAML — it's a
// "just one key for now" convention).

import { readFile } from 'node:fs/promises';
import { postToX, describeX, XLengthError, XAuthError, XPayloadError, XNetworkError } from './x.js';
import {
  postToLinkedIn, describeLinkedIn,
  LinkedInAuthError, LinkedInPayloadError, LinkedInVersionError, LinkedInNetworkError,
} from './linkedin.js';
import {
  sendEmail, describeEmail,
  EmailAuthError, EmailPayloadError, EmailNetworkError,
} from './email.js';

function parseArgs(argv) {
  const args = { live: false, file: null, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--dry-run' || a === '--dry') args.live = false;
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--only') args.only = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`multipost — fan out one source text to X, LinkedIn, and email

  --file <path>          Source markdown file (required)
  --only <list>          Comma-separated channel list: x,linkedin,email
  --live                 Actually post (default: dry-run, no network calls)
  --dry, --dry-run       Force dry-run (default behaviour anyway)
  --help, -h             This message

Examples:
  node --env-file=.env src/publish.js --file post.md
  node --env-file=.env src/publish.js --file post.md --live --only email
`);
}

// Parse minimal frontmatter. Recognized keys live in `fm`; anything else
// is dropped on the floor (so "subject: foo" is the only thing that
// becomes a real override; the rest of the frontmatter body is ignored).
function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { fm: {}, body: raw };
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      const fmLines = lines.slice(1, i);
      const fm = {};
      for (const ln of fmLines) {
        const m = ln.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
        if (m) fm[m[1].toLowerCase()] = m[2];
      }
      return { fm, body: lines.slice(i + 1).join('\n').trim() };
    }
  }
  // unmatched frontmatter — treat the whole file as body
  return { fm: {}, body: raw };
}

async function readPost(path) {
  const raw = await readFile(path, 'utf8');
  const { fm, body } = parseFrontmatter(raw);
  return { subject: fm.subject || '', body };
}

// Build a small wrapper that produces a { name, describe, send } shape
// for each channel so the orchestrator can loop over them uniformly.
const CHANNELS = {
  x: {
    name: 'x',
    describe: ({ body }) => describeX(body),
    send: ({ body }) => postToX(body),
    classifyError: (err) => {
      if (err instanceof XLengthError) return 'payload';
      if (err instanceof XAuthError) return 'auth';
      if (err instanceof XPayloadError) return 'payload';
      if (err instanceof XNetworkError) return 'network';
      return 'unknown';
    },
  },
  linkedin: {
    name: 'linkedin',
    describe: ({ body }) => describeLinkedIn(body),
    send: ({ body }) => postToLinkedIn(body),
    classifyError: (err) => {
      if (err instanceof LinkedInVersionError) return 'payload';
      if (err instanceof LinkedInAuthError) return 'auth';
      if (err instanceof LinkedInPayloadError) return 'payload';
      if (err instanceof LinkedInNetworkError) return 'network';
      return 'unknown';
    },
  },
  email: {
    name: 'email',
    describe: ({ post, body }) => describeEmail({
      subject: post.subject || '(no subject)',
      html: `<pre>${escapeHtml(body)}</pre>`,
    }),
    send: ({ post, body }) => sendEmail({
      subject: post.subject || '(no subject)',
      html: `<pre>${escapeHtml(body)}</pre>`,
    }),
    classifyError: (err) => {
      if (err instanceof EmailAuthError) return 'auth';
      if (err instanceof EmailPayloadError) return 'payload';
      if (err instanceof EmailNetworkError) return 'network';
      return 'unknown';
    },
  },
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;');
}

// Pretty-print a dry-run description. Shows the final, escaped LinkedIn
// payload so the user can sanity-check the backslash escapes.
function printDescribe(channel, desc) {
  const name = channel.name.toUpperCase();
  console.log(`\n── ${name} ──`);
  console.log(JSON.stringify(desc, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    usage();
    process.exit(args.help ? 0 : 2);
  }

  let post;
  try {
    post = await readPost(args.file);
  } catch (err) {
    console.error(`Failed to read --file ${args.file}: ${err.message}`);
    process.exit(2);
  }

  const allowed = ['x', 'linkedin', 'email'];
  const selected = args.only
    ? args.only.split(',').map((s) => s.trim().toLowerCase()).filter((s) => allowed.includes(s))
    : allowed;
  if (selected.length === 0) {
    console.error(`--only matched no channels. Use a comma-list of: ${allowed.join(', ')}`);
    process.exit(2);
  }

  console.log(`\nmultipost — ${args.live ? 'LIVE' : 'DRY RUN'}`);
  console.log(`file:    ${args.file}`);
  console.log(`subject: ${post.subject || '(none — email will use "(no subject)")'}`);
  console.log(`body:    ${post.body.length} chars`);
  console.log(`channels: ${selected.join(', ')}`);

  // DRY-RUN: print everything that would be sent, then exit 0.
  if (!args.live) {
    for (const key of selected) {
      printDescribe(CHANNELS[key], CHANNELS[key].describe({ post, body: post.body }));
    }
    console.log('\n(dry run — nothing was sent. Pass --live to actually publish.)\n');
    return;
  }

  // LIVE: fan out with Promise.allSettled so one channel's failure doesn't
  // stop the others. Per the spec, exit non-zero if any channel failed.
  const tasks = selected.map(async (key) => {
    const channel = CHANNELS[key];
    try {
      const result = await channel.send({ post, body: post.body });
      return { channel: key, ok: true, result, kind: null };
    } catch (err) {
      return { channel: key, ok: false, error: err, kind: channel.classifyError(err) };
    }
  });
  const settled = await Promise.allSettled(tasks);
  const rows = settled.map((s, i) => s.status === 'fulfilled' ? s.value : { channel: selected[i], ok: false, error: s.reason, kind: CHANNELS[selected[i]].classifyError(s.reason) });

  console.log('\n── results ──');
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('channel', 10)} ${pad('status', 12)} ${pad('kind', 10)} id / url / error`);
  for (const r of rows) {
    if (r.ok) {
      const url = r.result.url ? `\n           url: ${r.result.url}` : '';
      console.log(`${pad(r.channel, 10)} ${pad('sent', 12)} ${pad('', 10)} id: ${r.result.id}${url}`);
    } else {
      console.log(`${pad(r.channel, 10)} ${pad('FAILED', 12)} ${pad(r.kind, 10)} ${r.error?.name || ''}: ${r.error?.message || r.error}`);
    }
  }

  const anyFailed = rows.some((r) => !r.ok);
  if (anyFailed) {
    console.error('\nOne or more channels failed.');
    process.exitCode = 1;
  } else {
    console.log('\nAll channels published.');
  }
}

main().catch((err) => {
  console.error(`\nUnexpected error: ${err?.stack || err}`);
  process.exit(1);
});