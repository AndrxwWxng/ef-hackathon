import fs from "node:fs/promises";
import path from "node:path";

import type { Browser } from "playwright";

import { THEMES, type RepoShot, type ThemeName } from "./types";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E\")";
const SHADOW = "0 50px 100px -20px rgba(0,0,0,.45), 0 30px 60px -30px rgba(0,0,0,.6)";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
}

function displayUrl(route: string) {
  return /^https?:\/\//i.test(route) ? route.replace(/^https?:\/\//i, "") : `localhost${route.startsWith("/") ? route : `/${route}`}`;
}

function buildHtml({ image, width, height, themeName, title, route, mobile, padX, padY, stageWidth, stageHeight }: { image: string; width: number; height: number; themeName: ThemeName; title: string; route: string; mobile: boolean; padX: number; padY: number; stageWidth: number; stageHeight: number }) {
  const theme = THEMES[themeName];
  const light = "light" in theme && theme.light === true;
  const chromeBg = light ? "rgba(255,255,255,.72)" : "rgba(24,25,30,.62)";
  const chromeText = light ? "rgba(28,30,36,.82)" : "rgba(255,255,255,.86)";
  const chromeSub = light ? "rgba(28,30,36,.6)" : "rgba(255,255,255,.7)";
  const chromeLine = light ? "rgba(0,0,0,.09)" : "rgba(255,255,255,.09)";
  const pillBg = light ? "rgba(0,0,0,.05)" : "rgba(255,255,255,.09)";
  const safeTitle = escapeHtml(title);
  const safeRoute = escapeHtml(displayUrl(route));
  const imageMarkup = `<img src="${image}" width="${width}" height="${height}" alt="">`;
  const frame = mobile
    ? `<div class="phone"><div class="phone-inner"><div class="notch"></div>${imageMarkup}</div><div class="ring phone-ring"></div></div><div class="caption">${safeTitle ? `<span class="cap-title">${safeTitle}</span>` : ""}<span class="pill"><i></i>${safeRoute}</span></div>`
    : `<div class="window"><div class="bar"><div class="bar-left"><span class="light l1"></span><span class="light l2"></span><span class="light l3"></span>${safeTitle ? `<span class="win-title">${safeTitle}</span>` : ""}</div><div class="bar-mid"><span class="pill"><i></i>${safeRoute}</span></div><div></div></div><div class="screen">${imageMarkup}</div><div class="ring"></div></div>`;

  return `<meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;background:#000}#stage{position:relative;width:${stageWidth}px;height:${stageHeight}px;padding:${padY}px ${padX}px;display:flex;align-items:center;justify-content:center;overflow:hidden;background:${theme.bg};background-color:${light ? "#e6e9ef" : "#0a0b10"};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;isolation:isolate}.grain,.vignette{position:absolute;inset:-2px;pointer-events:none}.grain{background-image:${GRAIN};background-size:180px;opacity:${light ? ".05" : ".075"};mix-blend-mode:overlay;z-index:1}.vignette{background:${light ? "radial-gradient(120% 92% at 50% 44%,transparent 42%,rgba(0,0,0,.16) 100%)" : "radial-gradient(120% 92% at 50% 44%,transparent 40%,rgba(0,0,0,.46) 100%)"};z-index:2}.content{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:24px;transform:scale(.985)}.window{position:relative;width:${width}px;border-radius:14px;background:${light ? "#fff" : "#111319"};box-shadow:${SHADOW},${light ? "0 0 0 1px rgba(0,0,0,.08)" : "0 0 0 1px rgba(0,0,0,.35)"}}.bar{height:42px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:0 14px;border-radius:14px 14px 0 0;background:${chromeBg};backdrop-filter:blur(22px) saturate(170%);border-bottom:1px solid ${chromeLine}}.bar-left{display:flex;align-items:center;gap:8px;min-width:0}.bar-mid{display:flex;justify-content:center}.light{width:12px;height:12px;border-radius:50%;box-shadow:inset 0 -1px 1px rgba(0,0,0,.22),inset 0 1px 1px rgba(255,255,255,.35)}.l1{background:#ff5f57}.l2{background:#febc2e}.l3{background:#28c840}.win-title{margin-left:10px;font-size:13px;font-weight:600;color:${chromeText};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${Math.round(width * 0.28)}px}.pill{display:inline-flex;align-items:center;gap:7px;max-width:${Math.round(width * 0.42)}px;padding:5px 14px;border-radius:999px;background:${pillBg};border:1px solid ${chromeLine};color:${chromeSub};font:11.5px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.pill i{width:6px;height:6px;border-radius:50%;background:${theme.accent};box-shadow:0 0 8px ${theme.accent};flex:none}.screen{border-radius:0 0 14px 14px;overflow:hidden;line-height:0;background:${light ? "#fff" : "#0d0e13"}}.screen img{display:block;width:${width}px;height:${height}px}.ring{position:absolute;inset:0;border-radius:14px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);pointer-events:none}.phone{position:relative;padding:12px;border-radius:56px;background:linear-gradient(158deg,#34363c,#17181d 42%,#0b0c0f);box-shadow:${SHADOW},0 0 0 1px rgba(0,0,0,.5)}.phone-inner{position:relative;border-radius:44px;overflow:hidden;background:#000;line-height:0}.phone-inner img{display:block;width:${width}px;height:${height}px}.notch{position:absolute;top:11px;left:50%;transform:translateX(-50%);width:${Math.round(width * 0.3)}px;height:26px;border-radius:999px;background:#000;z-index:2}.phone-ring{border-radius:56px}.caption{display:flex;align-items:center;gap:12px;color:${light ? "rgba(30,32,38,.72)" : "rgba(255,255,255,.78)"}}.cap-title{font-size:14px;font-weight:600}
</style><div id="stage"><div class="grain"></div><div class="vignette"></div><div class="content">${frame}</div></div>`;
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

export async function frameShots({ browser, shots, outDir, theme, title, concurrency = 3, onLog }: { browser: Browser; shots: RepoShot[]; outDir: string; theme: ThemeName; title: string; concurrency?: number; onLog: (line: string) => void }) {
  const context = await browser.newContext({ deviceScaleFactor: 2 });
  try {
    return await mapLimited(shots, concurrency, async (shot) => {
      const output = { ...shot };
      const mobile = shot.viewport.toLowerCase() === "mobile";
      const frameWidth = mobile ? shot.width + 24 : shot.width;
      const frameHeight = mobile ? shot.height + 70 : shot.height + 42;
      const padX = Math.round(Math.max(frameWidth * 0.09, 72));
      const padY = Math.round(Math.max(frameWidth * 0.115, 90));
      const stageWidth = frameWidth + padX * 2;
      const stageHeight = frameHeight + padY * 2;
      const fileName = `${path.basename(shot.rawPath, ".png")}__framed.png`;
      const framedPath = path.join(outDir, fileName);
      const page = await context.newPage();
      try {
        const data = await fs.readFile(shot.rawPath, "base64");
        await page.setViewportSize({ width: stageWidth, height: stageHeight });
        await page.setContent(
          buildHtml({ image: `data:image/png;base64,${data}`, width: shot.width, height: shot.height, themeName: theme, title, route: shot.route, mobile, padX, padY, stageWidth, stageHeight }),
          { waitUntil: "load", timeout: 10000 },
        );
        await page.locator("#stage img").evaluate((image: HTMLImageElement) => image.decode()).catch(() => undefined);
        await page.locator("#stage").screenshot({ path: framedPath });
        output.framedPath = framedPath;
        onLog(`framed ${shot.route} @ ${shot.viewport} with ${theme}`);
      } catch (error) {
        onLog(`frame failed ${shot.route} @ ${shot.viewport}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      } finally {
        await page.close().catch(() => undefined);
      }
      return output;
    });
  } finally {
    await context.close().catch(() => undefined);
  }
}
