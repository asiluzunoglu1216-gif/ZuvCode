import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { permissionModeSchema, providerKindSchema, type PermissionMode } from "@zuvcode/shared";
import { modelMetadataSchema, type ModelMetadata } from "@zuvcode/protocol";
import type { ProviderRecord } from "@zuvcode/persistence";

const configSchema = z.object({
  providers: z.array(z.object({
    id: z.string(), kind: providerKindSchema, name: z.string(), baseUrl: z.string().optional(),
    apiKeyEnv: z.string().optional(), apiKeySession: z.string().optional(),
    status: z.enum(["connected", "add", "detected", "not_running", "unavailable"]),
    createdAt: z.string(), updatedAt: z.string()
  })).default([]),
  models: z.array(modelMetadataSchema).default([]),
  selectedModel: z.string().default("AUTO"),
  webEnabled: z.boolean().default(true),
  googleSearch: z.boolean().optional(),
  permissionMode: permissionModeSchema.default("SAFE")
});

type UserConfig = z.infer<typeof configSchema>;

export class UserConfigStore {
  public constructor(public readonly directory: string) {}

  public read(): UserConfig {
    return configSchema.parse(readJson(join(this.directory, "config.json")));
  }

  public saveProvider(provider: ProviderRecord): void {
    const config = this.read();
    config.providers = [...config.providers.filter((item) => item.id !== provider.id), provider];
    this.write("config.json", config);
  }

  public saveModel(model: ModelMetadata): void {
    this.saveModels([model]);
  }

  public saveModels(models: ModelMetadata[]): void {
    const config = this.read();
    const merged = new Map(config.models.map((model) => [`${model.provider}/${model.id}`, model]));
    for (const model of models) merged.set(`${model.provider}/${model.id}`, model);
    config.models = [...merged.values()];
    this.write("config.json", config);
  }

  public selectModel(model: string): void {
    this.write("config.json", { ...this.read(), selectedModel: model });
  }

  public saveSecret(id: string, value: string): void {
    const secrets = z.record(z.string(), z.string()).parse(readJson(join(this.directory, "credentials.json")));
    secrets[id] = process.platform === "win32" ? protect(value, "encrypt") : value;
    this.write("credentials.json", secrets);
  }

  public configureWeb(options: { webEnabled?: boolean; googleSearch?: boolean }): void {
    this.write("config.json", { ...this.read(), ...options });
  }

  public setPermissionMode(mode: PermissionMode): void {
    this.write("config.json", { ...this.read(), permissionMode: permissionModeSchema.parse(mode) });
  }

  public loadSecret(id: string): string | undefined {
    const secrets = z.record(z.string(), z.string()).parse(readJson(join(this.directory, "credentials.json")));
    const value = secrets[id];
    return value && process.platform === "win32" ? protect(value, "decrypt") : value;
  }

  private write(name: string, value: unknown): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, name);
    const temp = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
    try {
      for (let attempt = 0; ; attempt++) {
        try { renameSync(temp, path); break; }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (attempt >= 8 || !["EPERM", "EACCES", "EBUSY"].includes(code ?? "")) throw error;
          // Windows scanners can briefly hold the destination during an atomic replace.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
        }
      }
    } catch (error) { unlinkSync(temp); throw error; }
  }
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new Error(`Could not read ZuvCode settings: ${path}`, { cause: error });
  }
}

function protect(value: string, mode: "encrypt" | "decrypt"): string {
  // Secrets travel through stdin, never shell arguments or environment variables.
  const operation = mode === "encrypt"
    ? "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))"
    : "[Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser))";
  try {
    return execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference = 'Stop'; [void][Reflection.Assembly]::LoadWithPartialName('System.Security'); [Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); $value = [Console]::In.ReadToEnd(); ${operation}`],
    { input: value, encoding: "utf8", windowsHide: true, timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (error) {
    throw new Error("Windows credential storage is unavailable. Use an API key environment variable instead.", { cause: error });
  }
}
