import type { Browser } from "playwright";

export const VIEWPORT_PRESETS = {
  desktop: { name: "desktop", width: 1440, height: 900, deviceScaleFactor: 2 },
  laptop: { name: "laptop", width: 1280, height: 800, deviceScaleFactor: 2 },
  mobile: { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3 },
} as const;

export const THEMES = {
  sunset: {
    name: "sunset",
    accent: "#ffc978",
    bg: "radial-gradient(118% 82% at 4% -8%, rgba(255,206,120,.95) 0%, rgba(255,206,120,0) 52%),radial-gradient(102% 80% at 98% 4%, rgba(255,64,129,.9) 0%, rgba(255,64,129,0) 55%),radial-gradient(112% 92% at 50% 120%, rgba(74,18,124,.95) 0%, rgba(74,18,124,0) 58%),linear-gradient(150deg, #ff8a3d 0%, #e0245e 48%, #45136b 100%)",
  },
  ocean: {
    name: "ocean",
    accent: "#6ff2ee",
    bg: "radial-gradient(112% 80% at 2% -6%, rgba(110,244,242,.8) 0%, rgba(110,244,242,0) 52%),radial-gradient(104% 82% at 99% 10%, rgba(38,99,255,.85) 0%, rgba(38,99,255,0) 56%),radial-gradient(124% 96% at 50% 122%, rgba(2,12,42,.95) 0%, rgba(2,12,42,0) 58%),linear-gradient(155deg, #0aa7c2 0%, #1552c9 50%, #061838 100%)",
  },
  aurora: {
    name: "aurora",
    accent: "#68ffbe",
    bg: "radial-gradient(106% 74% at 10% -8%, rgba(88,255,190,.8) 0%, rgba(88,255,190,0) 52%),radial-gradient(106% 78% at 94% 0%, rgba(166,110,255,.82) 0%, rgba(166,110,255,0) 56%),radial-gradient(124% 96% at 44% 120%, rgba(0,190,225,.55) 0%, rgba(0,190,225,0) 58%),linear-gradient(165deg, #0a4a41 0%, #082644 52%, #050813 100%)",
  },
  mono: {
    name: "mono",
    accent: "#5b6472",
    light: true,
    bg: "radial-gradient(106% 80% at 10% -6%, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 55%),radial-gradient(96% 74% at 94% 6%, rgba(204,212,224,.95) 0%, rgba(204,212,224,0) 58%),radial-gradient(132% 100% at 50% 120%, rgba(118,130,150,.7) 0%, rgba(118,130,150,0) 62%),linear-gradient(160deg, #f8f9fb 0%, #dde1e9 52%, #b7bfcc 100%)",
  },
  midnight: {
    name: "midnight",
    accent: "#8f9bff",
    bg: "radial-gradient(96% 64% at 12% -10%, rgba(96,110,255,.5) 0%, rgba(96,110,255,0) 56%),radial-gradient(88% 62% at 90% -2%, rgba(226,72,240,.3) 0%, rgba(226,72,240,0) 58%),radial-gradient(132% 96% at 50% 122%, rgba(18,28,84,.75) 0%, rgba(18,28,84,0) 58%),linear-gradient(170deg, #121634 0%, #080a12 52%, #121527 100%)",
  },
} as const;

export type ViewportName = keyof typeof VIEWPORT_PRESETS;
export type ThemeName = keyof typeof THEMES;
export type RepoShotStage = "clone" | "detect" | "install" | "boot" | "capture" | "frame";
export type ProjectType = "node" | "static" | "python" | "unknown";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type Viewport = {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
};

export type DetectedProject = {
  type: ProjectType;
  framework: string;
  pkgManager: PackageManager | null;
  installCmd: string | null;
  devCmd: string | null;
  port: number;
  needsInstall: boolean;
  notes: string;
  staticDir: string | null;
};

export type RepoShot = {
  id: string;
  route: string;
  viewport: string;
  width: number;
  height: number;
  rawPath: string;
  framedPath: string | null;
};

export type RepoShotStep = {
  name: RepoShotStage;
  status: "pending" | "running" | "done" | "skipped" | "error";
  ms: number;
  detail: string;
};

export type RepoShotInput = {
  repoUrl: string;
  routes?: string[];
  viewports?: ViewportName[];
  theme?: ThemeName;
  title?: string;
};

export type RepoShotOptions = {
  outputRoot?: string;
  workRoot?: string;
  cloneTimeoutMs?: number;
  installTimeoutMs?: number;
  bootTimeoutMs?: number;
  navigationTimeoutMs?: number;
  settleMs?: number;
  captureConcurrency?: number;
  frameConcurrency?: number;
  browser?: Browser;
  skipCloneFrom?: string;
  repoName?: string;
  onLog?: (line: string) => void;
  onStep?: (step: RepoShotStep) => void;
};

export type RepoShotResult = {
  id: string;
  repoUrl: string;
  repoName: string;
  sha: string;
  title: string;
  theme: ThemeName;
  routes: string[];
  viewports: ViewportName[];
  outputDir: string;
  detected: DetectedProject;
  shots: RepoShot[];
  steps: RepoShotStep[];
  logs: string[];
  createdAt: string;
  finishedAt: string;
};

export type RunningApp = {
  url: string;
  port: number;
  stop: () => Promise<void>;
};
