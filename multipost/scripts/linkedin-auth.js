#!/usr/bin/env node
// scripts/linkedin-auth.js — one-time OAuth, prints values to paste into .env.
//
// Verified against learn.microsoft.com / Aug 2026:
//   Step 1: Build authorize URL
//     GET https://www.linkedin.com/oauth/v2/authorization
//       ?response_type=code
//       &client_id=<your_client_id>
//       &redirect_uri=<your_callback_url>          # must match one of the
//                                                #  URLs on your LinkedIn app
//       &state=<random>                            # CSRF token
//       &scope=openid profile w_member_social
//
//   Step 2: User authorizes, LinkedIn redirects to redirect_uri with
//     ?code=...&state=...
//
//   Step 3: Exchange the code for an access token
//     POST https://www.linkedin.com/oauth/v2/accessToken
//     Content-Type: application/x-www-form-urlencoded
//       grant_type=authorization_code
//       code=<...>
//       client_id=<...>
//       client_secret=<...>
//       redirect_uri=<...>
//
//   Step 4: GET https://api.linkedin.com/v2/userinfo   →  { sub: "<id>" }
//     Build the author URN as  urn:li:person:<sub>
//
// This script does NOT write to .env. It prints the two values and lets
// the operator paste them. (Per spec: "Do not write to .env programmatically.")

import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL } from 'node:url';

const {
  LINKEDIN_CLIENT_ID,
  LINKEDIN_CLIENT_SECRET,
  LINKEDIN_REDIRECT_PORT = '3000',
  // Override only if you've changed LinkedIn's host; defaults below.
  LINKEDIN_OAUTH_HOST = 'https://www.linkedin.com',
  LINKEDIN_API_HOST  = 'https://api.linkedin.com',
} = process.env;

const required = ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  console.error(`Add LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET to .env, then re-run.`);
  console.error(`(Get them from https://www.linkedin.com/developers/apps → your app → Auth.)`);
  process.exit(2);
}

const REDIRECT_URI = `http://localhost:${LINKEDIN_REDIRECT_PORT}/callback`;
const SCOPES = ['openid', 'profile', 'w_member_social'].join(' ');

const state = randomBytes(16).toString('hex');

const authorizeUrl = new URL('/oauth/v2/authorization', LINKEDIN_OAUTH_HOST);
authorizeUrl.searchParams.set('response_type', 'code');
authorizeUrl.searchParams.set('client_id', LINKEDIN_CLIENT_ID);
authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authorizeUrl.searchParams.set('state', state);
authorizeUrl.searchParams.set('scope', SCOPES);

console.log('LinkedIn OAuth — one-time setup.\n');
console.log('1) Open this URL in a browser, sign in, and click Allow:\n');
console.log(`   ${authorizeUrl.toString()}\n`);
console.log(`   (Redirect URI: ${REDIRECT_URI} — must be registered on your app.)\n`);

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, REDIRECT_URI);

  if (reqUrl.pathname !== '/callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = reqUrl.searchParams.get('code');
  const error = reqUrl.searchParams.get('error');
  const returnedState = reqUrl.searchParams.get('state');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end(`LinkedIn returned error: ${error}\n${reqUrl.searchParams.get('error_description') || ''}`);
    server.close();
    finish(1);
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('No ?code= in callback URL.');
    server.close();
    finish(1);
    return;
  }

  if (returnedState !== state) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('State mismatch — refusing to exchange (possible CSRF).');
    server.close();
    finish(1);
    return;
  }

  try {
    // Step 3: exchange code for access token
    const tokenRes = await fetch(new URL('/oauth/v2/accessToken', LINKEDIN_OAUTH_HOST), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: LINKEDIN_CLIENT_ID,
        client_secret: LINKEDIN_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokenText = await tokenRes.text();
    let tokenJson;
    try { tokenJson = JSON.parse(tokenText); } catch { tokenJson = { raw: tokenText }; }

    if (!tokenRes.ok || !tokenJson.access_token) {
      const msg = tokenJson.error_description || tokenJson.error || tokenText;
      throw new Error(`Token exchange failed: HTTP ${tokenRes.status} — ${msg}`);
    }

    const accessToken = tokenJson.access_token;

    // Step 4: fetch identity
    const meRes = await fetch(new URL('/v2/userinfo', LINKEDIN_API_HOST), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const meText = await meRes.text();
    let meJson;
    try { meJson = JSON.parse(meText); } catch { meJson = { raw: meText }; }

    if (!meRes.ok || !meJson.sub) {
      throw new Error(`userinfo failed: HTTP ${meRes.status} — ${meText}`);
    }

    const personUrn = `urn:li:person:${meJson.sub}`;
    const expiresInDays = Math.round((tokenJson.expires_in || 0) / 86400);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK — see terminal output.\n');

    console.log('\n2) Paste these into multipost/.env:\n');
    console.log(`   LINKEDIN_ACCESS_TOKEN=${accessToken}`);
    console.log(`   LINKEDIN_PERSON_URN=${personUrn}`);
    console.log('');
    console.log(`(Token expires in ~${expiresInDays} days. LinkedIn does NOT issue refresh`);
    console.log(` tokens to unapproved apps, so re-run this script when it does.)\n`);

    server.close();
    finish(0);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error: ${err.message}`);
    console.error('\n' + err.message);
    server.close();
    finish(1);
  }
});

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  // Give the response a tick to flush before exiting.
  setTimeout(() => process.exit(code), 50);
}

server.listen(Number(LINKEDIN_REDIRECT_PORT), '127.0.0.1', () => {
  console.log(`2) Waiting for LinkedIn to redirect back to ${REDIRECT_URI} ...\n`);
});