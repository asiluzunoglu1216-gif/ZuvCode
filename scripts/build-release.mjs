import ncc from "@vercel/ncc";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const config = JSON.parse(readFileSync(join(root, "scripts/release-config.json"), "utf8"));
const version = process.env.ZUVCODE_RELEASE_VERSION || pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Release version must be numeric major.minor.patch.");
const stage = join(root, `.tmp-release-${randomUUID()}`);
const app = join(stage, "app");
mkdirSync(app, { recursive: true });
const output = await ncc(join(root, "apps/cli/dist/index.js"), { externals: ["typescript"], minify: true, license: "THIRD_PARTY_LICENSES.txt" });
writeFileSync(join(app, "index.js"), `process.env.ZUVCODE_VERSION=${JSON.stringify(version)};\n` + output.code.replace(/^#![^\n]*\n/, ""));
writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module", private: true }));
for (const [name, asset] of Object.entries(output.assets)) {
  const path = resolve(app, name);
  const local = relative(app, path);
  if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`)) throw new Error("Invalid bundle asset path.");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, asset.source);
}
// TypeScript's compiler reads its own library files and cannot be flattened into an ESM bundle.
cpSync(dirname(require.resolve("typescript/package.json")), join(app, "node_modules/typescript"), { recursive: true });
cpSync(join(root, "scripts/distribution/launcher.mjs"), join(stage, "launcher.mjs"));
cpSync(join(root, "install.ps1"), join(stage, "install.ps1"));
writeFileSync(join(stage, "release.json"), JSON.stringify({ format: 1, version, repository: config.repository, nodeVersion: config.nodeVersion, commit: process.env.GITHUB_SHA || "local" }, null, 2));
const smoke = spawnSync(process.execPath, [join(app, "index.js"), "--version"], { encoding: "utf8", windowsHide: true, cwd: stage });
if (smoke.status !== 0 || smoke.stdout.trim() !== version) throw new Error(`Bundle smoke test failed: ${smoke.error?.message || smoke.stderr || smoke.stdout}`);
const artifacts = join(root, "artifacts");
mkdirSync(artifacts, { recursive: true });
const archive = join(artifacts, "zuvcode.zip");
const zip = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "Compress-Archive -LiteralPath @(($env:ZUVCODE_STAGE + '/app'), ($env:ZUVCODE_STAGE + '/launcher.mjs'), ($env:ZUVCODE_STAGE + '/install.ps1'), ($env:ZUVCODE_STAGE + '/release.json')) -DestinationPath $env:ZUVCODE_ARCHIVE -Force"],
  { env: { ...process.env, ZUVCODE_STAGE: stage, ZUVCODE_ARCHIVE: archive }, encoding: "utf8", windowsHide: true });
if (zip.status !== 0 || !existsSync(archive)) throw new Error(zip.stderr || "Release archive failed.");
writeFileSync(join(artifacts, "SHA256SUMS"), `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  zuvcode.zip\n`);
cpSync(join(root, "install.ps1"), join(artifacts, "install.ps1"));
console.log(`Packaged ZuvCode ${version}: ${archive}`);
