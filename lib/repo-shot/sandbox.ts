import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, type Server } from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import type { DetectedProject, RunningApp } from "./types";

const MAX_LINE = 500;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const STATIC_DIRS = ["public", "dist", "build", "src", "docs", "_site", "site"];
const LOOPBACK_HOSTS = ["127.0.0.1", "[::1]"];
const PORT_FLAGS: Record<string, (port: number) => string[]> = {
  next: (port) => ["-p", String(port)],
  vite: (port) => ["--port", String(port)],
  astro: (port) => ["--port", String(port)],
  "@sveltejs/kit": (port) => ["--port", String(port)],
  nuxt: (port) => ["--port", String(port)],
  gatsby: (port) => ["-p", String(port)],
  angular: (port) => ["--port", String(port)],
  "vue-cli-service": (port) => ["--port", String(port)],
  django: (port) => [`127.0.0.1:${port}`],
  uvicorn: (port) => ["--host", "127.0.0.1", "--port", String(port)],
};
const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

type Log = (line: string) => void;
type ProcessChild = ReturnType<typeof spawn>;
type CommandResult = { code: number; lines: string[]; timedOut: boolean; spawnError?: Error };

function cleanLine(line: string) {
  const stripped = line.replace(ANSI, "").replace(/\r/g, "").trimEnd();
  return stripped.length > MAX_LINE ? `${stripped.slice(0, MAX_LINE)}…` : stripped;
}

function makeLineSplitter(emit: Log) {
  let buffer = "";
  const push = (chunk: Buffer | string) => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      emit(cleanLine(buffer.slice(0, index)));
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
    }
    if (buffer.length > 8192) {
      emit(cleanLine(buffer));
      buffer = "";
    }
  };
  push.flush = () => {
    if (buffer.trim()) emit(cleanLine(buffer));
    buffer = "";
  };
  return push;
}

function scrubbedEnv(extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? os.homedir(),
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
    CI: "1",
    BROWSER: "none",
    FORCE_COLOR: "0",
    HOST: "127.0.0.1",
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "false",
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS: "true",
    ...extra,
    NODE_ENV: "development",
  };
}

function killGroup(child: ProcessChild) {
  if (child.killed || child.exitCode !== null || !child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const timer = setTimeout(() => {
    if (child.exitCode !== null) return;
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }, 3000);
  timer.unref();
  child.once("exit", () => clearTimeout(timer));
}

function splitCommand(command: string) {
  return command.trim().split(/\s+/).filter(Boolean);
}

async function binaryExists(file: string) {
  return await new Promise<boolean>((resolve) => {
    const useShell = isWindowsScript(file);
    const child = spawn(file, ["--version"], { stdio: "ignore", env: scrubbedEnv(), shell: useShell });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 2000);
    child.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function npmFallback(parts: string[]) {
  if (parts[0] === "yarn") {
    const script = parts[1] === "run" ? parts[2] : parts[1];
    if (!script || script === "install") return ["npm", "install", "--no-audit", "--no-fund"];
    return ["npm", "run", script];
  }
  if (parts.includes("install")) return ["npm", "install", "--no-audit", "--no-fund"];
  const script = parts[1] === "run" ? parts[2] : parts[1];
  return script ? ["npm", "run", script] : ["npm", "install", "--no-audit", "--no-fund"];
}

async function resolveCommand(parts: string[], onLog: Log) {
  if (!["pnpm", "yarn", "bun"].includes(parts[0])) return parts;
  if (await binaryExists(parts[0])) return parts;
  const fallback = npmFallback(parts);
  onLog(`${parts[0]} is unavailable; using "${fallback.join(" ")}"`);
  return fallback;
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isWindowsScript(file: string): boolean {
  return process.platform === "win32" && !/\.(exe|com)$/i.test(file);
}

async function getFreePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close(() => (port ? resolve(port) : reject(new Error("Could not allocate a free port"))));
    });
  });
}

function runCommand({ file, args, cwd, env, timeoutMs, onLog, label }: { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; onLog: Log; label: string }) {
  return new Promise<CommandResult>((resolve) => {
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
      if (lines.length > 400) lines.shift();
      if (line) onLog(line);
    };
    let child: ProcessChild;
    const useShell = isWindowsScript(file);
    try {
      child = spawn(file, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"], shell: useShell, windowsVerbatimArguments: false });
    } catch (error) {
      const spawnError = error instanceof Error ? error : new Error(String(error));
      log(`[${label}] failed to spawn: ${spawnError.message}`);
      resolve({ code: -1, lines, timedOut: false, spawnError });
      return;
    }

    const stdout = makeLineSplitter(log);
    const stderr = makeLineSplitter(log);
    if (child.stdout) child.stdout.on("data", stdout);
    if (child.stderr) child.stderr.on("data", stderr);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      log(`[${label}] timed out after ${timeoutMs}ms`);
      killGroup(child);
    }, timeoutMs);

    let settled = false;
    const finish = (code: number, spawnError?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stdout.flush();
      stderr.flush();
      resolve({ code, lines, timedOut, spawnError });
    };
    child.once("error", (error) => {
      log(`[${label}] spawn error: ${error.message}`);
      finish(-1, error instanceof Error ? error : new Error(String(error)));
    });
    child.once("close", (code, signal) => finish(code ?? (signal ? -1 : 0)));
  });
}

function tail(lines: string[], count = 20) {
  return lines.slice(-count).join("\n");
}

export function normalizeRepoUrl(input: string) {
  const raw = String(input ?? "").trim().replace(/\s+/g, "");
  if (!raw) throw new Error("repoUrl is required");
  if (raw.startsWith("-")) throw new Error(`Invalid repo URL: ${raw}`);
  if (/^git@/.test(raw) || /^(ssh|git|file):\/\//i.test(raw)) throw new Error("Only HTTP(S) repository URLs or owner/repo shorthand are supported");

  let candidate = raw;
  if (/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(candidate)) candidate = `https://github.com/${candidate}`;
  else if (/^(www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}\//.test(candidate)) candidate = `https://${candidate}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Invalid repo URL: ${raw}`);
  }
  if (!["https:", "http:"].includes(url.protocol)) throw new Error(`Unsupported protocol: ${url.protocol}`);
  if (url.username || url.password) throw new Error("Repository URLs with embedded credentials are not allowed");
  url.hash = "";
  url.search = "";

  let segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const cut = segments.findIndex((segment) => ["tree", "blob", "commit"].includes(segment));
  if (cut > 0) segments = segments.slice(0, cut);
  if (segments.length < 2) throw new Error(`Invalid repo URL: ${raw}`);
  const repoName = segments.at(-1)!.replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9._-]+$/.test(repoName)) throw new Error(`Invalid repository name: ${repoName}`);
  segments[segments.length - 1] = repoName;
  url.pathname = `/${segments.join("/")}`;
  return { url: url.toString(), repoName };
}

export async function cloneRepo(repoUrl: string, destination: string, onLog: Log, timeoutMs = 180000) {
  const normalized = normalizeRepoUrl(repoUrl);
  const dir = path.resolve(destination);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dir), { recursive: true });

  onLog(`$ git clone --depth 1 --single-branch ${normalized.url}`);
  const env = scrubbedEnv({ GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "/bin/true", GIT_LFS_SKIP_SMUDGE: "1" });
  const clone = await runCommand({
    file: "git",
    args: ["clone", "--depth", "1", "--single-branch", "--", normalized.url, dir],
    cwd: path.dirname(dir),
    env,
    timeoutMs,
    onLog,
    label: "clone",
  });
  if (clone.code !== 0) throw new Error(`git clone failed (exit ${clone.code})\n${tail(clone.lines)}`);

  const revision = await runCommand({ file: "git", args: ["rev-parse", "--short", "HEAD"], cwd: dir, env, timeoutMs: 20000, onLog: () => {}, label: "revision" });
  const sha = revision.code === 0 ? revision.lines.map((line) => line.trim()).filter((line) => /^[0-9a-f]{4,40}$/i.test(line)).at(-1) ?? "unknown" : "unknown";
  onLog(`cloned ${normalized.repoName} @ ${sha}`);
  return { dir, sha, repoName: normalized.repoName, repoUrl: normalized.url };
}

export async function installDependencies(dir: string, detected: DetectedProject, onLog: Log, timeoutMs = 240000) {
  if (!detected.needsInstall || !detected.installCmd) {
    onLog("install skipped");
    return { skipped: true };
  }

  const original = splitCommand(detected.installCmd);
  const parts = await resolveCommand(original, onLog);
  const env = scrubbedEnv({ npm_config_audit: "false", npm_config_fund: "false", ADBLOCK: "1" });
  onLog(`$ ${parts.join(" ")}`);
  let result = await runCommand({ file: parts[0], args: parts.slice(1), cwd: path.resolve(dir), env, timeoutMs, onLog, label: "install" });

  if (result.code !== 0 && parts[0] === "npm") {
    const fallbackArgs = ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"];
    onLog(`$ npm ${fallbackArgs.join(" ")}`);
    result = await runCommand({ file: "npm", args: fallbackArgs, cwd: path.resolve(dir), env, timeoutMs, onLog, label: "install" });
  }

  if (result.code !== 0 && !(await exists(path.join(dir, "node_modules")))) {
    throw new Error(`Install failed (exit ${result.code})\n${tail(result.lines)}`);
  }
  return { skipped: false };
}

function parsePorts(line: string) {
  const ports: number[] = [];
  for (const match of line.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/gi)) ports.push(Number(match[1]));
  const match = line.match(/(?:listening on|running (?:at|on)|server on)\D{0,20}?port\s*:?\s*(\d{2,5})/i);
  if (match) ports.push(Number(match[1]));
  return ports.filter((port) => port > 0 && port < 65536);
}

async function probeHost(host: string, port: number) {
  try {
    const response = await fetch(`http://${host}:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(2000) });
    return { status: response.status, host };
  } catch {
    return { status: 0, host };
  }
}

async function probe(port: number) {
  const results = await Promise.all(LOOPBACK_HOSTS.map((host) => probeHost(host, port)));
  return results.find((result) => result.status > 0 && result.status < 500) ?? results.sort((a, b) => b.status - a.status)[0];
}

async function resolveStaticFile(root: string, requestUrl: string) {
  let pathname = "/";
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://localhost").pathname);
  } catch {}
  const candidate = path.resolve(root, `.${pathname}`);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return null;
  const choices = [candidate, path.join(candidate, "index.html")];
  if (!path.extname(candidate)) choices.push(`${candidate}.html`);
  for (const choice of choices) {
    try {
      if ((await fs.stat(choice)).isFile()) return choice;
    } catch {}
  }
  return null;
}

async function startStatic(dir: string, detected: DetectedProject, onLog: Log): Promise<RunningApp> {
  const root = path.resolve(dir);
  const candidates = [detected.staticDir, ".", ...STATIC_DIRS].filter((value): value is string => Boolean(value));
  let staticDir: string | null = null;
  for (const rel of candidates) {
    const candidate = path.resolve(root, rel);
    if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) continue;
    if (await exists(path.join(candidate, "index.html"))) {
      staticDir = candidate;
      break;
    }
  }
  if (!staticDir) throw new Error("No index.html was found for the static project");

  const port = await getFreePort();
  const sockets = new Set<net.Socket>();
  const server = createServer(async (request, response) => {
    const filePath = await resolveStaticFile(staticDir!, request.url ?? "/");
    if (!filePath) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
    createReadStream(filePath).on("error", () => response.writeHead(500).end()).pipe(response);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await listen(server, port);
  const url = `http://127.0.0.1:${port}`;
  onLog(`static server ready at ${url}`);
  return { url, port, stop: () => stopServer(server, sockets) };
}

function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function stopServer(server: Server, sockets: Set<net.Socket>) {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

export async function startApp(dir: string, detected: DetectedProject, onLog: Log, timeoutMs = 120000): Promise<RunningApp> {
  if (detected.type === "static") return startStatic(dir, detected, onLog);
  if (detected.type === "unknown") throw new Error(`Cannot boot this repository: ${detected.notes}`);
  if (!detected.devCmd) throw new Error(`No development command detected: ${detected.notes}`);

  const cwd = path.resolve(dir);
  const requestedPort = await getFreePort();
  const parts = await resolveCommand(splitCommand(detected.devCmd), onLog);
  const args = parts.slice(1);
  const flags = PORT_FLAGS[detected.framework];
  if (flags) {
    if (parts[0] === "npm" && parts[1] === "run") args.push("--");
    args.push(...flags(requestedPort));
  }

  onLog(`$ ${[parts[0], ...args].join(" ")} (PORT=${requestedPort})`);
  const child = spawn(parts[0], args, {
    cwd,
    env: scrubbedEnv({ PORT: String(requestedPort), HOST: "127.0.0.1" }),
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindowsScript(parts[0]),
  });
  const lines: string[] = [];
  const seenPorts = new Set<number>();
  const record = (line: string) => {
    if (!line) return;
    lines.push(line);
    if (lines.length > 300) lines.shift();
    parsePorts(line).forEach((port) => seenPorts.add(port));
    onLog(line);
  };
  const stdout = makeLineSplitter(record);
  const stderr = makeLineSplitter(record);
  if (child.stdout) child.stdout.on("data", stdout);
  if (child.stderr) child.stderr.on("data", stderr);

  let exited = false;
  child.once("error", (error) => record(`[boot] ${error.message}`));
  child.once("exit", (code, signal) => {
    exited = true;
    stdout.flush();
    stderr.flush();
    record(`[boot] exited (code=${code} signal=${signal})`);
  });

  const stop = async () => {
    if (exited) return;
    killGroup(child);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3500);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const deadline = Date.now() + timeoutMs;
  let softResponse: { status: number; host: string; port: number } | null = null;
  try {
    while (Date.now() < deadline) {
      const candidates = [...new Set([requestedPort, ...seenPorts])];
      const results = await Promise.all(candidates.map(async (port) => ({ ...(await probe(port)), port })));
      const ready = results.find((result) => result.status > 0 && result.status < 500);
      if (ready) {
        const url = `http://${ready.host}:${ready.port}`;
        onLog(`app ready at ${url}`);
        return { url, port: ready.port, stop };
      }
      softResponse = results.find((result) => result.status >= 500) ?? softResponse;
      if (exited) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (softResponse) {
      const url = `http://${softResponse.host}:${softResponse.port}`;
      onLog(`app responded with HTTP ${softResponse.status}; capturing ${url}`);
      return { url, port: softResponse.port, stop };
    }
    throw new Error(`Boot failed after ${timeoutMs}ms\n${tail(lines)}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
