import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generateRepoHistory } from "./index";

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "repo-history-smoke-"));
  const url = process.argv[2] ?? "https://github.com/iBrushC/founder-relation-management.git";
  console.log(`[smoke] analyzing ${url}`);
  const windowDays = Number(process.argv[3] ?? 7);
  const result = await generateRepoHistory(
    {
      repoUrl: url,
      windowDays,
      outDir: path.join(tmp, "artifacts"),
      // `SMOKE_NO_LLM=1` exercises collection only, without spending tokens.
      comprehend: process.env.SMOKE_NO_LLM !== "1",
      onLog: (line) => console.log(`[git] ${line}`),
    },
    { cloneRoot: path.join(tmp, "clones") },
  );
  console.log(`[smoke] meta:`, result.meta);
  console.log(`[smoke] phases:`, result.phases);
  if (result.warnings.length) {
    console.log(`[smoke] warnings:`);
    for (const warning of result.warnings) console.log(`  ! ${warning}`);
  }
  console.log(`[smoke] artifacts:`);
  for (const [name, file] of Object.entries(result.artifacts)) {
    console.log(`  - ${name}: ${file}`);
  }
  if (result.data.deep) {
    const deep = result.data.deep;
    console.log(
      `[smoke] deep read: ${deep.budget.commitsRead} commits, ${deep.budget.patchBytes.toLocaleString()} patch bytes` +
        `${deep.budget.patchTruncated ? " (truncated)" : ""}, ${deep.keyFiles.length} key files, ` +
        `${deep.docs.length} docs, ${deep.routes.length} routes`,
    );
    console.log(`[smoke] routes: ${deep.routes.map((r) => `${r.kind}:${r.route}`).join(", ")}`);
  }
  if (result.data.github) {
    const gh = result.data.github;
    console.log(
      `[smoke] github: ${gh.pullRequests.length} PRs, ${gh.issues.length} issues, ${gh.releases.length} releases (auth=${gh.authenticated})`,
    );
  }
  if (result.data.comprehension) {
    const c = result.data.comprehension;
    console.log(`[smoke] digest: ${c.digest.project.oneLiner}`);
    console.log(`[smoke] headline: ${c.digest.window.headline}`);
    console.log(
      `[smoke] ${c.digest.features.length} features / ${c.digest.fixes.length} fixes / ${c.digest.infrastructure.length} infra, from ${c.commitUnderstandings.length} commits read`,
    );
  }
  const analysis = await fs.readFile(result.artifacts.analysis, "utf8");
  console.log(`[smoke] analysis preview:\n${analysis.split("\n").slice(0, 24).join("\n")}`);
}

main().catch((error) => {
  console.error("[smoke] failed:", error);
  process.exitCode = 1;
});