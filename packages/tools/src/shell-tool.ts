import { spawn } from "node:child_process";
import { nowIso } from "@zuvcode/shared";
import { classifyShellCommand, PermissionEngine } from "@zuvcode/permissions";
import type { ToolExecutionRequest, ToolExecutionResult } from "@zuvcode/protocol";
import type { ZuvCodeTool } from "./types.js";

export interface ShellInput {
  command: string;
  args?: string[];
  timeoutMs?: number;
}

export interface ShellOutput {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class ShellTool implements ZuvCodeTool<ShellInput, ShellOutput> {
  public readonly manifest = {
    name: "shell",
    version: "0.1.0",
    description: "Run scoped project shell commands with permission checks and timeouts",
    entrypoint: "built-in",
    requiredPermissions: ["shell"],
    filesystemScope: { read: ["./**"], write: ["./**"], deny: [".env", ".env.*"] },
    networkAccess: { enabled: false, allowedHosts: [] },
    environmentAccess: [],
    executionTimeoutMs: 120_000,
    memoryLimitMb: 512,
    riskLevel: "MEDIUM" as const
  };

  public constructor(
    private readonly projectRoot: string,
    private readonly permissions: PermissionEngine
  ) {}

  public execute(request: ToolExecutionRequest<ShellInput>): Promise<ToolExecutionResult<ShellOutput>> {
    const startedAt = nowIso();
    const args = request.input.args ?? [];
    const printableCommand = [request.input.command, ...args].join(" ");

    return new Promise((resolve) => {
      try {
        const riskLevel = classifyShellCommand(printableCommand);
        this.permissions.assertAllowed({ kind: "shell", riskLevel, command: printableCommand });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: nowIso()
        });
        return;
      }

      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(request.input.command, args, {
          cwd: this.projectRoot,
          shell: false,
          env: sanitizedEnvironment()
        });
      } catch (error) {
        resolve({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: nowIso()
        });
        return;
      }

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, request.input.timeoutMs ?? 120_000);

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        const result: ToolExecutionResult<ShellOutput> = {
          ok: exitCode === 0,
          output: {
            command: printableCommand,
            exitCode,
            stdout,
            stderr
          },
          startedAt,
          completedAt: nowIso()
        };
        if (exitCode !== 0) {
          result.error = `Command exited with ${exitCode}`;
        }
        resolve(result);
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        resolve({
          ok: false,
          error: error.message,
          startedAt,
          completedAt: nowIso()
        });
      });
    });
  }
}

function sanitizedEnvironment(): NodeJS.ProcessEnv {
  const allowedPrefixes = ["PATH", "Path", "PATHEXT", "SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "ComSpec", "PNPM_HOME"];
  const next: NodeJS.ProcessEnv = {};
  for (const key of allowedPrefixes) {
    const value = process.env[key];
    if (value !== undefined) {
      next[key] = value;
    }
  }

  return next;
}
