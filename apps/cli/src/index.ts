#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { resolveUserConfigDirectory, zuvCodeVersion, type ProviderKind } from "@zuvcode/shared";
import { runCodingRequest, startInteractiveShell } from "./interactive.js";
import { withTerminalSession } from "@zuvcode/terminal-ui";
import { renderAgents, renderDoctor, renderModels, renderProviders, renderTasks } from "./render.js";

const program = new Command();

program
  .name("zuvcode")
  .description("Terminal-first multi-agent AI runtime")
  .version(zuvCodeVersion)
  .option("--project <path>", "Project root to operate in", process.cwd());

program.command("doctor").description("Inspect ZuvCode runtime health").action(async () => {
  const runtime = runtimeFromProgram();
  try {
    console.log(renderDoctor(runtime.doctor()));
  } finally {
    runtime.close();
  }
});

program.command("providers").description("List AI provider status").action(async () => {
  const runtime = runtimeFromProgram();
  try {
    console.log(renderProviders(runtime.listProviders()));
  } finally {
    runtime.close();
  }
});

program
  .command("provider:add")
  .description("Add a provider using secret references only")
  .requiredOption("--kind <kind>", "Provider kind, for example google, nvidia, openai-compatible or ollama")
  .option("--name <name>", "Provider display name")
  .option("--base-url <url>", "Provider base URL")
  .option("--api-key-env <name>", "Environment variable containing the API key")
  .action(async (options: { kind: ProviderKind; name?: string; baseUrl?: string; apiKeyEnv?: string }) => {
    const runtime = runtimeFromProgram();
    try {
      const input: Parameters<ZuvCodeRuntime["addProvider"]>[0] = {
        kind: options.kind,
      };
      if (options.name !== undefined) {
        input.name = options.name;
      }
      if (options.baseUrl !== undefined) {
        input.baseUrl = options.baseUrl;
      }
      if (options.apiKeyEnv !== undefined) {
        input.apiKeyEnv = options.apiKeyEnv;
      }
      const provider = runtime.addProvider(input);
      console.log(`Added provider ${provider.name} (${provider.kind}). Secret stored as reference only.`);
    } finally {
      runtime.close();
    }
  });

program.command("models").description("List configured and known models").action(async () => {
  const runtime = runtimeFromProgram();
  try {
    console.log(renderModels(await runtime.listModels()));
  } finally {
    runtime.close();
  }
});

program
  .command("model:add")
  .description("Add a model manually to the local registry")
  .requiredOption("--provider <name>", "Provider display name or id")
  .requiredOption("--model <id>", "Model id, for example qwen2.5-coder:latest")
  .option("--provider-kind <kind>", "Provider kind for a new provider", "openai-compatible")
  .option("--display-name <name>", "Display name")
  .option("--local", "Mark model as local")
  .option("--coding <level>", "Coding suitability: low, medium, high", "medium")
  .option("--reasoning <level>", "Reasoning suitability: low, medium, high", "medium")
  .option("--context <tokens>", "Context window tokens")
  .action(
    async (options: {
      provider: string;
      model: string;
      providerKind: ProviderKind;
      displayName?: string;
      local?: boolean;
      coding: "low" | "medium" | "high";
      reasoning: "low" | "medium" | "high";
      context?: string;
    }) => {
      const runtime = runtimeFromProgram();
      try {
        const input: Parameters<ZuvCodeRuntime["addModel"]>[0] = {
          providerName: options.provider,
          providerKind: options.providerKind,
          modelId: options.model,
          codingSuitability: parseSuitabilityOption(options.coding, "coding"),
          reasoningSuitability: parseSuitabilityOption(options.reasoning, "reasoning")
        };
        if (options.local === true) input.locality = "local";
        if (options.displayName !== undefined) {
          input.displayName = options.displayName;
        }
        if (options.context !== undefined) {
          input.contextWindow = parsePositiveIntegerOption(options.context, "context");
        }
        const model = runtime.addModel(input);
        console.log(`Added model ${model.provider}/${model.id} to the local registry.`);
      } finally {
        runtime.close();
      }
    }
  );

program.command("team").description("List project agents").action(async () => {
  const runtime = runtimeFromProgram();
  try {
    runtime.createAgent("orchestrator");
    console.log(renderAgents(runtime.listAgents()));
  } finally {
    runtime.close();
  }
});

program.command("tasks").description("List project tasks").action(async () => {
  const runtime = runtimeFromProgram();
  try {
    console.log(renderTasks(runtime.listTasks()));
  } finally {
    runtime.close();
  }
});

program
  .command("run")
  .description("Implement a coding task using the selected model and project tools")
  .argument("[goal...]", "Goal to run")
  .action(async (goalParts: string[]) => {
    const runtime = runtimeFromProgram();
    try {
      const goal = goalParts.join(" ").trim();
      if (goal.length === 0) {
        throw new Error("A goal is required. Example: zuvcode run Build a simple TypeScript REST API");
      }
      await withTerminalSession(() => runCodingRequest(runtime, goal));
    } finally {
      runtime.close();
    }
  });

program.command("update").description("Update a managed installation").action(() => {
  console.log("This is a source installation. Run pnpm setup after pulling published changes. The Windows one-line installer includes automatic updates: https://github.com/asiluzunoglu1216-gif/ZuvCode#install-on-windows");
});

program.action(async () => {
  const runtime = runtimeFromProgram();
  await startInteractiveShell(runtime);
});

try {
  await program.parseAsync(process.argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function runtimeFromProgram(): ZuvCodeRuntime {
  const options = program.opts<{ project: string }>();
  return ZuvCodeRuntime.silent({ projectRoot: resolve(options.project), userConfigDir: resolveUserConfigDirectory() });
}

function parseSuitabilityOption(value: string, optionName: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }

  throw new Error(`--${optionName} must be low, medium, or high.`);
}

function parsePositiveIntegerOption(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer.`);
  }

  return parsed;
}
