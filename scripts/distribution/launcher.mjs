import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const metadata = JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(metadata.version)) throw new Error("Invalid ZuvCode installation. Run the installer again.");
const manual = process.argv[2] === "update";
const quiet = !manual;
const checkFile = join(root, "last-update-check.json");
let lastCheck = 0;
try { lastCheck = JSON.parse(readFileSync(checkFile, "utf8")).time; } catch { /* First launch or interrupted check. */ }
const now = Date.now();
if (manual || (process.env.ZUVCODE_AUTO_UPDATE !== "0" && (!Number.isFinite(lastCheck) || now < lastCheck || now - lastCheck > 15 * 60_000))) {
  try {
    writeFileSync(checkFile, JSON.stringify({ time: now }));
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(root, "versions", metadata.version, "install.ps1"), "-InstallRoot", root, "-NoPath", ...(quiet ? ["-Quiet"] : [])],
    { windowsHide: true, stdio: manual ? "inherit" : "pipe", timeout: 180_000, encoding: "utf8" });
    if (result.status !== 0 || result.error) {
      if (manual) process.exitCode = 1;
      else console.error("ZuvCode update unavailable; continuing with the installed version. Retry with zuv update.");
    }
  } catch {
    if (manual) { console.error("ZuvCode could not update. Run the installer again."); process.exitCode = 1; }
  }
}
if (!manual) {
  const current = JSON.parse(readFileSync(join(root, "current.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(current.version) || !existsSync(current.nodePath)) throw new Error("Invalid ZuvCode installation.");
  const entry = join(root, "versions", current.version, "app", "index.js");
  const environment = { ...process.env, ZUVCODE_VERSION: current.version };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") || "PATH";
  environment[pathKey] = `${dirname(current.nodePath)}${delimiter}${environment[pathKey] || ""}`;
  const child = spawnSync(current.nodePath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(), stdio: "inherit", windowsHide: true,
    env: environment
  });
  if (child.error) console.error(child.error.message);
  process.exitCode = child.status ?? 1;
}
