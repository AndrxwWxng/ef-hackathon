import fs from "node:fs/promises";
import path from "node:path";

import type { DetectedProject, PackageManager } from "./types";

const STATIC_DIRS = [".", "public", "dist", "src", "docs", "build", "_site", "site"];
const SCRIPT_ORDER = ["dev", "start", "serve", "preview"];
const FRAMEWORKS = [
  { name: "next", port: 3000, deps: ["next"] },
  { name: "nuxt", port: 3000, deps: ["nuxt", "nuxt3", "nuxt-edge"] },
  { name: "@sveltejs/kit", port: 5173, deps: ["@sveltejs/kit"] },
  { name: "astro", port: 4321, deps: ["astro"] },
  { name: "remix", port: 3000, deps: ["@remix-run/dev", "@remix-run/serve", "@remix-run/react", "remix"] },
  { name: "gatsby", port: 8000, deps: ["gatsby"] },
  { name: "react-scripts", port: 3000, deps: ["react-scripts"] },
  { name: "vue-cli-service", port: 8080, deps: ["@vue/cli-service"] },
  { name: "angular", port: 4200, deps: ["@angular/cli", "@angular/core"] },
  { name: "vite", port: 5173, deps: ["vite"] },
];

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readText(filePath: string) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function hasEntries(dir: string) {
  try {
    return (await fs.readdir(dir)).length > 0;
  } catch {
    return false;
  }
}

async function detectPackageManager(dir: string): Promise<PackageManager> {
  if (await exists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(dir, "yarn.lock"))) return "yarn";
  if (await exists(path.join(dir, "bun.lockb"))) return "bun";
  if (await exists(path.join(dir, "bun.lock"))) return "bun";
  return "npm";
}

async function installCommand(dir: string, manager: PackageManager) {
  if (manager === "pnpm") return "pnpm install --frozen-lockfile";
  if (manager === "yarn") return "yarn install --frozen-lockfile";
  if (manager === "bun") return "bun install --frozen-lockfile";
  if (await exists(path.join(dir, "package-lock.json"))) return "npm ci --no-audit --no-fund";
  return "npm install --no-audit --no-fund";
}

function runCommand(manager: PackageManager, script: string) {
  if (manager === "pnpm") return `pnpm run ${script}`;
  if (manager === "yarn") return `yarn ${script}`;
  if (manager === "bun") return `bun run ${script}`;
  return `npm run ${script}`;
}

function base(overrides: Partial<DetectedProject> = {}): DetectedProject {
  return {
    type: "unknown",
    framework: "unknown",
    pkgManager: null,
    installCmd: null,
    devCmd: null,
    port: 0,
    needsInstall: false,
    notes: "",
    staticDir: null,
    ...overrides,
  };
}

async function findStaticDir(dir: string) {
  const root = path.resolve(dir);
  for (const rel of STATIC_DIRS) {
    const candidate = path.resolve(root, rel);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) continue;
    if (await exists(path.join(candidate, "index.html"))) return rel;
  }
  return null;
}

function portFromScript(script: string, fallback: number) {
  const match = script.match(/(?:--port[= ]|-p[= ])(\d{2,5})/);
  const port = match ? Number(match[1]) : fallback;
  return port > 0 && port < 65536 ? port : fallback;
}

async function detectPython(dir: string): Promise<DetectedProject | null> {
  const hasRequirements = await exists(path.join(dir, "requirements.txt"));
  const hasPyproject = await exists(path.join(dir, "pyproject.toml"));
  if (!hasRequirements && !hasPyproject) return null;

  const hasManage = await exists(path.join(dir, "manage.py"));
  const hasApp = await exists(path.join(dir, "app.py"));
  const hasMain = await exists(path.join(dir, "main.py"));
  if (!hasManage && !hasApp && !hasMain) return null;

  const manifest = `${hasRequirements ? await readText(path.join(dir, "requirements.txt")) : ""}\n${hasPyproject ? await readText(path.join(dir, "pyproject.toml")) : ""}`.toLowerCase();
  let framework = "python";
  let devCmd: string | null = null;

  if (hasManage) {
    framework = "django";
    devCmd = "python3 manage.py runserver";
  } else if (hasMain && (manifest.includes("uvicorn") || manifest.includes("fastapi"))) {
    framework = "uvicorn";
    devCmd = "python3 -m uvicorn main:app";
  } else if (hasApp) {
    framework = manifest.includes("flask") ? "flask" : "python";
    devCmd = "python3 app.py";
  } else if (hasMain) {
    devCmd = "python3 main.py";
  }

  return base({
    type: "python",
    framework,
    installCmd: hasRequirements ? "pip3 install -r requirements.txt" : null,
    devCmd,
    port: 8000,
    needsInstall: hasRequirements,
    notes: `Python project (${framework}); best-effort boot with "${devCmd}".`,
  });
}

export async function detectProject(dir: string): Promise<DetectedProject> {
  try {
    const root = path.resolve(dir);
    if (!(await exists(root))) return base({ notes: `Directory not found: ${root}` });

    const pkg = await readJson(path.join(root, "package.json"));
    if (pkg) {
      const dependencies = typeof pkg.dependencies === "object" && pkg.dependencies ? pkg.dependencies : {};
      const devDependencies = typeof pkg.devDependencies === "object" && pkg.devDependencies ? pkg.devDependencies : {};
      const deps = { ...dependencies, ...devDependencies } as Record<string, unknown>;
      const scripts = typeof pkg.scripts === "object" && pkg.scripts ? (pkg.scripts as Record<string, unknown>) : {};
      const pkgManager = await detectPackageManager(root);
      const framework = FRAMEWORKS.find((item) => item.deps.some((dep) => dep in deps));
      const scriptName = SCRIPT_ORDER.find((name) => typeof scripts[name] === "string" && scripts[name].trim());

      if (scriptName) {
        const script = String(scripts[scriptName]);
        const installed = await hasEntries(path.join(root, "node_modules"));
        return base({
          type: "node",
          framework: framework?.name ?? "unknown",
          pkgManager,
          installCmd: await installCommand(root, pkgManager),
          devCmd: runCommand(pkgManager, scriptName),
          port: portFromScript(script, framework?.port ?? 3000),
          needsInstall: Object.keys(deps).length > 0 && !installed,
          notes: `Node project${framework ? ` (${framework.name})` : ""} — script "${scriptName}": ${script} — package manager: ${pkgManager}`,
        });
      }

      const staticDir = await findStaticDir(root);
      if (staticDir) {
        return base({
          type: "static",
          framework: "static",
          pkgManager,
          staticDir,
          notes: `package.json has no runnable script; serving static files from "${staticDir}".`,
        });
      }

      return base({
        type: "node",
        framework: framework?.name ?? "unknown",
        pkgManager,
        installCmd: await installCommand(root, pkgManager),
        devCmd: null,
        port: framework?.port ?? 3000,
        notes: "package.json found but no runnable script or index.html was found.",
      });
    }

    const staticDir = await findStaticDir(root);
    if (staticDir) return base({ type: "static", framework: "static", staticDir, notes: `Serving static files from "${staticDir}".` });

    return (await detectPython(root)) ?? base({ notes: "No runnable Node, static, or Python project was detected." });
  } catch (error) {
    return base({ notes: `Detection failed: ${error instanceof Error ? error.message : String(error)}` });
  }
}
