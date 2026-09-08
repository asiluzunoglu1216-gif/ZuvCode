import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nowIso, resolveDataDirectory } from "@zuvcode/shared";

export type MemoryKind = "architecture" | "decisions" | "mistakes" | "preferences";

export class ProjectMemory {
  private readonly memoryDir: string;

  public constructor(projectRoot: string) {
    this.memoryDir = join(resolveDataDirectory(projectRoot), "memory");
    mkdirSync(this.memoryDir, { recursive: true });
  }

  public ensureBaseFiles(): void {
    for (const kind of ["architecture", "decisions", "mistakes", "preferences"] as const) {
      const path = this.pathFor(kind);
      try {
        readFileSync(path, "utf8");
      } catch {
        writeFileSync(path, `# ${title(kind)}\n\n`, "utf8");
      }
    }
    mkdirSync(join(this.memoryDir, "summaries"), { recursive: true });
  }

  public append(kind: MemoryKind, heading: string, content: string): void {
    const path = this.pathFor(kind);
    const existing = safeRead(path);
    const entry = `\n## ${heading}\n\nRecorded: ${nowIso()}\n\n${content.trim()}\n`;
    writeFileSync(path, `${existing.trimEnd()}\n${entry}`, "utf8");
  }

  public read(kind: MemoryKind): string {
    return safeRead(this.pathFor(kind));
  }

  private pathFor(kind: MemoryKind): string {
    return join(this.memoryDir, `${kind}.md`);
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function title(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
