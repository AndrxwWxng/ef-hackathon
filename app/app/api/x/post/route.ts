import { NextResponse } from "next/server";
import { TwitterApi } from "twitter-api-v2";

export const runtime = "nodejs";

type MediaInput = {
  mimeType?: string;
  data: string;
};

type Body = {
  text?: string;
  media?: MediaInput[];
  screenshots?: {
    frames?: Array<{
      mimeType?: string;
      data: string;
      route?: string;
      viewport?: string;
    }>;
  } | null;
  imageDataUrl?: string;
};

const MAX_LENGTH = 280;
const MAX_MEDIA = 4;
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const POST_URL = "https://api.x.com/2/tweets";
const MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

let cachedToken: { token: string; expiresAt: number } | null = null;

function stripDataUrl(data: string): { mimeType: string; base64: string } {
  const trimmed = data.trim();
  const m = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (m) return { mimeType: m[1], base64: m[2] };
  return { mimeType: "image/png", base64: trimmed };
}

function collectMedia(body: Body): MediaInput[] {
  const out: MediaInput[] = [];
  if (Array.isArray(body.media)) {
    for (const item of body.media) {
      if (item?.data?.trim()) out.push(item);
      if (out.length >= MAX_MEDIA) return out;
    }
  }
  for (const frame of body.screenshots?.frames ?? []) {
    if (!frame?.data?.trim()) continue;
    out.push({ mimeType: frame.mimeType ?? "image/png", data: frame.data });
    if (out.length >= MAX_MEDIA) return out;
  }
  if (out.length === 0 && body.imageDataUrl?.trim()) {
    out.push({ data: body.imageDataUrl });
  }
  return out.slice(0, MAX_MEDIA);
}

function hasOAuth1(): boolean {
  return Boolean(
    process.env.X_APP_KEY &&
      process.env.X_APP_SECRET &&
      process.env.X_ACCESS_TOKEN &&
      process.env.X_ACCESS_TOKEN_SECRET,
  );
}

function oauth1Client(): TwitterApi {
  return new TwitterApi({
    appKey: process.env.X_APP_KEY!,
    appSecret: process.env.X_APP_SECRET!,
    accessToken: process.env.X_ACCESS_TOKEN!,
    accessSecret: process.env.X_ACCESS_TOKEN_SECRET!,
  });
}

async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const refreshToken = process.env.X_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Missing X credentials. Set OAuth1 (X_APP_KEY/X_APP_SECRET/X_ACCESS_TOKEN/X_ACCESS_TOKEN_SECRET) or OAuth2 (X_CLIENT_ID/X_CLIENT_SECRET/X_REFRESH_TOKEN).",
    );
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

async function uploadMediaOAuth1(media: MediaInput): Promise<string> {
  const { mimeType, base64 } = stripDataUrl(media.data);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("empty media payload");
  const client = oauth1Client();
  const mediaId = await client.v1.uploadMedia(buffer, {
    mimeType: media.mimeType ?? mimeType,
    target: "tweet",
  });
  return mediaId;
}

async function uploadMediaOAuth2(accessToken: string, media: MediaInput): Promise<string> {
  const { mimeType, base64 } = stripDataUrl(media.data);
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength === 0) throw new Error("empty media payload");
  if (buffer.byteLength > 5 * 1024 * 1024) {
    throw new Error("media exceeds 5MB limit for simple image upload");
  }

  const form = new FormData();
  const bytes = new Uint8Array(buffer);
  const blob = new Blob([bytes], { type: media.mimeType ?? mimeType });
  form.append("media", blob, "image.png");
  form.append("media_category", "tweet_image");

  const res = await fetch(MEDIA_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  const json = (await res.json().catch(() => ({}))) as {
    media_id_string?: string;
    media_id?: number;
    errors?: { message?: string }[];
    detail?: string;
    title?: string;
    error?: string;
  };

  const mediaId = json.media_id_string ?? (json.media_id != null ? String(json.media_id) : "");
  if (!res.ok || !mediaId) {
    const message =
      json.errors?.[0]?.message ??
      json.detail ??
      json.title ??
      json.error ??
      `media upload failed (${res.status})`;
    throw new Error(message);
  }
  return mediaId;
}

async function postWithOAuth1(text: string, mediaInputs: MediaInput[]) {
  const client = oauth1Client();
  const mediaIds: string[] = [];
  const mediaErrors: string[] = [];
  for (const item of mediaInputs) {
    try {
      mediaIds.push(await uploadMediaOAuth1(item));
    } catch (err) {
      mediaErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const payload: {
    text: string;
    media?: {
      media_ids: [string] | [string, string] | [string, string, string] | [string, string, string, string];
    };
  } = { text };
  if (mediaIds.length === 1) payload.media = { media_ids: [mediaIds[0]] };
  else if (mediaIds.length === 2) payload.media = { media_ids: [mediaIds[0], mediaIds[1]] };
  else if (mediaIds.length === 3) payload.media = { media_ids: [mediaIds[0], mediaIds[1], mediaIds[2]] };
  else if (mediaIds.length >= 4) {
    payload.media = { media_ids: [mediaIds[0], mediaIds[1], mediaIds[2], mediaIds[3]] };
  }
  const result = await client.v2.tweet(payload);
  const id = result.data.id;
  return {
    id,
    text: result.data.text ?? text,
    url: `https://x.com/i/status/${id}`,
    mediaCount: mediaIds.length,
    mediaErrors: mediaErrors.length ? mediaErrors : undefined,
  };
}

async function postWithOAuth2(text: string, mediaInputs: MediaInput[]) {
  const accessToken = await getAccessToken();
  const mediaIds: string[] = [];
  const mediaErrors: string[] = [];
  for (const item of mediaInputs) {
    try {
      mediaIds.push(await uploadMediaOAuth2(accessToken, item));
    } catch (err) {
      mediaErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const payload: Record<string, unknown> = { text };
  if (mediaIds.length > 0) {
    payload.media = { media_ids: mediaIds };
  }

  const res = await fetch(POST_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: string; text?: string };
    errors?: { message?: string }[];
    title?: string;
    detail?: string;
  };

  if (!res.ok || !json.data?.id) {
    const message =
      json.errors?.[0]?.message ?? json.detail ?? json.title ?? `X API responded ${res.status}`;
    const err = new Error(message) as Error & { mediaErrors?: string[]; status?: number };
    err.mediaErrors = mediaErrors;
    err.status = res.status;
    throw err;
  }

  return {
    id: json.data.id,
    text: json.data.text ?? text,
    url: `https://x.com/i/status/${json.data.id}`,
    mediaCount: mediaIds.length,
    mediaErrors: mediaErrors.length ? mediaErrors : undefined,
  };
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

    const mediaInputs = collectMedia(body);
    const result = hasOAuth1()
      ? await postWithOAuth1(text, mediaInputs)
      : await postWithOAuth2(text, mediaInputs);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const mediaErrors =
      err && typeof err === "object" && "mediaErrors" in err
        ? (err as { mediaErrors?: string[] }).mediaErrors
        : undefined;
    return NextResponse.json(
      { error: message, mediaErrors },
      { status: 500 },
    );
  }
}
