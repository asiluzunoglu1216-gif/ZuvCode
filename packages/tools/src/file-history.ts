import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { resolveDataDirectory } from "@zuvcode/shared";

const excluded = /^(node_modules|dist|build|coverage|\.git|\.(?:zuvcode|orvynx).*|\.codex|\.agents|\.next|\.venv|venv|__pycache__)$/i;
const secret = /^(\.env(?:\..*)?|\.ssh|\.aws|\.azure|\.npmrc|\.netrc|credentials\.json|id_rsa|id_ed25519)$|\.(pem|key|p12|pfx)$/i;
const fileLimit = 8 * 1024 * 1024;
const totalLimit = 128 * 1024 * 1024;
const schema = z.object({
  id: z.string().uuid(), root: z.string(), createdAt: z.string(), reason: z.string().max(200),
  files: z.array(z.object({ path: z.string().min(1).max(1000), hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().min(0).max(fileLimit), mode: z.number().int() })).max(10000)
});
export type FileCheckpoint = z.infer<typeof schema>;
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

/** Reject links at every component before backup/recovery, including the history directory. */
async function checked(target: string): Promise<string> {
  const absolute = resolve(target);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep)) {
    if (!part) continue;
    if (/[:]|[. ]$|[\x00-\x1f]/.test(part) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) throw new Error("Invalid history path.");
    current = join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error("Linked paths cannot be backed up or recovered.");
    } catch (error) { if (!missing(error)) throw error; }
  }
  return absolute;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
}

export class FileHistory {
  public readonly directory: string;
  public constructor(private readonly root: string, directory = join(resolveDataDirectory(root), "file-history"), private readonly privateRoots: string[] = []) {
    this.directory = resolve(directory);
  }

  public static forUser(root: string, home: string): FileHistory {
    const key = process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root);
    return new FileHistory(root, join(home, "file-history", digest(key)), [resolve(home)]);
  }

  public protects(target: string): boolean { return [this.directory, ...this.privateRoots].some((root) => inside(root, resolve(target))); }

  private async prepare(): Promise<void> {
    await checked(this.directory);
    await checked(join(this.directory, "objects"));
    await checked(join(this.directory, "records"));
    await mkdir(join(this.directory, "objects"), { recursive: true, mode: 0o700 });
    await mkdir(join(this.directory, "records"), { recursive: true, mode: 0o700 });
    await checked(join(this.directory, "objects"));
    await checked(join(this.directory, "records"));
  }

  private async blob(data: Buffer): Promise<string> {
    const hash = digest(data);
    const target = await checked(join(this.directory, "objects", hash));
    try {
      if (digest(await readFile(target)) !== hash) throw new Error("Backup object is corrupt; refusing to continue.");
    }
    catch (error) {
      if (!missing(error)) throw error;
      await this.commit(target, data);
    }
    return hash;
  }

  private async commit(target: string, data: Buffer | string): Promise<void> {
    // An interrupted write stays outside the published record/object namespace.
    const pending = await checked(join(dirname(target), `.pending-${randomUUID()}`));
    try {
      await writeFile(pending, data, { flag: "wx", mode: 0o600, flush: true });
      await checked(target);
      await rename(pending, target);
    } finally { await unlink(pending).catch(() => undefined); }
  }

  /** A shell cannot start unless every eligible file has a durable preimage. */
  public async capture(reason: string, targets?: string[], signal?: AbortSignal): Promise<FileCheckpoint> {
    await this.prepare();
    const root = await realpath(this.root);
    const files: FileCheckpoint["files"] = [];
    let bytes = 0;
    const visit = async (target: string): Promise<void> => {
      signal?.throwIfAborted();
      if (!inside(root, target) || this.protects(target)) return;
      const local = relative(root, target);
      if (local.split(sep).some((part) => excluded.test(part) || secret.test(part))) return;
      let info;
      try {
        info = await lstat(target);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) return;
        await checked(target);
      }
      catch (error) { if (missing(error)) return; throw error; }
      if (info.isDirectory()) {
        for (const item of await readdir(target, { withFileTypes: true })) {
          if (item.isSymbolicLink()) continue;
          await visit(join(target, item.name));
        }
      } else if (info.isFile()) {
        if (info.size > fileLimit || bytes + info.size > totalLimit || files.length >= 10000) throw new Error("File backup limit exceeded (8 MiB/file, 128 MiB or 10000 files per checkpoint). Cannot create a complete checkpoint. Narrow the project directory.");
        const data = await readFile(target);
        if (data.length > fileLimit || bytes + data.length > totalLimit) throw new Error("File grew beyond the backup limit. Cannot create a complete checkpoint.");
        bytes += data.length;
        files.push({ path: local.split(sep).join("/"), hash: await this.blob(data), bytes: data.length, mode: info.mode });
      }
    };
    for (const target of targets ?? [root]) await visit(resolve(root, target));
    const record: FileCheckpoint = { id: randomUUID(), root, createdAt: new Date().toISOString(), reason: reason.slice(0, 200), files };
    await this.commit(await checked(join(this.directory, "records", `${record.id}.json`)), JSON.stringify(record));
    return record;
  }

  public async list(): Promise<FileCheckpoint[]> {
    await this.prepare();
    const result: FileCheckpoint[] = [];
    const root = await realpath(this.root);
    for (const name of await readdir(join(this.directory, "records"))) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const record = schema.parse(JSON.parse(await readFile(await checked(join(this.directory, "records", name)), "utf8")));
      if (record.root !== root || `${record.id}.json` !== name) throw new Error("Checkpoint belongs to another project or is corrupt.");
      result.push(record);
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async contents(file: FileCheckpoint["files"][number]): Promise<Buffer> {
    const data = await readFile(await checked(join(this.directory, "objects", file.hash)));
    if (data.length !== file.bytes || digest(data) !== file.hash) throw new Error(`Corrupt backup for ${file.path}.`);
    return data;
  }

  private async target(root: string, path: string): Promise<string> {
    const target = resolve(root, path);
    if (!inside(root, target) || target === root || isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || excluded.test(part) || secret.test(part))) throw new Error("Unsafe checkpoint path.");
    return checked(target);
  }

  /** Only fill missing paths. Never roll back edits or delete files on failure. */
  public async restoreMissing(checkpoint: FileCheckpoint): Promise<string[]> {
    const record = schema.parse(checkpoint);
    const root = await realpath(this.root);
    if (record.root !== root) throw new Error("Checkpoint root mismatch.");
    const restored: string[] = [];
    for (const file of record.files) {
      const target = await this.target(root, file.path);
      try {
        const info = await lstat(target);
        if (!info.isFile()) throw new Error(`Recovery conflict at ${file.path}; use /changes recover ${record.id}.`);
        continue;
      } catch (error) { if (!missing(error)) throw error; }
      const data = await this.contents(file);
      await mkdir(dirname(target), { recursive: true });
      await this.target(root, file.path);
      try { await writeFile(target, data, { flag: "wx", mode: file.mode }); restored.push(file.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    return restored;
  }

  /** Export is user-invoked, additive and separate from the live working files. */
  public async recover(reference: string): Promise<string> {
    if (!/^[a-f0-9-]{8,36}$/.test(reference)) throw new Error("Use a checkpoint ID from /changes history.");
    const records = (await this.list()).filter((item) => item.id.startsWith(reference));
    if (records.length !== 1) throw new Error(records.length ? "Ambiguous checkpoint ID." : "Checkpoint not found.");
    const record = records[0]!;
    const destination = await checked(join(resolveDataDirectory(this.root), "recovered", randomUUID()));
    await mkdir(destination, { recursive: true });
    for (const file of record.files) {
      const target = await this.target(destination, file.path);
      const data = await this.contents(file);
      await mkdir(dirname(target), { recursive: true });
      await checked(target);
      await writeFile(target, data, { flag: "wx", mode: file.mode });
    }
    return destination;
  }
}
