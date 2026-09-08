import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const result = spawnSync(windows ? "cmd.exe" : "npm",
  windows ? ["/d", "/s", "/c", "npm link --offline --ignore-scripts --no-audit --no-fund"]
    : ["link", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
  { cwd: fileURLToPath(new URL("./launcher/", import.meta.url)), stdio: "inherit", windowsHide: true });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
if (result.status === 0) console.log("ZuvCode installed. Run zuv or zuvcode from any project directory.");
