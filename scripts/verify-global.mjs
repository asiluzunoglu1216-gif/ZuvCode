import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = mkdtempSync(join(tmpdir(), "zuvcode global test "));
try {
  for (const command of ["zuvcode", "zuv"]) {
    const result = spawnSync(process.platform === "win32" ? "cmd.exe" : command,
      process.platform === "win32" ? ["/d", "/s", "/c", `${command} doctor`] : ["doctor"],
      { cwd: root, encoding: "utf8", windowsHide: true, env: { ...process.env, ZUVCODE_HOME: join(root, "user-config") } });
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
    assert.ok(result.stdout.includes(root), "The active project must be the launch directory.");
    assert.ok(result.stdout.includes("ZuvCode DOCTOR"), "The command must run the renamed application.");
    console.log(`Global ${command} command passed in an unrelated temporary directory with spaces.`);
  }
} finally { rmSync(root, { recursive: true, force: true }); }
