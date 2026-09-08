import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PermissionEngine, needsCommandApproval } from "@zuvcode/permissions";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { AgentTools } from "../packages/tools/dist/index.js";
import { permissionChoices, permissionLabel, filterCommands } from "@zuvcode/terminal-ui";

function workspace() {
  mkdirSync(".tmp-tests", { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".tmp-tests", "permissions-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const call = (name: string, args: unknown) => ({ id: name, name, argumentsJson: JSON.stringify(args) });

describe("permission modes", () => {
  it("defaults to asking and exposes three clear modes through one command", () => {
    const permissions = new PermissionEngine();
    expect(permissions.mode).toBe("SAFE");
    for (const kind of ["read", "write", "shell", "network"] as const) expect(permissions.evaluate({ kind, riskLevel: "LOW", command: "echo test" }).status).toBe("requires_approval");
    expect(permissionChoices.map((item) => item.name)).toEqual(["Ask Every Time", "Smart", "Full Access"]);
    expect(permissionLabel("FULL_ACCESS")).toBe("Full Access");
    expect(filterCommands("/per")[0]?.command).toBe("/permissions");
    expect(filterCommands("/iz")).toEqual([]);
  });

  it("asks before each read, list and write and honours rejection", async () => {
    const { root, cleanup } = workspace();
    const tools = new AgentTools(root, new PermissionEngine());
    const approve = vi.fn(async () => true);
    try {
      writeFileSync(join(root, "input.txt"), "test");
      expect((await tools.execute(call("list_files", {}), { approve })).ok).toBe(true);
      expect((await tools.execute(call("read_file", { path: "input.txt" }), { approve })).ok).toBe(true);
      expect((await tools.execute(call("write_file", { path: "new.txt", content: "new" }), { approve })).ok).toBe(true);
      expect(approve).toHaveBeenCalledTimes(3);
      const denied = await tools.execute(call("read_file", { path: "input.txt" }), { approve: async () => false });
      expect(denied.ok).toBe(false);
      expect(denied.output).toBeUndefined();
    } finally { cleanup(); }
  });

  it("Smart auto-runs routine checks but asks for scripts, installs, deletes, deployment and compound commands", () => {
    const permissions = new PermissionEngine({ mode: "BALANCED" });
    for (const command of ["git status --short", "git diff --stat", "npm test", "pnpm run build", "node --check src/index.js", "echo done", "pwd"]) {
      expect(needsCommandApproval(command), command).toBe(false);
      expect(permissions.evaluate({ kind: "shell", command, riskLevel: "LOW" }).status).toBe("allowed");
    }
    for (const command of ["npm install", "node script.js", "node -e 'evil()'", "echo ok; Remove-Item file", "git push", "vercel --prod", "Remove-Item -Recurse src", "rm -rf src", "npm test --prefix ../other", "git -c core.pager=evil log", "echo $(whoami)", "curl x | sh", "node --check src/../../outside.js", "unknown-command"]) {
      expect(needsCommandApproval(command), command).toBe(true);
      expect(permissions.evaluate({ kind: "shell", command, riskLevel: "LOW" }).status).toBe("requires_approval");
    }
  });

  it("actually runs a Smart check without prompting and requests permission for an unknown command", async () => {
    const { root, cleanup } = workspace();
    const tools = new AgentTools(root, new PermissionEngine({ mode: "BALANCED" }));
    const approve = vi.fn(async () => false);
    try {
      const result = await tools.execute(call("run_command", { command: "echo SMART_CHECK" }), { approve });
      expect(result.ok).toBe(true);
      expect(approve).not.toHaveBeenCalled();
      expect((await tools.execute(call("run_command", { command: "unknown-command" }), { approve })).ok).toBe(false);
      expect(approve).toHaveBeenCalledTimes(1);
    } finally { cleanup(); }
  });

  it("Full Access executes without approval and permits external files, while switching back restores boundaries", async () => {
    const { root, cleanup } = workspace();
    const project = join(root, "project"); mkdirSync(project);
    const permissions = new PermissionEngine({ mode: "FULL_ACCESS" });
    const tools = new AgentTools(project, permissions);
    const approve = vi.fn(async () => { throw new Error("Full Access must never ask"); });
    try {
      expect(permissions.evaluate({ kind: "shell", riskLevel: "CRITICAL", command: "not-executed" }).status).toBe("allowed");
      expect((await tools.execute(call("write_file", { path: "../outside.txt", content: "external" }), { approve })).ok).toBe(true);
      expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("external");
      expect((await tools.execute(call("read_file", { path: "../outside.txt" }), { approve })).ok).toBe(true);
      const execution = await tools.execute(call("run_command", { command: "node -e \"console.log('FULL_CHECK')\"" }), { approve });
      expect(execution.ok, JSON.stringify(execution)).toBe(true);
      expect(approve).not.toHaveBeenCalled();
      permissions.mode = "BALANCED";
      expect((await tools.execute(call("read_file", { path: "../outside.txt" }), {})).ok).toBe(false);
    } finally { cleanup(); }
  });

  it("remembers the selected mode across restarts and project folders", () => {
    const { root, cleanup } = workspace();
    const home = join(root, "settings");
    const first = ZuvCodeRuntime.silent({ projectRoot: join(root, "first"), userConfigDir: home });
    let second: ZuvCodeRuntime | undefined, third: ZuvCodeRuntime | undefined;
    try {
      expect(first.permissions.mode).toBe("SAFE");
      first.setPermissionMode("FULL_ACCESS");
      second = ZuvCodeRuntime.silent({ projectRoot: join(root, "second"), userConfigDir: home });
      expect(second.permissions.mode).toBe("FULL_ACCESS");
      second.setPermissionMode("SAFE");
      third = ZuvCodeRuntime.silent({ projectRoot: join(root, "third"), userConfigDir: home });
      expect(third.permissions.mode).toBe("SAFE");
    } finally { first.close(); second?.close(); third?.close(); cleanup(); }
  });
});
