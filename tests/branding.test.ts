import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createSilentLogger, resolveDataDirectory, resolveUserConfigDirectory } from "@zuvcode/shared";
import { StateStore } from "@zuvcode/persistence";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { PermissionEngine } from "@zuvcode/permissions";
import { banner, helpText } from "@zuvcode/terminal-ui";
import { renderWordmark } from "../packages/terminal-ui/dist/wordmark.js";
import { UserConfigStore } from "../packages/providers/dist/index.js";
import { ProjectMemory } from "../packages/memory/dist/index.js";
import { SkillLoader } from "../packages/skills/dist/index.js";
import { FileHistory, ProjectFiles } from "../packages/tools/dist/index.js";

const roots: string[] = [];
function workspace(): string {
  const parent = join(process.cwd(), ".tmp-tests");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "branding-"));
  roots.push(root);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("ZuvCode branding and existing installations", () => {
  it("uses the new package names and both new commands", () => {
    const app = JSON.parse(readFileSync("apps/cli/package.json", "utf8"));
    const launcher = JSON.parse(readFileSync("scripts/launcher/package.json", "utf8"));
    expect(app.name).toBe("@zuvcode/cli");
    expect(app.bin).toEqual({ zuvcode: "./dist/index.js", zuv: "./dist/index.js" });
    expect(launcher.name).toBe("zuvcode-local-cli");
    expect(launcher.bin).toEqual({ zuvcode: "zuvcode.mjs", zuv: "zuvcode.mjs" });
    expect(banner()).toContain("ZuvCode  v0.1.0");
    expect(helpText()).toContain("Close ZuvCode");
    expect(helpText()).not.toMatch(/orvynx/i);
  });

  it("renders all seven logo letters without wrapping at any terminal width", () => {
    expect(stripVTControlCharacters(renderWordmark(20))).toBe("ZuvCode");
    for (let width = 1; width <= 160; width++) {
      const lines = stripVTControlCharacters(renderWordmark(width)).split("\n");
      expect(lines.every((line) => line.length <= width), `width ${width}`).toBe(true);
      if (width >= 30) expect(lines.join("")).toContain("\u2588");
    }
    const top = ["11111", "10001", "10001", "01111", "01110", "11110", "11111"].join("0");
    expect(stripVTControlCharacters(renderWordmark(60)).split("\n")[0]).toBe("  " + top.replace(/1/g, "\u2588").replace(/0/g, " "));
    expect(stripVTControlCharacters(renderWordmark(42)).split("\n")).toHaveLength(6);
    expect(stripVTControlCharacters(renderWordmark(100)).split("\n")).toHaveLength(8);
  });

  it("defaults to new storage, reuses legacy storage, and honors explicit home precedence", () => {
    const root = workspace();
    expect(resolveDataDirectory(root)).toBe(join(root, ".zuvcode"));
    expect(resolveUserConfigDirectory({}, root)).toBe(join(root, ".zuvcode"));
    mkdirSync(join(root, ".orvynx"));
    expect(resolveDataDirectory(root)).toBe(join(root, ".orvynx"));
    expect(resolveUserConfigDirectory({}, root)).toBe(join(root, ".orvynx"));
    mkdirSync(join(root, ".zuvcode"));
    expect(resolveDataDirectory(root)).toBe(join(root, ".zuvcode"));
    expect(resolveUserConfigDirectory({ ORVYNX_HOME: "legacy-home" }, root)).toBe(resolve("legacy-home"));
    expect(resolveUserConfigDirectory({ ORVYNX_HOME: "legacy-home", ZUVCODE_HOME: "new-home" }, root)).toBe(resolve("new-home"));
  });

  it("reopens existing tasks, memories and skills in place and shares the execution lock", () => {
    const root = workspace();
    mkdirSync(join(root, ".orvynx", "skills", "existing"), { recursive: true });
    writeFileSync(join(root, ".orvynx", "skills", "existing", "SKILL.md"), "Existing skill");
    const before = new StateStore({ projectRoot: root, logger: createSilentLogger() });
    before.initialize();
    const task = before.createTask({ title: "Existing task", description: "Keep this", status: "queued" });
    const memory = new ProjectMemory(root);
    memory.ensureBaseFiles(); memory.append("preferences", "Existing preference", "Keep the user's settings");
    before.acquireExecutionLock("existing-process");
    const after = new StateStore({ projectRoot: root, logger: createSilentLogger() });
    try {
      after.initialize();
      expect(after.dbPath).toBe(join(root, ".orvynx", "state.db"));
      expect(after.getTask(task.id)?.title).toBe("Existing task");
      expect(new ProjectMemory(root).read("preferences")).toContain("Existing preference");
      expect(new SkillLoader(root).listProjectSkills()[0]?.instructions).toBe("Existing skill");
      expect(() => after.acquireExecutionLock("new-process")).toThrow("Another ZuvCode operation");
      expect(existsSync(join(root, ".zuvcode"))).toBe(false);
    } finally { before.releaseExecutionLock("existing-process"); before.close(); after.close(); }
  });

  it("keeps encrypted provider credentials and selected models usable across project folders", () => {
    const root = workspace();
    const oldHome = join(root, ".orvynx");
    const first = ZuvCodeRuntime.silent({ projectRoot: join(root, "first"), userConfigDir: oldHome });
    const key = "fixture-only-rename-secret";
    const provider = first.addProvider({ kind: "google", apiKey: key });
    new UserConfigStore(oldHome).selectModel("Google Gemini/gemini-fixture");
    first.close();
    const originalCredentials = readFileSync(join(oldHome, "credentials.json"));
    const resolved = resolveUserConfigDirectory({}, root);
    const second = ZuvCodeRuntime.silent({ projectRoot: join(root, "second"), userConfigDir: resolved });
    try {
      expect(second.selectedModel()).toBe("Google Gemini/gemini-fixture");
      expect(second.configuredProviders().some((item) => item.id === provider.id)).toBe(true);
      expect(new UserConfigStore(resolved).loadSecret(provider.apiKeySession!)).toBe(key);
      expect(readFileSync(join(oldHome, "credentials.json"))).toEqual(originalCredentials);
      expect(existsSync(join(root, ".zuvcode"))).toBe(false);
    } finally { second.close(); }
  });

  it.each([".zuvcode", ".orvynx"])("retains %s backups and blocks agent access to both storage names", async (directory) => {
    const root = workspace();
    mkdirSync(join(root, directory));
    writeFileSync(join(root, "app.txt"), "original");
    const history = new FileHistory(root);
    const checkpoint = await history.capture("Before rename");
    expect(history.directory).toBe(join(root, directory, "file-history"));
    const restarted = new FileHistory(root);
    expect((await restarted.list()).some((record) => record.id === checkpoint.id)).toBe(true);
    const recovered = await restarted.recover(checkpoint.id);
    expect(recovered.startsWith(join(root, directory, "recovered"))).toBe(true);
    expect(readFileSync(join(recovered, "app.txt"), "utf8")).toBe("original");
    const files = new ProjectFiles(root, new PermissionEngine({ mode: "FULL_ACCESS" }));
    for (const folder of [".zuvcode", ".orvynx"]) {
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, folder, "private.txt"), "private runtime state");
      await expect(files.read(`${folder}/private.txt`)).rejects.toThrow("cannot be accessed");
      await expect(files.write(`${folder}/private.txt`, "overwrite", async () => undefined)).rejects.toThrow("cannot be accessed");
    }
    expect((await restarted.capture("After rename")).files.map((file) => file.path)).toEqual(["app.txt"]);
    expect((await files.list()).files).toEqual(["app.txt"]);
  });

  it.each(["zuvcode.mjs", "orvynx.mjs"])("opens the new CLI through %s without changing the launch directory", (entry) => {
    const root = workspace();
    const result = spawnSync(process.execPath, [resolve("scripts/launcher", entry), "doctor"], {
      cwd: root, encoding: "utf8", windowsHide: true,
      env: { ...process.env, ZUVCODE_HOME: join(root, "isolated-home") }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("ZuvCode DOCTOR");
    expect(result.stdout).toContain(root);
    expect(existsSync(join(root, ".zuvcode", "state.db"))).toBe(true);
  });
});
