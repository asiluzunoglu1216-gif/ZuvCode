import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PermissionEngine } from "@zuvcode/permissions";
import { AgentTools, FileHistory, assertCommandSafety } from "../packages/tools/dist/index.js";

function fixture() {
  mkdirSync(".tmp-tests", { recursive: true });
  const base = mkdtempSync(join(process.cwd(), ".tmp-tests", "history-"));
  const root = join(base, "project"); mkdirSync(root);
  const history = FileHistory.forUser(root, join(base, "home"));
  const tools = new AgentTools(root, new PermissionEngine({ mode: "FULL_ACCESS" }), undefined, history);
  const execute = (name: string, args: unknown, signal?: AbortSignal) => tools.execute({ id: "test", name, argumentsJson: JSON.stringify(args) }, {}, signal);
  return { base, root, history, tools, execute, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

describe("durable file recovery", () => {
  it("keeps preimages and created/edited versions across restart, exporting without changing user edits", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, "index.html"), "user original");
      await c.execute("read_file", { path: "index.html" });
      expect((await c.execute("edit_file", { path: "index.html", old_text: "original", new_text: "edited" })).ok).toBe(true);
      await c.execute("write_file", { path: "test.js", content: "test code" });
      writeFileSync(join(c.root, "index.html"), "user later edit");
      const restarted = FileHistory.forUser(c.root, join(c.base, "home"));
      writeFileSync(join(c.history.directory, "records", ".pending-interrupted-write"), "{partial");
      const records = await restarted.list();
      expect(records.some((r) => r.reason === "After file edit" && r.files.some((f) => f.path === "test.js"))).toBe(true);
      const before = records.find((r) => r.reason === "Before file edit" && r.files.some((f) => f.path === "index.html"))!;
      const output = await restarted.recover(before.id.slice(0, 8));
      expect(readFileSync(join(output, "index.html"), "utf8")).toBe("user original");
      expect(readFileSync(join(c.root, "index.html"), "utf8")).toBe("user later edit");
      expect(readFileSync(join(c.root, "test.js"), "utf8")).toBe("test code");
      expect(await restarted.recover(before.id)).not.toBe(output);
    } finally { c.cleanup(); }
  });

  it("blocks the reported Node cleanup and broad Chrome shutdown before Full Access can execute them", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, "test-eval.js"), "preserve");
      for (const command of ["node -e \"require('fs').unlinkSync('test-eval.js')\"", "Remove-Item -Recurse src", "rm -rf src", "git clean -fdx", "git reset --hard", "node -e \"require('child_process').execSync('Get-Process chrome | Stop-Process')\"", "taskkill /IM chrome.exe /F"]) {
        expect(await c.execute("run_command", { command })).toMatchObject({ ok: false, errorKind: "safety" });
      }
      expect(readFileSync(join(c.root, "test-eval.js"), "utf8")).toBe("preserve");
      expect(() => assertCommandSafety("node --check src/index.js")).not.toThrow();
      expect(() => assertCommandSafety("npm test")).not.toThrow();
      expect(() => assertCommandSafety("npm run build")).not.toThrow();
    } finally { c.cleanup(); }
  });

  it.each([0, 7])("restores files deleted indirectly by a script, including nonzero exit %s, while preserving new and modified work", async (exit) => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, "keep.txt"), "original");
      writeFileSync(join(c.root, "edit.txt"), "before");
      writeFileSync(join(c.root, "check.cjs"), `const fs=require('fs'); fs.unlinkSync('keep.txt'); fs.writeFileSync('edit.txt','after'); fs.writeFileSync('new.txt','new work'); process.exit(${exit});`);
      const result = await c.execute("run_command", { command: "node check.cjs" });
      expect(result).toMatchObject({ ok: false, errorKind: exit ? "operation" : "safety", output: { exitCode: exit } });
      expect(result.error).toContain("restored 1 deleted project files");
      expect(readFileSync(join(c.root, "keep.txt"), "utf8")).toBe("original");
      expect(readFileSync(join(c.root, "edit.txt"), "utf8")).toBe("after");
      expect(readFileSync(join(c.root, "new.txt"), "utf8")).toBe("new work");
      const latest = (await c.history.list()).find((r) => r.reason === "After shell command")!;
      expect(latest.files.map((f) => f.path)).toContain("new.txt");
    } finally { c.cleanup(); }
  });

  it("waits for recovery when a deleting command is cancelled", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, "keep.txt"), "original");
      writeFileSync(join(c.root, "check.cjs"), "require('fs').unlinkSync('keep.txt'); setInterval(()=>{},1000);");
      const controller = new AbortController();
      const job = c.execute("run_command", { command: "node check.cjs" }, controller.signal);
      const rejection = expect(job).rejects.toThrow("cancel test");
      await vi.waitFor(() => expect(existsSync(join(c.root, "keep.txt"))).toBe(false), { timeout: 10000 });
      controller.abort(new Error("cancel test"));
      await rejection;
      expect(readFileSync(join(c.root, "keep.txt"), "utf8")).toBe("original");
    } finally { c.cleanup(); }
  }, 15000);

  it("keeps non-repository git status as a diagnostic without pretending that the command succeeded", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, ".git"), "gitdir: missing-repository\n");
      const result = await c.execute("run_command", { command: "git status" });
      expect(result).toMatchObject({ ok: false, errorKind: "diagnostic", output: { exitCode: 128 } });
      expect(result.error).toContain("Do not initialize or reset Git");
    } finally { c.cleanup(); }
  });

  it("recovers after timeout and leaves new files from the timed-out command intact", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, "keep.txt"), "original");
      writeFileSync(join(c.root, "check.cjs"), "const fs=require('fs'); fs.unlinkSync('keep.txt'); fs.writeFileSync('new.txt','partial work'); setInterval(()=>{},1000);");
      const result = await c.execute("run_command", { command: "node check.cjs", timeout_ms: 2000 });
      expect(result).toMatchObject({ ok: false, errorKind: "operation", output: { timedOut: true } });
      expect(readFileSync(join(c.root, "keep.txt"), "utf8")).toBe("original");
      expect(readFileSync(join(c.root, "new.txt"), "utf8")).toBe("partial work");
    } finally { c.cleanup(); }
  }, 10000);

  it("never follows recovery symlinks, overwrites existing files or accepts traversal/corrupt blobs", async () => {
    const c = fixture();
    try {
      mkdirSync(join(c.root, "src"));
      writeFileSync(join(c.root, "src", "app.js"), "user work");
      const record = await c.history.capture("Test");
      writeFileSync(join(c.root, "src", "app.js"), "later work");
      expect(await c.history.restoreMissing(record)).toEqual([]);
      expect(readFileSync(join(c.root, "src", "app.js"), "utf8")).toBe("later work");
      await expect(c.history.restoreMissing({ ...record, files: [{ ...record.files[0]!, path: "../outside.txt" }] })).rejects.toThrow("Unsafe");
      const outside = join(c.base, "outside"); mkdirSync(outside);
      rmSync(join(c.root, "src"), { recursive: true });
      symlinkSync(outside, join(c.root, "src"), process.platform === "win32" ? "junction" : "dir");
      await expect(c.history.restoreMissing(record)).rejects.toThrow("Linked");
      expect(existsSync(join(outside, "app.js"))).toBe(false);
      writeFileSync(join(c.history.directory, "objects", record.files[0]!.hash), "corrupt");
      await expect(c.history.recover(record.id)).rejects.toThrow("Corrupt");
    } finally { c.cleanup(); }
  });

  it("excludes credentials/generated folders, rejects backup overflow before command execution, and protects history from file tools", async () => {
    const c = fixture();
    try {
      writeFileSync(join(c.root, ".env"), "secret");
      mkdirSync(join(c.root, "node_modules")); writeFileSync(join(c.root, "node_modules", "package.js"), "generated");
      writeFileSync(join(c.root, "source.js"), "source");
      expect((await c.history.capture("Test")).files.map((f) => f.path)).toEqual(["source.js"]);
      expect((await c.execute("read_file", { path: join(c.history.directory, "records", "anything.json") })).error).toContain("cannot be accessed");
      writeFileSync(join(c.root, "large.bin"), Buffer.alloc(8 * 1024 * 1024 + 1));
      const result = await c.execute("run_command", { command: "node -e \"require('fs').writeFileSync('not-run.txt','bad')\"" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("backup limit");
      expect(existsSync(join(c.root, "not-run.txt"))).toBe(false);
    } finally { c.cleanup(); }
  });

  it("does not back up a custom credential directory nested inside the working project", async () => {
    const c = fixture();
    try {
      const home = join(c.root, "settings"); mkdirSync(home);
      writeFileSync(join(home, "config.json"), "private credentials");
      writeFileSync(join(c.root, "app.js"), "source");
      const history = FileHistory.forUser(c.root, home);
      expect((await history.capture("Test")).files.map((f) => f.path)).toEqual(["app.js"]);
    } finally { c.cleanup(); }
  });
});
