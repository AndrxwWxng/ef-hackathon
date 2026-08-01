import { NextResponse } from "next/server";

import { buildNewsletterHtml } from "../../../../lib/email-template";

export const runtime = "nodejs";

type Body = {
  body?: string;
  subject?: string;
  to?: string | string[];
  author?: string;
  week?: string;
};

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const log = (...args: unknown[]) => console.log(`[send-email ${requestId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[send-email ${requestId}]`, ...args);
  log("POST /app/api/send-email received");

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logErr("missing RESEND_API_KEY");
    return NextResponse.json(
      { error: "Server is missing RESEND_API_KEY. Add it to .env.local and restart." },
      { status: 500 },
    );
  }
  const fromAddr = process.env.RESEND_FROM;
  if (!fromAddr) {
    logErr("missing RESEND_FROM");
    return NextResponse.json(
      { error: "Server is missing RESEND_FROM. Add it to .env.local and restart." },
      { status: 500 },
    );
  }

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = (payload.body ?? "").trim();
  if (!body) {
    return NextResponse.json({ error: "Newsletter body is empty" }, { status: 400 });
  }

  const envTo = process.env.RESEND_TO;
  let toList: string[];
  if (Array.isArray(payload.to)) {
    toList = payload.to.flatMap(splitList);
  } else if (typeof payload.to === "string" && payload.to.trim()) {
    toList = splitList(payload.to);
  } else if (envTo) {
    toList = splitList(envTo);
  } else {
    return NextResponse.json(
      { error: "No recipients. Set RESEND_TO or pass `to` in the request body." },
      { status: 400 },
    );
  }
  const invalid = toList.filter((addr) => !isEmail(addr));
  if (invalid.length) {
    return NextResponse.json(
      { error: `Invalid recipient address(es): ${invalid.join(", ")}` },
      { status: 400 },
    );
  }

  const subject =
    (payload.subject ?? "").trim() ||
    `Multimail · Sponsor dispatch · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const html = buildNewsletterHtml({
    body,
    author: payload.author,
    week: payload.week,
  });

  log("sending via resend", {
    to: toList,
    subject,
    bodyLength: body.length,
    htmlLength: html.length,
  });

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ from: fromAddr, to: toList, subject, html }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logErr("network error calling resend", message);
    return NextResponse.json({ error: `Network error: ${message}` }, { status: 502 });
  }

  const text = await res.text();
  let data: { id?: string; message?: string; error?: string; name?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }

  if (res.status === 200 || res.status === 201) {
    if (!data.id) {
      logErr("resend returned no id", { status: res.status, body: text });
      return NextResponse.json(
        { error: "Resend returned a success response without an id" },
        { status: 502 },
      );
    }
    log("sent", { id: data.id });
    return NextResponse.json({ id: data.id, to: toList, subject });
  }

  const detail = data.message || data.error || data.name || text || `HTTP ${res.status}`;
  logErr("resend rejected the request", { status: res.status, detail });
  return NextResponse.json({ error: detail }, { status: res.status >= 500 ? 502 : res.status });
}
