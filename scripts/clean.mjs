import { rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const targets = [
  "apps/cli/dist",
  "packages/shared/dist",
  "packages/protocol/dist",
  "packages/persistence/dist",
  "packages/permissions/dist",
  "packages/providers/dist",
  "packages/model-router/dist",
  "packages/agents/dist",
  "packages/tasks/dist",
  "packages/tools/dist",
  "packages/project/dist",
  "packages/memory/dist",
  "packages/skills/dist",
  "packages/orchestration/dist",
  "packages/terminal-ui/dist",
  "coverage"
];

for (const target of targets) {
  rmSync(join(root, target), { force: true, recursive: true });
}

