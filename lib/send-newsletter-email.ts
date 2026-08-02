import nodemailer from "nodemailer";

import {
  buildNewsletterHtml,
  buildNewsletterText,
  type NewsletterImage,
} from "./email-template";

const DEFAULT_FROM = "Andrew <andrew@klinn.works>";
const DEFAULT_TO = "andrewwang123118@gmail.com";
const MAX_EMAIL_IMAGES = 6;

export type EmailScreenshotFrame = {
  id?: string;
  route?: string;
  viewport?: string;
  mimeType?: string;
  data: string;
};

export type EmailScreenshots = {
  repoName?: string;
  frames: EmailScreenshotFrame[];
};

export type SendNewsletterEmailInput = {
  body: string;
  subject?: string;
  to?: string | string[];
  from?: string;
  author?: string;
  week?: string;
  screenshots?: EmailScreenshots | null;
};

export type SendNewsletterEmailResult = {
  id: string;
  to: string[];
  subject: string;
  from: string;
  imageCount: number;
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

function resolveTo(to?: string | string[]): string[] {
  if (Array.isArray(to)) return to.flatMap(splitList);
  if (typeof to === "string" && to.trim()) return splitList(to);
  if (process.env.SMTP_TO) return splitList(process.env.SMTP_TO);
  if (process.env.RESEND_TO) return splitList(process.env.RESEND_TO);
  return [DEFAULT_TO];
}

function stripDataUrl(data: string): string {
  const trimmed = data.trim();
  const m = /^data:[^;]+;base64,(.+)$/i.exec(trimmed);
  return m ? m[1] : trimmed;
}

function safeFilename(value: string): string {
  return (
    value
      .replace(/^\//, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "shot"
  );
}

function pickFrames(screenshots?: EmailScreenshots | null): EmailScreenshotFrame[] {
  const frames = screenshots?.frames ?? [];
  return frames
    .filter((f) => typeof f.data === "string" && f.data.trim().length > 0)
    .slice(0, MAX_EMAIL_IMAGES);
}

function subjectFromBody(body: string): string | null {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (h) {
      const title = h[2].replace(/\*\*/g, "").trim();
      if (title) return title.slice(0, 120);
    }
  }
  return null;
}

function resolveSmtpConfig() {
  const user = (process.env.SMTP_USER ?? "").trim();
  // Gmail app passwords are often pasted with spaces — strip them.
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  if (!user || !pass) {
    throw new Error(
      "Server is missing SMTP_USER/SMTP_PASS. Add them to .env.local and restart `next dev`.",
    );
  }

  const host = (process.env.SMTP_HOST ?? "smtp.gmail.com").trim();
  const port = Number(process.env.SMTP_PORT ?? "465");
  const secure =
    process.env.SMTP_SECURE != null
      ? process.env.SMTP_SECURE === "true" || process.env.SMTP_SECURE === "1"
      : port === 465;

  const from =
    (process.env.SMTP_FROM ?? process.env.RESEND_FROM ?? DEFAULT_FROM).trim() || DEFAULT_FROM;

  return { host, port, secure, user, pass, from };
}

export async function sendNewsletterEmail(
  input: SendNewsletterEmailInput,
): Promise<SendNewsletterEmailResult> {
  const smtp = resolveSmtpConfig();

  const body = (input.body ?? "").trim();
  if (!body) throw new Error("Newsletter body is empty");

  const fromAddr = (input.from ?? smtp.from).trim() || smtp.from;
  const toList = resolveTo(input.to);
  const invalid = toList.filter((addr) => !isEmail(addr));
  if (invalid.length) {
    throw new Error(`Invalid recipient address(es): ${invalid.join(", ")}`);
  }

  const subject =
    (input.subject ?? "").trim() ||
    subjectFromBody(body) ||
    `Multimail · ${new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`;

  const frames = pickFrames(input.screenshots);
  const newsletterImages: NewsletterImage[] = frames.map((frame, index) => {
    const route = frame.route ?? "/";
    const viewport = frame.viewport ?? "desktop";
    const cid = `shot-${index}@multimail`;
    return {
      contentId: cid,
      alt: `${input.screenshots?.repoName ?? "App"} ${route} (${viewport})`,
      caption: `${route} · ${viewport}`,
    };
  });

  const html = buildNewsletterHtml({
    body,
    author: input.author,
    week: input.week,
    images: newsletterImages,
  });
  const text = buildNewsletterText({
    body,
    author: input.author,
    week: input.week,
  });

  const attachments = frames.map((frame, index) => {
    const route = safeFilename(frame.route ?? "home");
    const viewport = safeFilename(frame.viewport ?? "desktop");
    const cid = `shot-${index}@multimail`;
    return {
      filename: `${route}-${viewport}.png`,
      content: Buffer.from(stripDataUrl(frame.data), "base64"),
      contentType: frame.mimeType ?? "image/png",
      cid,
      contentDisposition: "inline" as const,
    };
  });

  const isGmail = /gmail\.com$/i.test(smtp.host);
  const transporter = nodemailer.createTransport(
    isGmail
      ? {
          service: "gmail",
          auth: {
            user: smtp.user,
            pass: smtp.pass,
          },
        }
      : {
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: {
            user: smtp.user,
            pass: smtp.pass,
          },
        },
  );

  try {
    const info = await transporter.sendMail({
      from: fromAddr,
      to: toList.join(", "),
      subject,
      html,
      text,
      attachments,
    });

    const id = info.messageId ?? `smtp-${Date.now()}`;
    return {
      id,
      to: toList,
      subject,
      from: fromAddr,
      imageCount: attachments.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/535|Invalid login|Username and Password/i.test(message)) {
      throw new Error(
        `SMTP auth failed (${message}). Check SMTP_USER is your full Google account email, SMTP_PASS is a 16-char App Password (spaces ok), and restart \`next dev\` after editing .env.local.`,
      );
    }
    throw new Error(`SMTP error: ${message}`);
  } finally {
    transporter.close();
  }
}
