// src/x.js — Post a single tweet (or a reply in a thread) to X.
//
// Uses the official twitter-api-v2 library, which handles OAuth 1.0a
// signing for the POST /2/tweets endpoint. Verified field names:
//   request  : { text, reply: { in_reply_to_tweet_id } }
//   response : { data: { id, text } }
//
// Pricing note (verified against docs.x.com Aug 2026):
//   standard post ........ ~$0.015
//   post containing a URL  ~$0.20  (link posts cost ~13x more)
//   No free tier — X moved to pay-per-use in Feb 2026.

import { TwitterApi } from 'twitter-api-v2';

// Surfaced on any 280+ attempt. Client-side guard because a rejected
// POST is still a billable request.
export class XLengthError extends Error {
  constructor(len) {
    super(`X post is ${len} chars; limit is 280.`);
    this.name = 'XLengthError';
    this.length = len;
  }
}

export class XAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XAuthError';
  }
}

export class XPayloadError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XPayloadError';
  }
}

export class XNetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'XNetworkError';
  }
}

// Returns true if the post contains anything that looks like a URL.
// Used for the billing warning; a URL-bearing post costs ~13x more.
const hasUrl = (text) => /https?:\/\//i.test(text);

// 280 chars in X's "weighted" count is roughly [...text].length for
// the common case. Good enough to catch obvious over-length drafts
// before they hit the wire.
const visibleLength = (text) => [...text].length;

function classifyTwitterError(err) {
  // twitter-api-v2 wraps API errors with `.code`, `.data`, and `.errors`.
  const code = err?.code ?? err?.statusCode ?? 0;
  const msg = err?.message ?? String(err);
  if (code === 401 || code === 403) return new XAuthError(msg);
  if (code === 400 || code === 422) return new XPayloadError(msg);
  if (code === 0 || err?.cause?.code === 'ECONNRESET' || err?.cause?.code === 'ENOTFOUND') {
    return new XNetworkError(msg);
  }
  // Unknown — keep as a generic payload-shaped error so callers can still see the message.
  return new XPayloadError(msg);
}

export async function postToX(text, opts = {}) {
  const { replyToId } = opts;

  const len = visibleLength(text);
  if (len > 280) throw new XLengthError(len);

  // One-time billing warning per process when a URL is present.
  if (hasUrl(text)) {
    console.warn(
      '⚠️  X: post contains a URL — ~$0.20 per post instead of ~$0.015.'
    );
  }

  const { X_APP_KEY, X_APP_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = process.env;
  const missing = ['X_APP_KEY', 'X_APP_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET']
    .filter((k) => !process.env[k]);
  if (missing.length) {
    throw new XAuthError(`Missing env: ${missing.join(', ')}`);
  }

  const client = new TwitterApi({
    appKey: X_APP_KEY,
    appSecret: X_APP_SECRET,
    accessToken: X_ACCESS_TOKEN,
    accessSecret: X_ACCESS_TOKEN_SECRET,
  });

  const payload = replyToId
    ? { text, reply: { in_reply_to_tweet_id: replyToId } }
    : { text };

  try {
    const res = await client.v2.tweet(payload);
    const id = res?.data?.id;
    if (!id) throw new XPayloadError('X returned no tweet id');
    return { id, url: `https://x.com/i/status/${id}` };
  } catch (err) {
    if (err instanceof XAuthError || err instanceof XPayloadError) throw err;
    throw classifyTwitterError(err);
  }
}

// Plain-object shape, useful for dry-run prints.
export function describeX(text, opts = {}) {
  const { replyToId } = opts;
  const payload = replyToId
    ? { text, reply: { in_reply_to_tweet_id: replyToId } }
    : { text };
  return {
    endpoint: 'POST https://api.x.com/2/tweets  (via twitter-api-v2 client.v2.tweet)',
    auth: 'OAuth 1.0a',
    body: payload,
    length: visibleLength(text),
    containsUrl: hasUrl(text),
  };
}