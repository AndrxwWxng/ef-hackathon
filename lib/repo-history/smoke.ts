import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateRepoHistory } from "./index";

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repo-history-smoke-"));
  const url = process.argv[2] ?? "https://github.com/iBrushC/founder-relation-management.git";
  console.log(`[smoke] analyzing ${url}`);
  const result = await generateRepoHistory(
    {
      repoUrl: url,
      windowDays: 7,
      outDir: path.join(tmp, "artifacts"),
    },
    { cloneRoot: path.join(tmp, "clones") },
  );
  console.log(`[smoke] meta:`, result.meta);
  console.log(`[smoke] phases:`, result.phases);
  console.log(`[smoke] artifacts:`);
  for (const [name, file] of Object.entries(result.artifacts)) {
    console.log(`  - ${name}: ${file}`);
  }
  const analysis = await fs.readFile(result.artifacts.analysis, "utf8");
  console.log(`[smoke] analysis preview:\n${analysis.split("\n").slice(0, 24).join("\n")}`);
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exitCode = 1;
});