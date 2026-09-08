import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { PermissionEngine, PermissionRequest } from "@zuvcode/permissions";
import { isProtectedPath } from "@zuvcode/permissions";
import { FileHistory } from "./file-history.js";

const MAX_FILE_BYTES = 512 * 1024;
const ignored = /^(node_modules|dist|build|coverage|\.git|\.(?:zuvcode|orvynx).*|\.codex|\.agents)$/i;
const sensitive = /^(\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials\.json|id_rsa|id_ed25519)$|\.(pem|key|p12|pfx)$/i;

export interface FileChange { path: string; action: "created" | "modified"; bytes: number }
export type Authorize = (request: PermissionRequest) => Promise<void>;
export class FileEditConflict extends Error {}

/** Project paths are checked component by component so junctions cannot bypass the root. */
export async function resolveProjectPath(rootPath: string, input: string, fullAccess = false): Promise<string> {
  if (!input || /[\x00-\x1f]/.test(input)) throw new Error("Invalid project path.");
  const root = await realpath(rootPath);
  const target = resolve(root, input);
  const base = fullAccess ? parse(target).root : root;
  const local = relative(base, target);
  if (!fullAccess && (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))) throw new Error("Path escapes the project root.");
  let current = base;
  for (const part of local.split(sep).filter(Boolean)) {
    if (/[:]|[. ]$/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) throw new Error("Invalid filename.");
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        if (!fullAccess) throw new Error("Linked paths are not available to file tools.");
        current = await realpath(current);
      }
      if (!fullAccess && info.isFile() && info.nlink > 1) throw new Error("Linked paths are not available to file tools.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}

export class ProjectFiles {
  private readonly observed = new Map<string, string>();
  public readonly changes: FileChange[] = [];

  public constructor(private readonly root: string, private readonly permissions: PermissionEngine, private readonly history = new FileHistory(root)) {}

  public async path(input: string): Promise<string> {
    const target = await resolveProjectPath(this.root, input, this.permissions.mode === "FULL_ACCESS");
    const local = relative(await realpath(this.root), target).split(sep);
    if (this.history.protects(target) || local.some((part) => /^\.(?:zuvcode|orvynx)(?:$|-)/i.test(part))) throw new Error("ZuvCode state and recovery files cannot be accessed by agent file tools. Use /changes history.");
    if (this.permissions.mode !== "FULL_ACCESS" && local.some((part) => ignored.test(part) || sensitive.test(part))) throw new Error("This path is protected or generated; file tools cannot access it.");
    return target;
  }

  public async list(input = ".", depth = 2, signal?: AbortSignal, authorize?: Authorize): Promise<{ files: string[]; truncated: boolean }> {
    await this.checkRead(input, authorize);
    const start = await this.path(input);
    const files: string[] = [];
    let truncated = false;
    const walk = async (directory: string, remaining: number): Promise<void> => {
      signal?.throwIfAborted();
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= 500) { truncated = true; break; }
        if (ignored.test(entry.name) || sensitive.test(entry.name) || entry.isSymbolicLink()) continue;
        const target = join(directory, entry.name);
        const local = relative(start, target).split(sep).join("/");
        if (this.permissions.mode !== "FULL_ACCESS" && isProtectedPath(relative(this.root, target), this.permissions.protectedPaths)) continue;
        files.push(local + (entry.isDirectory() ? "/" : ""));
        if (entry.isDirectory() && remaining > 0) await walk(target, remaining - 1);
      }
    };
    await walk(start, depth);
    return { files, truncated };
  }

  private async text(target: string): Promise<string> {
    const info = await lstat(target);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("Read requires a text file smaller than 512 KiB.");
    const data = await readFile(target);
    if (data.includes(0)) throw new Error("Binary files are not supported by text tools.");
    return data.toString("utf8");
  }

  public async read(input: string, start = 1, count = 250, authorize?: Authorize): Promise<Record<string, unknown>> {
    await this.checkRead(input, authorize);
    const target = await this.path(input);
    const content = await this.text(target);
    this.observed.set(target, hash(content));
    const lines = content.split("\n");
    const excerpt = lines.slice(start - 1, start - 1 + count).map((line, index) => `${start + index}: ${line}`).join("\n");
    return { path: input, totalLines: lines.length, content: excerpt.slice(0, 24_000), truncated: excerpt.length > 24_000 || start - 1 + count < lines.length };
  }

  public async search(query: string, input: string, signal?: AbortSignal, authorize?: Authorize): Promise<Record<string, unknown>> {
    const listing = await this.list(input, 8, signal, authorize);
    const matches: Array<{ path: string; line: number; text: string }> = [];
    let truncated = listing.truncated;
    for (const name of listing.files.filter((file) => !file.endsWith("/"))) {
      signal?.throwIfAborted();
      try {
        const path = join(input, name);
        const content = await this.text(await this.path(path));
        for (const [index, line] of content.split("\n").entries()) {
          if (line.toLowerCase().includes(query.toLowerCase())) matches.push({ path, line: index + 1, text: line.slice(0, 300) });
          if (matches.length >= 60) { truncated = true; break; }
        }
      } catch { /* Skip unreadable and binary files in a project-wide search. */ }
      if (matches.length >= 60) break;
    }
    return { matches, truncated };
  }

  public async write(input: string, content: string, authorize: Authorize, signal?: AbortSignal): Promise<FileChange> {
    return this.update(input, () => content, false, authorize, signal);
  }

  public async edit(input: string, oldText: string, newText: string, authorize: Authorize, signal?: AbortSignal): Promise<FileChange> {
    return this.update(input, (content) => {
      if (!content.includes(oldText)) throw new FileEditConflict("old_text was not found. Read the file and use its exact text. Nothing was changed.");
      if (content.indexOf(oldText) !== content.lastIndexOf(oldText)) throw new FileEditConflict("old_text is not unique. Include more surrounding context. Nothing was changed.");
      return content.replace(oldText, () => newText);
    }, true, authorize, signal);
  }

  private async update(input: string, transform: (content: string) => string, mustExist: boolean, authorize: Authorize, signal?: AbortSignal): Promise<FileChange> {
    await authorize({ kind: "write", riskLevel: "MEDIUM", path: input });
    signal?.throwIfAborted();
    const target = await this.path(input);
    let before: string | undefined;
    try { before = await this.text(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (mustExist && before === undefined) throw new Error("File does not exist.");
    if (before !== undefined && this.observed.get(target) !== hash(before)) throw new FileEditConflict("Read this file before editing. It is unread or has changed since the last read. Nothing was changed.");
    const content = transform(before ?? "");
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error("File content exceeds 512 KiB.");
    await this.history.capture("Before file edit", [target], signal);
    signal?.throwIfAborted();
    await mkdir(dirname(target), { recursive: true });
    await this.path(input);
    // Exclusive creation avoids overwriting a file created while the model was working.
    if (before === undefined) await writeFile(target, content, { flag: "wx", encoding: "utf8" });
    else {
      if (hash(await this.text(target)) !== hash(before)) throw new FileEditConflict("File changed during approval. Read it again. Nothing was changed.");
      const temp = join(dirname(target), `.zuvcode-write-${randomUUID()}.tmp`);
      try {
        await writeFile(temp, content, { flag: "wx", encoding: "utf8", mode: (await lstat(target)).mode });
        signal?.throwIfAborted();
        await rename(temp, target);
      } finally { await unlink(temp).catch(() => undefined); }
    }
    this.observed.set(target, hash(content));
    const change: FileChange = { path: input, action: before === undefined ? "created" : "modified", bytes: Buffer.byteLength(content) };
    this.changes.push(change);
    await this.history.capture("After file edit", [target]);
    return change;
  }

  private async checkRead(path: string, authorize?: Authorize): Promise<void> {
    const request: PermissionRequest = { kind: "read", riskLevel: "LOW", path };
    if (authorize) await authorize(request);
    else this.permissions.assertAllowed(request);
  }
}

function hash(text: string): string { return createHash("sha256").update(text).digest("hex"); }
