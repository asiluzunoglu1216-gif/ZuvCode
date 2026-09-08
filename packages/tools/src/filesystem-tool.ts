import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { type ToolExecutionRequest, type ToolExecutionResult } from "@zuvcode/protocol";
import { PermissionEngine } from "@zuvcode/permissions";
import { nowIso } from "@zuvcode/shared";
import type { ZuvCodeTool } from "./types.js";
import { resolveProjectPath } from "./project-files.js";

export type FilesystemInput =
  | { operation: "readText"; path: string }
  | { operation: "writeText"; path: string; content: string };

export interface FilesystemOutput {
  path: string;
  content?: string;
  bytes?: number;
}

export class FilesystemTool implements ZuvCodeTool<FilesystemInput, FilesystemOutput> {
  public readonly manifest = {
    name: "filesystem",
    version: "0.1.0",
    description: "Read and write scoped project text files",
    entrypoint: "built-in",
    requiredPermissions: ["filesystem"],
    filesystemScope: { read: ["./**"], write: ["./**"], deny: [".env", ".env.*"] },
    networkAccess: { enabled: false, allowedHosts: [] },
    environmentAccess: [],
    executionTimeoutMs: 30_000,
    memoryLimitMb: 256,
    riskLevel: "MEDIUM" as const
  };

  public constructor(
    private readonly projectRoot: string,
    private readonly permissions: PermissionEngine
  ) {}

  public async execute(request: ToolExecutionRequest<FilesystemInput>): Promise<ToolExecutionResult<FilesystemOutput>> {
    const startedAt = nowIso();
    try {
      const target = await resolveProjectPath(this.projectRoot, request.input.path);
      const relativeTarget = relative(this.projectRoot, target);

      if (request.input.operation === "readText") {
        this.permissions.assertAllowed({ kind: "read", riskLevel: "LOW", path: relativeTarget });
        const content = await readFile(target, "utf8");
        return {
          ok: true,
          output: { path: relativeTarget, content, bytes: Buffer.byteLength(content) },
          startedAt,
          completedAt: nowIso()
        };
      }

      this.permissions.assertAllowed({ kind: "write", riskLevel: "MEDIUM", path: relativeTarget });
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, request.input.content, "utf8");
      return {
        ok: true,
        output: {
          path: relativeTarget,
          bytes: Buffer.byteLength(request.input.content)
        },
        startedAt,
        completedAt: nowIso()
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        completedAt: nowIso()
      };
    }
  }

}
