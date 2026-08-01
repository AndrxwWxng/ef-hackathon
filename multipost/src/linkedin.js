// src/linkedin.js — Post to LinkedIn via the versioned REST Posts endpoint.
//
// Verified against learn.microsoft.com / Aug 2026:
//   endpoint : POST https://api.linkedin.com/rest/posts
//   headers  : Authorization: Bearer <token>
//              X-Restli-Protocol-Version: 2.0.0
//              Linkedin-Version: <YYYYMM>   ← stale => 426
//   body     : { author, commentary, visibility, distribution }
//   response : 201 Created, with x-restli-id: "urn:li:ugcPost:<id>" or
//              "urn:li:share:<id>"
//
// Little Text Format (verified from little-text-format doc page):
//   Reserved characters that must be backslash-escaped (order matters —
//   backslash first, otherwise the escapes you add on later become
//   double-escaped themselves):
//       \ | { } @ [ ] ( ) < > # * _ ~
//   Plus the backslash character itself.
//   Mention : @[Display Name](urn:li:person:<id>)
//   Hashtag : {hashtag|\#|<value>}    ← the # is escaped inside the template.
//
// Current LinkedIn-Version: 202507 was sunset. The current valid version
// (from the canonical "little Text Format" page) is 202607. Update
// LINKEDIN_VERSION below if you start seeing 426.

export const LINKEDIN_VERSION = '202607';
export const LINKEDIN_RESTLI_VERSION = '2.0.0';

const LINKEDIN_POSTS_URL = 'https://api.linkedin.com/rest/posts';

export class LinkedInAuthError extends Error {
  constructor(message) { super(message); this.name = 'LinkedInAuthError'; }
}
export class LinkedInPayloadError extends Error {
  constructor(message) { super(message); this.name = 'LinkedInPayloadError'; }
}
export class LinkedInVersionError extends Error {
  constructor(message) { super(message); this.name = 'LinkedInVersionError'; }
}
export class LinkedInNetworkError extends Error {
  constructor(message) { super(message); this.name = 'LinkedInNetworkError'; }
}

// Backslash-escape LinkedIn's reserved character set.
// Order: backslash FIRST so we don't re-escape escapes.
const LITTLE_TEXT_ESCAPES = [
  /\\/g, /\|/g, /\{/g, /\}/g, /@/g, /\[/g, /\]/g,
  /\(/g, /\)/g, /</g, />/g, /#/g, /\*/g, /_/g, /~/g,
];

export function escapeLittleText(text) {
  let out = text;
  for (const pattern of LITTLE_TEXT_ESCAPES) out = out.replace(pattern, '\\$&');
  return out;
}

// URL-encode the URN the way LinkedIn expects in the public post URL.
// e.g. "urn:li:ugcPost:12345" → "urn%3Ali%3AugcPost%3A12345"
function encodeUrnForUrl(urn) {
  return encodeURIComponent(urn);
}

export async function postToLinkedIn(text, opts = {}) {
  const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
  const personUrn = process.env.LINKEDIN_PERSON_URN;
  if (!accessToken) throw new LinkedInAuthError('Missing env: LINKEDIN_ACCESS_TOKEN');
  if (!personUrn) throw new LinkedInAuthError('Missing env: LINKEDIN_PERSON_URN');
  if (!personUrn.startsWith('urn:li:person:')) {
    throw new LinkedInAuthError(
      `LINKEDIN_PERSON_URN looks wrong: "${personUrn}" (expected urn:li:person:<id>)`
    );
  }

  const body = {
    author: personUrn,
    commentary: escapeLittleText(text),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      thirdPartyDistributionChannels: [],
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  };

  let res;
  try {
    res = await fetch(LINKEDIN_POSTS_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Linkedin-Version': LINKEDIN_VERSION,
        'X-Restli-Protocol-Version': LINKEDIN_RESTLI_VERSION,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LinkedInNetworkError(err?.message || String(err));
  }

  if (res.status === 201) {
    const urn = res.headers.get('x-restli-id');
    if (!urn) throw new LinkedInPayloadError('201 returned no x-restli-id header');
    return { id: urn, url: `https://www.linkedin.com/feed/update/${encodeUrnForUrl(urn)}/` };
  }

  let detail = '';
  try {
    const j = await res.json();
    detail = j?.message || j?.error || JSON.stringify(j);
  } catch {
    detail = (await res.text().catch(() => '')) || '';
  }

  if (res.status === 426) {
    throw new LinkedInVersionError(
      `LinkedIn rejected Linkedin-Version=${LINKEDIN_VERSION}. ` +
      `Update LINKEDIN_VERSION in src/linkedin.js. ${detail}`
    );
  }
  if (res.status === 401 || res.status === 403) throw new LinkedInAuthError(`HTTP ${res.status}: ${detail}`);
  if (res.status === 400 || res.status === 422) throw new LinkedInPayloadError(`HTTP ${res.status}: ${detail}`);
  throw new LinkedInPayloadError(`HTTP ${res.status}: ${detail}`);
}

// Plain-object shape, useful for dry-run prints.
// Shows the actual JSON that would be sent, including the escaped commentary.
export function describeLinkedIn(text) {
  const personUrn = process.env.LINKEDIN_PERSON_URN || 'urn:li:person:';
  return {
    endpoint: LINKEDIN_POSTS_URL,
    headers: {
      'Authorization': 'Bearer <LINKEDIN_ACCESS_TOKEN>',
      'Linkedin-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': LINKEDIN_RESTLI_VERSION,
      'Content-Type': 'application/json',
    },
    body: {
      author: personUrn,
      commentary: escapeLittleText(text),
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        thirdPartyDistributionChannels: [],
        lifecycleState: 'PUBLISHED',
        isReshareDisabledByAuthor: false,
      },
    },
  };
}