import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Body = {
  text?: string;
};

const MAX_LENGTH = 280;
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const POST_URL = "https://api.x.com/2/tweets";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const refreshToken = process.env.X_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing X_CLIENT_ID / X_CLIENT_SECRET / X_REFRESH_TOKEN env vars");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: body.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as TokenResponse & {
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const message = json.error_description ?? json.error ?? `token refresh failed (${res.status})`;
    throw new Error(message);
  }

  const expiresIn = json.expires_in ?? 7200;
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };
  return cachedToken.token;
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }
  return refreshAccessToken();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const text = (body.text ?? "").trim();
    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }
    if ([...text].length > MAX_LENGTH) {
      return NextResponse.json(
        { error: `text is ${[...text].length} chars; limit is ${MAX_LENGTH}.` },
        { status: 400 },
      );
    }

    const accessToken = await getAccessToken();

    const res = await fetch(POST_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    const json = (await res.json().catch(() => ({}))) as {
      data?: { id?: string; text?: string };
      errors?: { message?: string }[];
      title?: string;
      detail?: string;
      status?: number;
    };

    if (!res.ok || !json.data?.id) {
      const message =
        json.errors?.[0]?.message ?? json.detail ?? json.title ?? `X API responded ${res.status}`;
      return NextResponse.json({ error: message, status: res.status }, { status: 502 });
    }

    const id = json.data.id;
    return NextResponse.json({
      id,
      text: json.data.text ?? text,
      url: `https://x.com/i/status/${id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
