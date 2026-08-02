import { NextResponse } from "next/server";

import { sendNewsletterEmail } from "../../../../lib/send-newsletter-email";

export const runtime = "nodejs";

type Body = {
  body?: string;
  subject?: string;
  to?: string | string[];
  author?: string;
  week?: string;
  screenshots?: {
    repoName?: string;
    frames?: Array<{
      id?: string;
      route?: string;
      viewport?: string;
      mimeType?: string;
      data: string;
    }>;
  } | null;
};

export async function POST(req: Request) {
  const requestId = Math.random().toString(36).slice(2, 10);
  const log = (...args: unknown[]) => console.log(`[send-email ${requestId}]`, ...args);
  const logErr = (...args: unknown[]) => console.error(`[send-email ${requestId}]`, ...args);
  log("POST /app/api/send-email received");

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const screenshots =
      payload.screenshots?.frames && payload.screenshots.frames.length > 0
        ? {
            repoName: payload.screenshots.repoName,
            frames: payload.screenshots.frames,
          }
        : null;
    const result = await sendNewsletterEmail({
      body: payload.body ?? "",
      subject: payload.subject,
      to: payload.to,
      author: payload.author,
      week: payload.week,
      screenshots,
    });
    log("sent", {
      id: result.id,
      to: result.to,
      from: result.from,
      imageCount: result.imageCount,
    });
    return NextResponse.json({
      id: result.id,
      to: result.to,
      subject: result.subject,
      from: result.from,
      imageCount: result.imageCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logErr("send failed", message);
    const status =
      message.includes("RESEND_API_KEY") ||
      message.includes("SMTP_PASS") ||
      message.includes("empty")
        ? message.includes("empty")
          ? 400
          : 500
        : message.includes("Invalid recipient")
          ? 400
          : message.startsWith("SMTP error") || message.startsWith("Network error")
            ? 502
            : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
