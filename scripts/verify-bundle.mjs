import { createServer } from "node:http";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const entry = resolve(process.argv[2]);
const root = mkdtempSync(join(tmpdir(), "zuvcode-bundle-test-"));
const home = join(root, "private");
let calls = 0;
const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/v1/models") { response.end(JSON.stringify({ data: [{ id: "release-fixture" }] })); return; }
  if (request.url !== "/v1/chat/completions") { response.writeHead(404); response.end(); return; }
  let text = "";
  for await (const chunk of request) text += chunk;
  const body = JSON.parse(text);
  assert.equal(body.model, "release-fixture");
  const message = calls++ === 0
    ? { content: null, tool_calls: [{ id: "write-release", type: "function", function: { name: "write_file", arguments: JSON.stringify({ path: "index.html", content: "<!doctype html><h1>ZuvCode release verified</h1>" }) } }] }
    : { content: "Created and verified index.html." };
  response.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const run = async (args) => {
  const child = spawn(process.execPath, [entry, ...args], { cwd: root, windowsHide: true, env: { ...process.env, ZUVCODE_HOME: home }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  const timeout = setTimeout(() => child.kill(), 20_000);
  try { const [code] = await once(child, "exit"); assert.equal(code, 0, output); return output; }
  finally { clearTimeout(timeout); }
};
try {
  assert.ok(isAbsolute(entry));
  mkdirSync(home);
  await run(["provider:add", "--kind", "openai-compatible", "--name", "ReleaseFixture", "--base-url", `http://127.0.0.1:${server.address().port}/v1`]);
  await run(["model:add", "--provider", "ReleaseFixture", "--model", "release-fixture"]);
  const path = join(home, "config.json");
  const config = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify({ ...config, permissionMode: "FULL_ACCESS", selectedModel: "ReleaseFixture/release-fixture" }));
  const output = await run(["run", "Create index.html using the file tool."]);
  assert.equal(calls, 2, output);
  assert.equal(readFileSync(join(root, "index.html"), "utf8"), "<!doctype html><h1>ZuvCode release verified</h1>");
  console.log("PASS: portable provider/model configuration and actual model-driven file creation (local fixture only).");
} finally {
  server.closeAllConnections(); server.close();
  assert.ok(root.startsWith(join(tmpdir(), "zuvcode-bundle-test-")), "Unsafe fixture cleanup path.");
  rmSync(root, { recursive: true, force: true });
}
