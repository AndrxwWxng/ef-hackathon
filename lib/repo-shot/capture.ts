import fs from "node:fs/promises";
import path from "node:path";

import type { Browser, Page } from "playwright";

import type { RepoShot, Viewport } from "./types";

const DEV_OVERLAY_CSS = `
  nextjs-portal,
  [data-next-badge-root],
  [data-nextjs-toast],
  #__next-build-watcher,
  vite-error-overlay,
  vite-plugin-checker-error-overlay { display: none !important; }
`;

export function routeSlug(route: string) {
  const cleaned = route
    .split("#")[0]
    .replace(/[?].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "index";
}

function joinUrl(baseUrl: string, route: string) {
  if (/^https?:\/\//i.test(route)) return route;
  return `${baseUrl.replace(/\/+$/, "")}${route.startsWith("/") ? route : `/${route}`}`;
}

async function settlePage(page: Page, settleMs: number) {
  await page.waitForTimeout(settleMs);
  await Promise.race([
    page.evaluate(() => document.fonts?.ready.then(() => true) ?? true).catch(() => false),
    page.waitForTimeout(2000),
  ]);
  await page
    .evaluate(async () => {
      const limit = Math.max(document.body?.scrollHeight ?? 0, document.documentElement?.scrollHeight ?? 0);
      const step = Math.max(300, window.innerHeight);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      window.scrollTo(0, 0);
    })
    .catch(() => undefined);
  await page.addStyleTag({ content: DEV_OVERLAY_CSS }).catch(() => undefined);
  await page.waitForTimeout(120);
}

async function captureViewport({ browser, baseUrl, routes, viewport, outDir, jobId, navigationTimeoutMs, settleMs, onLog }: { browser: Browser; baseUrl: string; routes: string[]; viewport: Viewport; outDir: string; jobId: string; navigationTimeoutMs: number; settleMs: number; onLog: (line: string) => void }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.deviceScaleFactor,
    isMobile: viewport.name === "mobile",
    hasTouch: viewport.name === "mobile",
    ignoreHTTPSErrors: true,
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const shots: RepoShot[] = [];
  let page = await context.newPage();
  page.on("pageerror", () => undefined);
  page.on("crash", () => undefined);

  try {
    for (const route of routes) {
      const fileName = `${jobId}__${routeSlug(route)}__${viewport.name}.png`;
      const rawPath = path.join(outDir, fileName);
      try {
        if (page.isClosed()) page = await context.newPage();
        await page.goto(joinUrl(baseUrl, route), { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
        await page.waitForLoadState("networkidle", { timeout: Math.min(4000, navigationTimeoutMs) }).catch(() => undefined);
        await settlePage(page, settleMs);
        await page.screenshot({ path: rawPath, fullPage: false });
        shots.push({
          id: `${jobId}__${routeSlug(route)}__${viewport.name}`,
          route,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          rawPath,
          framedPath: null,
        });
        onLog(`captured ${route} @ ${viewport.name} (${viewport.width}x${viewport.height})`);
      } catch (error) {
        onLog(`capture skipped ${route} @ ${viewport.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
  } finally {
    await context.close().catch(() => undefined);
  }
  return shots;
}

async function mapLimited<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        results[current] = await mapper(items[current]);
      }
    }),
  );
  return results;
}

export async function captureShots({ browser, baseUrl, routes, viewports, outDir, jobId, navigationTimeoutMs = 30000, settleMs = 350, concurrency = 3, onLog }: { browser: Browser; baseUrl: string; routes: string[]; viewports: Viewport[]; outDir: string; jobId: string; navigationTimeoutMs?: number; settleMs?: number; concurrency?: number; onLog: (line: string) => void }) {
  await fs.mkdir(outDir, { recursive: true });
  const viewportShots = await mapLimited(viewports, concurrency, (viewport) =>
    captureViewport({ browser, baseUrl, routes, viewport, outDir, jobId, navigationTimeoutMs, settleMs, onLog }),
  );
  return viewportShots.flat();
}
