import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { execFileSync } from "node:child_process";

export interface ProjectSnapshot {
  rootPath: string;
  name: string;
  hasGit: boolean;
  gitBranch?: string;
  gitDirty: boolean;
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  hasTypeScript: boolean;
  files: string[];
}

export function detectProject(rootPath: string): ProjectSnapshot {
  const files = safeList(rootPath);
  const snapshot: ProjectSnapshot = {
    rootPath,
    name: detectName(rootPath),
    hasGit: existsSync(join(rootPath, ".git")),
    gitDirty: false,
    hasTypeScript: existsSync(join(rootPath, "tsconfig.json")) || existsSync(join(rootPath, "tsconfig.base.json")),
    files
  };

  const packageManager = detectPackageManager(rootPath);
  if (packageManager !== undefined) {
    snapshot.packageManager = packageManager;
  }

  if (snapshot.hasGit) {
    const branch = safeGit(rootPath, ["branch", "--show-current"]).trim();
    if (branch.length > 0) {
      snapshot.gitBranch = branch;
    }
    snapshot.gitDirty = safeGit(rootPath, ["status", "--short"]).trim().length > 0;
  }

  return snapshot;
}

function detectName(rootPath: string): string {
  const packageJsonPath = join(rootPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const json = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
      if (typeof json.name === "string" && json.name.length > 0) {
        return json.name;
      }
    } catch {
      return basename(rootPath);
    }
  }

  return basename(rootPath);
}

function detectPackageManager(rootPath: string): ProjectSnapshot["packageManager"] | undefined {
  if (existsSync(join(rootPath, "pnpm-lock.yaml")) || existsSync(join(rootPath, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(rootPath, "package-lock.json"))) {
    return "npm";
  }
  if (existsSync(join(rootPath, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(rootPath, "bun.lockb")) || existsSync(join(rootPath, "bun.lock"))) {
    return "bun";
  }

  return undefined;
}

function safeList(rootPath: string): string[] {
  try {
    return readdirSync(rootPath).filter((name) => !["node_modules", ".git", "dist"].includes(name));
  } catch {
    return [];
  }
}

function safeGit(rootPath: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000
    });
  } catch {
    return "";
  }
}

