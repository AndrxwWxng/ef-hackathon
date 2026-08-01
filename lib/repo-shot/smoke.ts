import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { generateRepoShots } from "./index";

async function main() {
  const root = await mkdtemp(join(tmpdir(), "multimail-repo-shot-"));
  const work = join(root, "site");
  const repoName = "multimail-smoke";
  await mkdir(work, { recursive: true });
  await writeFile(join(work, "index.html"), `<!doctype html><html><body style="background:#0b0c10;color:#fff;font:600 48px/1.2 system-ui;display:grid;place-items:center;height:100vh;margin:0">multimail repo-shot smoke</body></html>`);
  try {
    execFileSync("git", ["init", "-q", work]);
    execFileSync("git", ["-C", work, "add", "."], { stdio: "ignore" });
    execFileSync("git", ["-C", work, "-c", "user.email=ci@local", "-c", "user.name=ci", "commit", "-q", "-m", "init"]);
    const result = await generateRepoShots(
      { repoUrl: `https://example.com/${repoName}`, routes: ["/"], viewports: ["desktop"], theme: "midnight" },
      { outputRoot: join(root, "shots"), workRoot: join(root, "work"), captureConcurrency: 1, frameConcurrency: 1, bootTimeoutMs: 15000, settleMs: 50, skipCloneFrom: work, repoName },
    );
    console.log("ok", result.id, "shots", result.steps.find((s) => s.name === "capture")?.detail, result.steps.find((s) => s.name === "frame")?.detail);
    if (!result.shots.length) throw new Error("no shots produced");
    const first = result.shots[0];
    if (!first.framedPath) throw new Error("no framed shot");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("smoke failed", error);
  process.exitCode = 1;
});
