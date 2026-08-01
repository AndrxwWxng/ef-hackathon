// src/email.js — Send a single email via Resend.
//
// Verified against resend.com/docs/api-reference/emails/send-email:
//   endpoint : POST https://api.resend.com/emails
//   auth     : Authorization: Bearer <RESEND_API_KEY>
//   body     : { from, to, subject, html, text? }
//   response : { id }
//
// Domain is already verified and warm — no warmup logic here.
// `to` may be a string or an array of strings; both shapes accepted by Resend.

const RESEND_URL = 'https://api.resend.com/emails';

export class EmailAuthError extends Error {
  constructor(message) { super(message); this.name = 'EmailAuthError'; }
}
export class EmailPayloadError extends Error {
  constructor(message) { super(message); this.name = 'EmailPayloadError'; }
}
export class EmailNetworkError extends Error {
  constructor(message) { super(message); this.name = 'EmailNetworkError'; }
}

// Strip tags + collapse whitespace — used to derive a plaintext fallback
// when the caller only supplied `html`. Good enough for clients that
// don't care; pass `text` explicitly if you want a hand-crafted version.
export function htmlToText(html) {
  return String(html)
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export async function sendEmail({ subject, html, text, to, from } = {}) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailAuthError('Missing env: RESEND_API_KEY');

  const fromAddr = from || process.env.RESEND_FROM;
  const toAddr = to || process.env.RESEND_TO;
  if (!fromAddr) throw new EmailPayloadError('Missing RESEND_FROM');
  if (!toAddr) throw new EmailPayloadError('Missing RESEND_TO');
  if (!subject) throw new EmailPayloadError('Missing subject');
  if (!html && !text) throw new EmailPayloadError('Need html or text');

  // Accept "a@b.com,c@d.com" in the env in addition to a single address.
  const toList = Array.isArray(toAddr)
    ? toAddr
    : String(toAddr).split(',').map((s) => s.trim()).filter(Boolean);

  const body = {
    from: fromAddr,
    to: toList,
    subject,
    html: html ?? '',
    text: text ?? htmlToText(html ?? ''),
  };

  let res;
  try {
    res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new EmailNetworkError(err?.message || String(err));
  }

  const text0 = await res.text();
  let data;
  try { data = text0 ? JSON.parse(text0) : {}; } catch { data = { raw: text0 }; }

  if (res.status === 200 || res.status === 201) {
    if (!data?.id) throw new EmailPayloadError('Resend returned no id');
    return { id: data.id };
  }

  const detail = data?.message || data?.error || text0 || '';
  if (res.status === 401 || res.status === 403) throw new EmailAuthError(`HTTP ${res.status}: ${detail}`);
  if (res.status === 422 || res.status === 400) throw new EmailPayloadError(`HTTP ${res.status}: ${detail}`);
  throw new EmailPayloadError(`HTTP ${res.status}: ${detail}`);
}

export function describeEmail({ subject, html, text, to, from } = {}) {
  const fromAddr = from || process.env.RESEND_FROM;
  const toAddr = to || process.env.RESEND_TO;
  return {
    endpoint: RESEND_URL,
    auth: 'Bearer <RESEND_API_KEY>',
    body: {
      from: fromAddr,
      to: toAddr,
      subject,
      html: html ?? '',
      text: text ?? (html ? htmlToText(html) : ''),
    },
  };
}