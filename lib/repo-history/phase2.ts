import fs from "node:fs/promises";
import path from "node:path";

import { runGit } from "./git";

export type ManifestSnippet = { name: string; body: string };
export type PackageInfo = {
  scripts: string;
  dependencies: string;
  devDependencies: string;
};

export type Phase2Structure = {
  treeDepth2: string[];
  manifestsPresent: string[];
  readmeExcerpt: string;
  packageJson: PackageInfo | null;
};

export async function collectPhase2(cloneDir: string): Promise<Phase2Structure> {
  const tracked = await runGit(
    ["ls-files", "--full-name"],
    { cwd: cloneDir, timeoutMs: 30_000 },
  );

  const tree = new Set<string>();
  const manifestPatterns = /^(README(\..+)?|package\.json|tsconfig.*\.json|next\.config.*|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|requirements\.txt)$/i;
  const manifestsPresent = new Set<string>();
  const entries = tracked.stdout.split(/\r?\n/).filter(Boolean);
  for (const entry of entries) {
    const parts = entry.split("/");
    const top = parts[0];
    if (parts.length > 1) tree.add(`${top}/${parts[1]}`);
    else tree.add(top);
    if (manifestPatterns.test(top)) manifestsPresent.add(top);
  }

  const readmeExcerpt = await readReadmeExcerpt(cloneDir);
  const packageJson = await readPackageInfo(cloneDir);

  return {
    treeDepth2: [...tree].sort(),
    manifestsPresent: [...manifestsPresent].sort(),
    readmeExcerpt,
    packageJson,
  };
}

async function readReadmeExcerpt(cloneDir: string): Promise<string> {
  for (const candidate of ["README.md", "README", "README.txt"]) {
    const full = path.join(cloneDir, candidate);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || !stat.isFile()) continue;
    const raw = await fs.readFile(full, "utf8");
    const lines = raw.split(/\r?\n/);
    return lines.slice(0, 200).join("\n");
  }
  return "";
}

async function readPackageInfo(cloneDir: string): Promise<PackageInfo | null> {
  const full = path.join(cloneDir, "package.json");
  const raw = await fs.readFile(full, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      scripts: stringifyMap(parsed.scripts),
      dependencies: stringifyMap(parsed.dependencies),
      devDependencies: stringifyMap(parsed.devDependencies),
    };
  } catch {
    return {
      scripts: "(invalid JSON)",
      dependencies: "",
      devDependencies: "",
    };
  }
}

function stringifyMap(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  if (entries.length === 0) return "";
  const width = Math.max(...entries.map(([k]) => k.length));
  return entries.map(([k, v]) => `${k.padEnd(width)}  ${String(v)}`).join("\n");
}

export function renderPhase2(structure: Phase2Structure): string {
  const lines: string[] = [];
  lines.push("=== top-level tree (depth 2) ===");
  if (structure.treeDepth2.length === 0) lines.push("(empty)");
  for (const row of structure.treeDepth2) lines.push(row);
  lines.push("");
  lines.push("=== README / manifests present ===");
  if (structure.manifestsPresent.length === 0) lines.push("(none)");
  for (const row of structure.manifestsPresent) lines.push(row);
  lines.push("");
  if (structure.packageJson) {
    lines.push("=== package.json scripts ===");
    lines.push(structure.packageJson.scripts || "(none)");
    lines.push("");
    lines.push("=== package.json dependencies ===");
    lines.push(structure.packageJson.dependencies || "(none)");
    lines.push("");
    lines.push("=== package.json devDependencies ===");
    lines.push(structure.packageJson.devDependencies || "(none)");
    lines.push("");
  }
  if (structure.readmeExcerpt) {
    lines.push("=== README.md (first 200 lines) ===");
    lines.push(structure.readmeExcerpt);
  }
  return lines.join("\n");
}