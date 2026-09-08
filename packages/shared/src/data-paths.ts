import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function resolveDataDirectory(root: string): string {
  const current = join(root, ".zuvcode");
  const legacy = join(root, ".orvynx");
  // Reuse existing storage in place so credentials, backups and live SQLite locks stay intact.
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

export function resolveUserConfigDirectory(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const override = env["ZUVCODE_HOME"] || env["ORVYNX_HOME"];
  return override ? resolve(override) : resolveDataDirectory(home);
}
