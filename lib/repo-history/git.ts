import { spawn } from "node:child_process";
import path from "node:path";

export type RunGitOptions = {
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  input?: string;
  /**
   * Hard cap on captured stdout. Once exceeded the child is killed and the
   * result is flagged `truncated`. Used by the patch reader, where output size
   * is unbounded in principle.
   */
  maxBytes?: number;
};

export type RunGitResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
};

const GIT_BIN = process.env.GIT_BIN ?? "git";

function quoteArg(value: string): string {
  if (value === "") return '""';
  if (/^[A-Za-z0-9_./:=@\-]+$/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

export function buildGitCommand(args: string[]): string {
  return [GIT_BIN, ...args.map(quoteArg)].join(" ");
}

export async function runGit(
  args: string[],
  options: RunGitOptions,
): Promise<RunGitResult> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(GIT_BIN, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    const maxBytes = options.maxBytes ?? Infinity;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length > maxBytes) {
        stdout = stdout.slice(0, maxBytes);
        truncated = true;
        child.kill();
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    if (options.input) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms in ${options.cwd}`));
        return;
      }
      resolve({ stdout, stderr, exitCode: truncated ? 0 : code ?? 0, truncated });
    });
  });
}

export function repoNameFromUrl(repoUrl: string): string {
  const cleaned = repoUrl.replace(/\.git$/i, "").replace(/\/+$/, "");
  const tail = cleaned.split("/").pop() ?? "repo";
  return path
    .basename(tail)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .slice(0, 80) || "repo";
}