import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PermissionEngine } from "@zuvcode/permissions";
import { AgentTools, ProjectFiles, isPublicAddress, validateWebUrl, parseSearchHtml, extractWebPage, WebTools, runCommand } from "../packages/tools/dist/index.js";
import type { AgentCallbacks } from "../packages/protocol/dist/index.js";

function workspace() {
  mkdirSync(".tmp-tests", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "agent-tools-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("coding tools", () => {
  it("creates nested files, reads them, and edits a unique exact fragment", async () => {
    const { root, cleanup } = workspace();
    const files = new ProjectFiles(root, new PermissionEngine({ mode: "BALANCED" }));
    try {
      const authorize = async () => undefined;
      await files.write("site/index.html", "<h1>Hello</h1>\n<p>Original</p>", authorize);
      expect(await files.read("site/index.html")).toMatchObject({ totalLines: 2 });
      await files.edit("site/index.html", "Hello", "$& ZuvCode", authorize);
      expect(readFileSync(join(root, "site/index.html"), "utf8")).toBe("<h1>$& ZuvCode</h1>\n<p>Original</p>");
      expect((await files.search("original", ".")).matches).toMatchObject([{ path: join("site", "index.html"), line: 2 }]);
      expect(files.changes).toHaveLength(2);
    } finally { cleanup(); }
  });

  it("rejects unread files, ambiguous edits, and concurrent user changes", async () => {
    const { root, cleanup } = workspace();
    const files = new ProjectFiles(root, new PermissionEngine({ mode: "BALANCED" }));
    try {
      const authorize = async () => undefined;
      writeFileSync(join(root, "existing.txt"), "same same");
      await expect(files.write("existing.txt", "overwrite", authorize)).rejects.toThrow("Read this file");
      await files.read("existing.txt");
      await expect(files.edit("existing.txt", "same", "new", authorize)).rejects.toThrow("not unique");
      writeFileSync(join(root, "existing.txt"), "user changed this");
      await expect(files.edit("existing.txt", "same", "new", authorize)).rejects.toThrow("changed");
      expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe("user changed this");
    } finally { cleanup(); }
  });

  it("blocks traversal, credentials, Windows aliases, hard-to-see protected paths, and junctions", async () => {
    const { root, cleanup } = workspace();
    const project = join(root, "project"), outside = join(root, "outside");
    mkdirSync(project); mkdirSync(outside);
    writeFileSync(join(outside, "private.txt"), "private");
    const files = new ProjectFiles(project, new PermissionEngine({ mode: "BALANCED" }));
    try {
      for (const path of ["../outside/private.txt", join(outside, "private.txt"), ".env", "src/.ENV.local", ".git/config", "credentials.json", "x.txt:stream", "nul.txt", "dir. /x"]) {
        await expect(files.write(path, "bad", async () => undefined)).rejects.toThrow();
      }
      symlinkSync(outside, join(project, "linked"), process.platform === "win32" ? "junction" : "dir");
      await expect(files.read("linked/private.txt")).rejects.toThrow("Linked paths");
      await expect(files.write("linked/new.txt", "bad", async () => undefined)).rejects.toThrow("Linked paths");
      expect(existsSync(join(outside, "new.txt"))).toBe(false);
      expect((await files.list()).files).not.toContain("linked/");
    } finally { cleanup(); }
  });

  it("validates tool arguments and requires SAFE-mode write approval", async () => {
    const { root, cleanup } = workspace();
    const tools = new AgentTools(root, new PermissionEngine({ mode: "SAFE" }));
    const execute = (name: string, input: unknown, callbacks: AgentCallbacks = {}) => tools.execute({ id: "test", name, argumentsJson: JSON.stringify(input) }, callbacks);
    try {
      expect((await execute("write_file", { path: "a.txt", content: "test" })).ok).toBe(false);
      expect(existsSync(join(root, "a.txt"))).toBe(false);
      expect((await execute("write_file", { path: "a.txt", content: "test" }, { approve: async () => true })).ok).toBe(true);
      expect((await execute("write_file", { path: "bad.txt", content: 123 })).ok).toBe(false);
      expect((await execute("__proto__", {})).ok).toBe(false);
      expect((await execute("run_command", { command: "echo hello" })).ok).toBe(false);
    } finally { cleanup(); }
  });

  it("does not write an aborted task and blocks binary/oversized reads", async () => {
    const { root, cleanup } = workspace();
    const tools = new AgentTools(root, new PermissionEngine({ mode: "BALANCED" }));
    const signal = AbortSignal.abort(new Error("stop"));
    try {
      await expect(tools.execute({ id: "a", name: "write_file", argumentsJson: JSON.stringify({ path: "cancel.txt", content: "no" }) }, {}, signal)).rejects.toThrow("stop");
      expect(existsSync(join(root, "cancel.txt"))).toBe(false);
      writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
      writeFileSync(join(root, "huge.txt"), "a".repeat(513 * 1024));
      await expect(tools.files.read("binary.bin")).rejects.toThrow("Binary");
      await expect(tools.files.read("huge.txt")).rejects.toThrow("512 KiB");
    } finally { cleanup(); }
  });

  it("runs an approved command with captured output and reports nonzero exits", async () => {
    const { root, cleanup } = workspace();
    try {
      const tools = new AgentTools(root, new PermissionEngine());
      let approval = "";
      const result = await tools.execute({ id: "cmd", name: "run_command", argumentsJson: JSON.stringify({ command: "echo ZuvCode_CHECK", timeout_ms: 15000 }) }, {
        approve: async (description) => { approval = description; return true; }
      });
      expect(approval).toContain(root);
      expect(approval).toContain("outside the project");
      expect(result).toMatchObject({ ok: true, output: { exitCode: 0 } });
      expect(JSON.stringify(result.output)).toContain("ZuvCode_CHECK");
      const failed = await runCommand(root, "exit 7", 15000);
      expect(failed.exitCode).toBe(7);
    } finally { cleanup(); }
  }, 35000);

  it("kills timed-out commands and honours cancellation", async () => {
    const { root, cleanup } = workspace();
    const command = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
    try {
      const result = await runCommand(root, command, 150);
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBeNull();
      const controller = new AbortController();
      const job = runCommand(root, command, 5000, controller.signal);
      setTimeout(() => controller.abort(new Error("cancelled")), 100);
      await expect(job).rejects.toThrow("cancelled");
    } finally { cleanup(); }
  });
});

describe("web research tools", () => {
  it("parses search results and readable pages without executing scripts", () => {
    const html = '<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example &amp; Docs</a><div class="result__snippet">Useful docs</div></div>';
    expect(parseSearchHtml(html)).toEqual([{ title: "Example & Docs", url: "https://example.com/docs", snippet: "Useful docs" }]);
    const page = extractWebPage("<title>Docs</title><nav>Menu</nav><main><h1>Title</h1><p>Actual text</p><script>alert('bad')</script></main>");
    expect(page.title).toBe("Docs");
    expect(page.content).toContain("Actual text");
    expect(page.content).not.toContain("alert");
    expect(page.content).not.toContain("Menu");
  });

  it("rejects private, encoded, mapped, reserved and credential-bearing URLs", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1", "224.0.0.1"]) expect(isPublicAddress(ip), ip).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    for (const url of ["file:///etc/passwd", "http://2130706433/", "http://0x7f000001", "http://[::1]/", "http://localhost/", "http://service.internal/", "https://user:pass@example.com", "https://example.com:3000"]) expect(() => validateWebUrl(url), url).toThrow();
  });

  it("honours web off and rejects private fetches before making a request", async () => {
    await expect(new WebTools({ enabled: false }).search("test")).rejects.toThrow("disabled");
    await expect(new WebTools().read("http://127.0.0.1/")).rejects.toThrow("blocked");
  });
});
