import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import type { Server } from "node:http";
import * as ts from "typescript";
import type { FilesystemTool, ShellTool } from "@zuvcode/tools";

export interface SimpleCodingExecutorOptions {
  projectRoot: string;
  filesystem: FilesystemTool;
  shell: ShellTool;
}

export interface SimpleExecutionResult {
  ok: boolean;
  outputDir: string;
  files: string[];
  evidence: string[];
}

export class SimpleCodingExecutor {
  public constructor(private readonly options: SimpleCodingExecutorOptions) {}

  public async tryExecute(goal: string): Promise<SimpleExecutionResult> {
    const outputDir = this.outputDirectory();
    const files = apiFiles(outputDir);
    const evidence: string[] = [`Goal matched built-in TypeScript REST API executor: ${goal}`];

    for (const file of files) {
      const result = await this.options.filesystem.execute({
        toolName: "filesystem",
        input: {
          operation: "writeText",
          path: file.path,
          content: file.content
        }
      });
      if (!result.ok) {
        return {
          ok: false,
          outputDir,
          files: files.map((item) => item.path),
          evidence: [...evidence, `Write failed for ${file.path}: ${result.error ?? "unknown error"}`]
        };
      }
    }

    evidence.push(`Generated ${files.length} files in ${outputDir}`);

    const compileResult = compileGeneratedTypeScript(this.options.projectRoot, outputDir);
    if (!compileResult.ok) {
      return {
        ok: false,
        outputDir,
        files: files.map((item) => item.path),
        evidence: [...evidence, `TypeScript compile failed: ${compileResult.error}`]
      };
    }

    evidence.push("TypeScript compile passed: dist/server.js emitted");

    const verification = await verifyGeneratedApi(this.options.projectRoot, outputDir);
    if (!verification.ok) {
      return {
        ok: false,
        outputDir,
        files: files.map((item) => item.path),
        evidence: [...evidence, `Verification failed: ${verification.error}`]
      };
    }

    evidence.push("Verification passed: generated REST API served health, create, and list endpoints");
    return {
      ok: true,
      outputDir,
      files: files.map((item) => item.path),
      evidence
    };
  }

  private outputDirectory(): string {
    if (isZuvCodeSourceTree(this.options.projectRoot)) {
      return "examples/generated-rest-api";
    }

    return ".";
  }
}

async function verifyGeneratedApi(projectRoot: string, outputDir: string): Promise<{ ok: true } | { ok: false; error: string }> {
  let server: Server | undefined;
  try {
    const modulePath = join(projectRoot, outputDir, "dist", "server.js");
    const imported = (await import(pathToFileURL(modulePath).href)) as { createApiServer?: () => Server };
    if (typeof imported.createApiServer !== "function") {
      return { ok: false, error: "createApiServer export missing" };
    }

    server = imported.createApiServer();
    server.listen(0);
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address !== "object") {
      return { ok: false, error: "server did not expose a TCP address" };
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/health`);
    if (health.status !== 200) {
      return { ok: false, error: `health endpoint returned ${health.status}` };
    }
    const healthBody = (await health.json()) as { ok?: unknown };
    if (healthBody.ok !== true) {
      return { ok: false, error: "health endpoint returned invalid payload" };
    }

    const created = await fetch(`${baseUrl}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "First item" })
    });
    if (created.status !== 201) {
      return { ok: false, error: `create endpoint returned ${created.status}` };
    }
    const item = (await created.json()) as { id?: unknown; name?: unknown };
    if (typeof item.id !== "string" || item.name !== "First item") {
      return { ok: false, error: "create endpoint returned invalid item" };
    }

    const listed = await fetch(`${baseUrl}/items`);
    const payload = (await listed.json()) as { items?: Array<{ id?: unknown }> };
    if (listed.status !== 200 || !Array.isArray(payload.items) || payload.items[0]?.id !== item.id) {
      return { ok: false, error: "list endpoint did not return created item" };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    const serverToClose = server;
    if (serverToClose !== undefined) {
      await new Promise<void>((resolve) => {
        serverToClose.close(() => resolve());
      });
    }
  }
}

interface GeneratedFile {
  path: string;
  content: string;
}

function apiFiles(outputDir: string): GeneratedFile[] {
  const prefix = outputDir === "." ? "" : `${outputDir}/`;
  return [
    {
      path: `${prefix}package.json`,
      content: JSON.stringify(
        {
          name: "zuvcode-generated-rest-api",
          version: "0.1.0",
          type: "module",
          private: true,
          scripts: {
            build: "tsc -p tsconfig.json",
            start: "node dist/server.js",
            test: "node test/server.test.mjs"
          },
          devDependencies: {
            "@types/node": "^24.10.1",
            typescript: "^5.9.3"
          }
        },
        null,
        2
      )
    },
    {
      path: `${prefix}tsconfig.json`,
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
            skipLibCheck: true,
            rootDir: "src",
            outDir: "dist",
            types: ["node"]
          },
          include: ["src/**/*.ts"]
        },
        null,
        2
      )
    },
    {
      path: `${prefix}src/server.ts`,
      content: `import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";

interface Item {
  id: string;
  name: string;
}

const items = new Map<string, Item>();

export function createApiServer() {
  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.setHeader("content-type", "application/json; charset=utf-8");

    if (request.method === "GET" && url.pathname === "/health") {
      response.writeHead(200);
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/items") {
      response.writeHead(200);
      response.end(JSON.stringify({ items: [...items.values()] }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/items") {
      const body = await readJson(request);
      const id = randomUUID();
      const item = { id, name: String(body.name ?? "Untitled") };
      items.set(id, item);
      response.writeHead(201);
      response.end(JSON.stringify(item));
      return;
    }

    response.writeHead(404);
    response.end(JSON.stringify({ error: "Not found" }));
  });
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (body.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

if (import.meta.url === \`file://\${process.argv[1]}\`) {
  const port = Number(process.env.PORT ?? 3000);
  createApiServer().listen(port, () => {
    console.log(\`REST API listening on http://localhost:\${port}\`);
  });
}
`
    },
    {
      path: `${prefix}test/server.test.mjs`,
      content: `import assert from "node:assert/strict";
import { once } from "node:events";
import { createApiServer } from "../dist/server.js";

async function main() {
  const server = createApiServer();
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = \`http://127.0.0.1:\${address.port}\`;

  const health = await fetch(\`\${baseUrl}/health\`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });

  const created = await fetch(\`\${baseUrl}/items\`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "First item" })
  });
  assert.equal(created.status, 201);
  const item = await created.json();
  assert.equal(item.name, "First item");

  const listed = await fetch(\`\${baseUrl}/items\`);
  assert.equal(listed.status, 200);
  const payload = await listed.json();
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0].id, item.id);

  await new Promise((resolve) => server.close(resolve));
  console.log("PASS REST API supports health and item creation");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
`
    },
    {
      path: `${prefix}README.md`,
      content: `# Generated TypeScript REST API

This minimal API was created by ZuvCode's built-in safe executor for the first milestone flow.

## Commands

\`\`\`bash
npm test
npm run build
npm start
\`\`\`

## Endpoints

- \`GET /health\`
- \`GET /items\`
- \`POST /items\`
`
    }
  ];
}

function compileGeneratedTypeScript(projectRoot: string, outputDir: string): { ok: true } | { ok: false; error: string } {
  const basePath = join(projectRoot, outputDir);
  const configPath = join(basePath, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error !== undefined) {
    return { ok: false, error: diagnosticMessage(configFile.error) };
  }

  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, basePath);
  if (parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors.map(diagnosticMessage).join("\n") };
  }

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  const errors = diagnostics.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length > 0) {
    return { ok: false, error: errors.map(diagnosticMessage).join("\n") };
  }

  return { ok: true };
}

function diagnosticMessage(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file === undefined || diagnostic.start === undefined) {
    return message;
  }

  const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return `${diagnostic.file.fileName}:${position.line + 1}:${position.character + 1} ${message}`;
}

function isZuvCodeSourceTree(projectRoot: string): boolean {
  const packagePath = join(projectRoot, "package.json");
  if (!existsSync(packagePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
    return parsed.name === "zuvcode" && existsSync(join(projectRoot, "packages", "orchestration"));
  } catch {
    return false;
  }
}
