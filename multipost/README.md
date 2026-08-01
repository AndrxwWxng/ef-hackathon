# multipost

Publish one piece of content to **X**, **LinkedIn**, and **email** in a single call.

Small internal utility. Not a product. Optimized for "working in under two hours," not extensibility. Three concrete functions, one CLI orchestrator.

---

## Hard constraints (what the spec required)

- **Node 20+**, ESM, native `fetch`. Load env via `node --env-file=.env`.
- **Exactly one runtime dependency**: [`twitter-api-v2`](https://www.npmjs.com/package/twitter-api-v2). No HTTP client, logger, config library, or test framework.
- No TypeScript, no build step, no framework.
- **All field/header names verified against current docs** (Aug 2026): X `POST /2/tweets`, LinkedIn `POST /rest/posts` with `Linkedin-Version: 202607`, Resend `POST /emails`.
- `--dry-run` is the **default**. `--live` is required to actually send.

---

## Setup, in dependency order

The channels are independent, so you can pick them up in any order. But if
you're starting from zero, the cheapest path is **Resend → X → LinkedIn**
because LinkedIn needs a browser round-trip and X needs a portal toggle.

### 0. Install

```bash
cd multipost
npm install
cp .env.example .env
```

You now have a `.env` with empty values. Fill them as you go.

### 1. Resend (email — no redirect flow)

1. Get an API key at <https://resend.com/api-keys>.
2. Make sure your sending **domain is verified** in Resend (this is a one-time dashboard step).
3. Put in `.env`:

   ```
   RESEND_API_KEY=re_...
   RESEND_FROM="Your Name <hello@yourdomain.com>"
   RESEND_TO=you@example.com
   ```

4. Test it:

   ```bash
   node --env-file=.env src/publish.js --live --only email --file post.md
   ```

   The first run is the canary — if email works, half the integration is done.

### 2. X (Twitter)

> **⚠️ Billing: X is pay-per-use as of Feb 2026. There is no free tier.**
> Standard post ≈ **$0.015**. Any post containing a URL jumps to **~$0.20**
> (URL detection is roughly 13× more expensive). A rejected post is still
> billed, so the dry-run guard is real money.

1. Go to <https://developer.x.com> and create a project + app.
2. **Before** you generate any tokens, open the app's **User authentication
   settings** and set the App permissions to **"Read and write"**.
3. Then in **Keys and tokens**, generate:
   - API Key + Secret (the *consumer* pair)
   - Access Token + Secret (the *user* pair — pinned to your account, since
     this module is single-account)
4. Put them in `.env`:

   ```
   X_APP_KEY=...
   X_APP_SECRET=...
   X_ACCESS_TOKEN=...
   X_ACCESS_TOKEN_SECRET=...
   ```

**Gotcha.** If you ever flipped an existing token from read-only to write
later, **the token itself stays read-only** and must be regenerated.
Permissions are baked into the token at mint time, not at the app level.

### 3. LinkedIn

1. Create an app at <https://www.linkedin.com/developers/apps>.
2. On the **Products** tab, add **"Share on LinkedIn"** — this grants the
   `w_member_social` permission. Also add **"Sign In with LinkedIn using
   OpenID Connect"** for `openid profile email` (we use `openid profile`).
3. On the **Auth** tab, add a redirect URL pointing to
   `http://localhost:3000/callback` (or whatever you set
   `LINKEDIN_REDIRECT_PORT` to).
4. Put your **Client ID** and **Client Secret** in `.env`:

   ```
   LINKEDIN_CLIENT_ID=...
   LINKEDIN_CLIENT_SECRET=...
   ```

5. Run the one-time OAuth flow:

   ```bash
   node --env-file=.env scripts/linkedin-auth.js
   ```

   It prints an authorize URL. Open it, click Allow, and the script prints:

   ```
   LINKEDIN_ACCESS_TOKEN=...
   LINKEDIN_PERSON_URN=urn:li:person:abc123
   ```

   Paste both into `.env`. The script does **not** write to `.env`
   automatically — you do.

**Gotchas.**

- **Tokens last ~60 days** (`expires_in: 5184000` in the token response).
- **No refresh tokens for unapproved apps.** When the token expires, you
  re-run `scripts/linkedin-auth.js`. It's a recurring manual chore.
- If the API ever returns **HTTP 426**, the `Linkedin-Version` is stale.
  Bump the `LINKEDIN_VERSION` constant in `src/linkedin.js`.
- **Personal profile only.** Posting to a Company Page requires the
  Community Management API, which is approval-gated and out of scope for
  this tool. If you need that, stop and re-scope — don't work around it.

### 4. Sanity check (no real posts)

```bash
node --env-file=.env src/publish.js --file post.md
```

You should see, for each selected channel, exactly what would be sent
— including the final escaped LinkedIn payload (backslashes in the
`commentary` field). No network calls.

### 5. First live run

Pick the cheapest channel first:

```bash
node --env-file=.env src/publish.js --file post.md --live --only email
```

Then drop `--only` to fan out to all three.

---

## CLI reference

```
node --env-file=.env src/publish.js --file <path> [options]

  --file <path>     Source markdown file (required).
  --only <list>     Comma-separated: x,linkedin,email.
  --live            Actually send. Default is dry-run.
  --dry, --dry-run  Force dry-run.
  --help, -h        Help text.
```

Exit codes:
- `0` — all selected channels published successfully (or dry-run printed).
- `1` — at least one channel failed.
- `2` — bad arguments (missing `--file`, bad `--only`, etc.).

### Input file format

```markdown
---
subject: Weekly devlog #4
---

Body text shared by all channels. Same source for X, LinkedIn, and email.

Blank lines are preserved. The subject line only affects email; X and
LinkedIn ignore it.
```

Frontmatter rules:
- Opens and closes with `---` on lines by themselves.
- Only the key `subject:` is recognized today; everything else is ignored.
- If there is no frontmatter, the whole file is the body and email uses
  `"(no subject)"`.

---

## Failure modes

Each channel's error is typed so the orchestrator can label it:

| Class                | X              | LinkedIn                | Resend |
|----------------------|----------------|-------------------------|--------|
| `*AuthError`         | 401, 403       | 401, 403                | 401, 403 |
| `*PayloadError`      | 400, 422       | 400, 422                | 400, 422 |
| `*NetworkError`      | fetch/TCP fail | fetch/TCP fail          | fetch/TCP fail |
| `XLengthError`       | > 280 chars    | —                       | — |
| `LinkedInVersionError`| —             | 426 (stale Linkedin-Version) | — |

The result table prints the kind (auth / payload / network / unknown)
alongside each channel so you can tell at a glance *what* broke.

---

## Threads (X)

`src/x.js` accepts an optional `replyToId` argument:

```js
import { postToX } from './src/x.js';
const first  = await postToX('Part 1 of my thread.');
const second = await postToX('Part 2.', { replyToId: first.id });
```

The publish CLI does not (yet) split a single body into a thread — that
needs either per-line frontmatter or a dedicated command. Single-post
publishing is the supported path through the CLI.

---

## Deliberately not in scope

- **No retry.** A retry of an X call is another billable request and a
  possible duplicate post.
- **No queue / scheduler / database / web UI.**
- **No rate limiting.** Volume here is a handful of posts.
- **No plugin abstraction.** Three concrete functions is the right amount
  of structure. Adding a fourth channel is a small, focused PR — not a
  refactor.

---

## File map

```
multipost/
├── package.json          # ESM, node>=20, one dep: twitter-api-v2
├── .env.example          # every var documented inline
├── README.md             # this file
├── scripts/
│   └── linkedin-auth.js  # one-time OAuth, prints token + URN
└── src/
    ├── x.js              # postToX(text, {replyToId}) → {id, url}
    ├── linkedin.js       # postToLinkedIn(text) → {id, url}, escapeLittleText()
    ├── email.js          # sendEmail({subject, html, to}) → {id}
    └── publish.js        # CLI: --file, --live, --only → fan-out + table