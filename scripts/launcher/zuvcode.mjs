#!/usr/bin/env node
import { existsSync } from "node:fs";

const entry = new URL("../../apps/cli/dist/index.js", import.meta.url);
if (!existsSync(entry)) {
  console.error("ZuvCode needs a build. Run pnpm build in its source folder.");
  process.exitCode = 1;
} else {
  await import(entry.href);
}
