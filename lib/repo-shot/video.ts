import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import type { Browser, Page } from "playwright";

import { routeSlug } from "./capture";
import type { Viewport, ViewportName } from "./types";

const DEV_OVERLAY_CSS = `
  nextjs-portal,
  [data-next-badge-root],
  [data-nextjs-toast],
  #__next-build-watcher,
  vite-error-overlay,
  vite-plugin-checker-error-overlay { display: none !important; }
`;

function joinUrl(baseUrl: string, route: string) {
  if (/^https?:\/\//i.test(route)) return route;
  return `${baseUrl.replace(/\/+$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
}

function normalizeRoute(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "/";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function smoothScroll(page: Page, scrollStepPx: number, holdMs: number) {
  await page
    .evaluate(async (step: number) => {
      const limit = Math.max(
        document.body?.scrollHeight ?? 0,
        document.documentElement?.scrollHeight ?? 0,
      );
      const direction = Math.max(200, step);
      for (let y = 0; y < limit; y += direction) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      window.scrollTo(0, 0);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }, scrollStepPx)
    .catch(() => undefined);
  await page.waitForTimeout(holdMs);
}

async function wiggleCursor(page: Page, viewport: Viewport) {
  try {
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    await page.mouse.move(cx - 80, cy - 40, { steps: 8 });
    await page.waitForTimeout(80);
    await page.mouse.move(cx + 60, cy + 20, { steps: 12 });
    await page.waitForTimeout(80);
    await page.mouse.move(cx, cy, { steps: 8 });
  } catch {
    return;
  }
}

async function navigateToRoute(page: Page, baseUrl: string, route: string, navigationTimeoutMs: number) {
  const target = joinUrl(baseUrl, route);
  const sameOrigin = target.startsWith(baseUrl);
  if (!sameOrigin || route === "/") {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
    return;
  }
  const clicked = await page
    .evaluate((targetRoute: string) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"));
      const wanted = targetRoute.split("?")[0].replace(/\/+$/, "") || "/";
      for (const link of links) {
        const href = link.getAttribute("href") ?? "";
        if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
          continue;
        let resolved: URL;
        try {
          resolved = new URL(href, window.location.href);
        } catch {
          continue;
        }
        if (resolved.origin !== window.location.origin) continue;
        const pathOnly = resolved.pathname.replace(/\/+$/, "") || "/";
        if (pathOnly === wanted) {
          link.scrollIntoView({ behavior: "instant", block: "center" });
          link.click();
          return true;
        }
      }
      return false;
    }, route)
    .catch(() => false);
  if (clicked) {
    await page.waitForLoadState("domcontentloaded", { timeout: navigationTimeoutMs }).catch(() => undefined);
  } else {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
  }
}

export type RecordVideoParams = {
  browser: Browser;
  baseUrl: string;
  routes: string[];
  viewport: Viewport;
  outDir: string;
  jobId: string;
  durationMs: number;
  navigationTimeoutMs: number;
  perRouteHoldMs: number;
  scrollStepPx: number;
  onLog: (line: string) => void;
};

export type RecordVideoResult = {
  rawPath: string;
  width: number;
  height: number;
  durationMs: number;
};

export async function recordRepoVideo(params: RecordVideoParams): Promise<RecordVideoResult> {
  const {
    browser,
    baseUrl,
    routes,
    viewport,
    outDir,
    jobId,
    durationMs,
    navigationTimeoutMs,
    perRouteHoldMs,
    scrollStepPx,
    onLog,
  } = params;
  await fs.mkdir(outDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.name === "mobile",
    hasTouch: viewport.name === "mobile",
    ignoreHTTPSErrors: true,
    colorScheme: "light",
    reducedMotion: "reduce",
    recordVideo: {
      dir: outDir,
      size: { width: viewport.width, height: viewport.height },
    },
  });
  const page = await context.newPage();
  page.on("pageerror", () => undefined);
  page.on("crash", () => undefined);
  const startedAt = Date.now();
  const normalized = (routes.length ? routes : ["/"]).map(normalizeRoute);
  try {
    if (!normalized.length) normalized.push("/");
    await page.addStyleTag({ content: DEV_OVERLAY_CSS }).catch(() => undefined);
    for (let i = 0; i < normalized.length; i++) {
      const route = normalized[i];
      const elapsed = Date.now() - startedAt;
      const remaining = durationMs - elapsed;
      if (remaining <= 0) {
        onLog(`record stop: budget exhausted at ${route}`);
        break;
      }
      try {
        await navigateToRoute(page, baseUrl, route, navigationTimeoutMs);
        await page
          .waitForLoadState("networkidle", { timeout: Math.min(2500, navigationTimeoutMs) })
          .catch(() => undefined);
        await wiggleCursor(page, viewport);
        await smoothScroll(page, scrollStepPx, Math.min(perRouteHoldMs, Math.max(120, remaining / 4)));
        await page
          .waitForTimeout(Math.min(perRouteHoldMs, Math.max(150, remaining / 3)))
          .catch(() => undefined);
        onLog(`recorded ${route} @ ${viewport.name} (${viewport.width}x${viewport.height})`);
      } catch (error) {
        onLog(
          `route ${route} recording skipped: ${
            error instanceof Error ? error.message.split("\n")[0] : String(error)
          }`,
        );
      }
    }
    await page.waitForTimeout(Math.max(80, perRouteHoldMs / 2)).catch(() => undefined);
  } finally {
    const video = page.video();
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
    let rawPath = "";
    if (video) {
      rawPath = await video.path();
    }
    let finalPath = "";
    if (rawPath) {
      const slug = routeSlug(normalized[0] ?? "/") || "index";
      finalPath = path.join(outDir, `${jobId}__${slug}__${viewport.name}.webm`);
      try {
        await fs.copyFile(rawPath, finalPath);
        await fs.rm(rawPath, { force: true }).catch(() => undefined);
      } catch (error) {
        onLog(
          `video copy fallback: ${
            error instanceof Error ? error.message.split("\n")[0] : String(error)
          }`,
        );
        finalPath = rawPath;
      }
    }
    return {
      rawPath: finalPath,
      width: viewport.width,
      height: viewport.height,
      durationMs: Date.now() - startedAt,
    };
  }
}

export type EncodeVideoParams = {
  sourcePath: string;
  targetPath: string;
  ffmpegPath?: string;
};

export async function encodeVideoMp4(params: EncodeVideoParams): Promise<void> {
  const { sourcePath, targetPath, ffmpegPath = "ffmpeg" } = params;
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      "-y",
      "-i",
      sourcePath,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-an",
      targetPath,
    ]);
    const err: Buffer[] = [];
    proc.stderr.on("data", (chunk) => err.push(chunk));
    proc.on("error", (error) => reject(error));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg exited ${code}: ${Buffer.concat(err).toString("utf8").slice(-300)}`,
          ),
        );
    });
  });
}

export function defaultVideoViewportName(): ViewportName {
  return "desktop";
}
