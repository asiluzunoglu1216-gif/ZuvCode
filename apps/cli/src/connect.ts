import type { ZuvCodeRuntime } from "@zuvcode/orchestration";
import { availableProviderEnvVar, providerDefaults } from "@zuvcode/providers";
import type { ModelMetadata } from "@zuvcode/protocol";
import type { ProviderKind } from "@zuvcode/shared";
import { ask, askSecret, busy, choose, plain, theme, type Choice } from "@zuvcode/terminal-ui";

export const connectionPresets: Array<{ kind: ProviderKind; name: string; local?: boolean }> = [
  { kind: "ollama", name: "Ollama", local: true },
  { kind: "lmstudio", name: "LM Studio", local: true },
  { kind: "google", name: "Google Gemini" },
  { kind: "nvidia", name: "NVIDIA Build" },
  { kind: "openrouter", name: "OpenRouter" },
  { kind: "openai", name: "OpenAI" },
  { kind: "deepseek", name: "DeepSeek" },
  { kind: "groq", name: "Groq" },
  { kind: "mistral", name: "Mistral" },
  { kind: "xai", name: "xAI" },
  { kind: "openai-compatible", name: "Custom endpoint" }
];

export async function connectProvider(runtime: ZuvCodeRuntime): Promise<void> {
  const kind = await choose({ title: "Connect a provider", choices: connectionPresets.map((item) => ({
    value: item.kind, name: item.name, description: item.local ? "Local" : item.kind === "openai-compatible" ? "OpenAI-compatible" : "API key"
  })) }, { clearPromptOnDone: true });
  if (!kind) return;
  const preset = connectionPresets.find((item) => item.kind === kind)!;
  let existing = runtime.configuredProviders().find((item) => item.kind === kind);
  const options: Parameters<ZuvCodeRuntime["addProvider"]>[0] = { kind: preset.kind };
  if (kind === "openai-compatible") {
    options.baseUrl = (await ask("Endpoint URL", existing?.baseUrl ?? "http://localhost:1234/v1")).trim();
    const url = new URL(options.baseUrl);
    options.name = `Custom (${url.host})`;
    existing = runtime.configuredProviders().find((item) => item.name === options.name && item.baseUrl === options.baseUrl);
  } else if (existing?.baseUrl) {
    options.baseUrl = existing.baseUrl;
  }
  const local = preset.local || (options.baseUrl && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(options.baseUrl).hostname));
  const envVar = availableProviderEnvVar(kind);
  if (!local) {
    if (envVar && process.env[envVar]) options.apiKeyEnv = envVar;
    else if (!existing?.apiKeySession && !existing?.apiKeyEnv) {
      const key = (await askSecret(`${preset.name} API key${kind === "openai-compatible" ? " (optional)" : ""}`)).trim();
      if (!key && kind !== "openai-compatible") return;
      if (key) options.apiKey = key;
    }
  }
  let provider = runtime.addProvider(options);
  let models: ModelMetadata[];
  try {
    models = await busy(`Connecting to ${provider.name}`, (signal) => runtime.discoverModels(provider.id, signal));
  } catch (error) {
    if (cancelled(error)) return;
    console.log(theme.error(`  ${connectionError(error, provider.baseUrl)}`));
    const action = await choose({ title: "Connection saved", choices: [
      { name: "Change endpoint", value: "endpoint" },
      { name: "Replace API key", value: "key" },
      { name: "Enter a model ID", value: "manual" },
      { name: "Back", value: "back" }
    ] }, { clearPromptOnDone: true });
    if (!action || action === "back") return;
    if (action === "manual") { await addManualModel(runtime, provider.name); return; }
    if (action === "endpoint") options.baseUrl = (await ask("Endpoint URL", provider.baseUrl ?? providerDefaults(preset.kind).baseUrl)).trim();
    if (action === "key") { options.apiKey = (await askSecret(`${preset.name} API key`)).trim(); if (!options.apiKey) return; delete options.apiKeyEnv; }
    provider = runtime.addProvider({ ...options, name: provider.name });
    models = await busy(`Connecting to ${provider.name}`, (signal) => runtime.discoverModels(provider.id, signal));
  }
  console.log(theme.accent(`  Connected to ${plain(provider.name)}. ${models.length} models.`));
  if (!models.length) {
    console.log(theme.muted(preset.local ? "  No models loaded in the local server." : "  No models returned by this endpoint."));
    await addManualModel(runtime, provider.name);
    return;
  }
  await selectFromModels(runtime, models);
}

export async function pickModel(runtime: ZuvCodeRuntime): Promise<void> {
  if (!runtime.configuredProviders().length) { await connectProvider(runtime); return; }
  let models = runtime.savedModels();
  if (!models.length) {
    try { models = await busy("Loading models", (signal) => runtime.discoverModels(undefined, signal)); }
    catch (error) { if (cancelled(error)) return; console.log(theme.error(`  ${connectionError(error)}`)); }
  }
  await selectFromModels(runtime, models, true);
}

async function selectFromModels(runtime: ZuvCodeRuntime, models: ModelMetadata[], extra = false): Promise<void> {
  const selected = runtime.selectedModel();
  const choices: Choice[] = models.map((model) => ({
    value: `${model.provider}/${model.id}`, name: model.displayName,
    description: `${model.provider}${selected === `${model.provider}/${model.id}` ? " (active)" : ""}`
  }));
  if (extra) choices.unshift({ value: "AUTO", name: "Auto", description: "Choose a connected model" });
  choices.push({ value: "add", name: "Enter a model ID" });
  if (extra) choices.push({ value: "refresh", name: "Refresh models" }, { value: "connect", name: "Connect another provider" });
  const choice = await choose({ title: "Select model", choices }, { clearPromptOnDone: true });
  if (!choice) return;
  if (choice === "connect") { await connectProvider(runtime); return; }
  if (choice === "add") { await addManualModel(runtime, !extra ? models[0]?.provider : undefined); return; }
  if (choice === "refresh") {
    const refreshed = await busy("Refreshing models", (signal) => runtime.discoverModels(undefined, signal));
    await selectFromModels(runtime, refreshed, true);
    return;
  }
  const model = models.find((item) => `${item.provider}/${item.id}` === choice);
  if (choice === "AUTO") runtime.selectModel("AUTO");
  else if (model) runtime.selectModel(model);
  console.log(theme.accent(`  Model: ${plain(runtime.selectedModel())}\n`));
}

export async function addManualModel(runtime: ZuvCodeRuntime, providerName?: string): Promise<void> {
  const providers = runtime.configuredProviders();
  if (!providers.length) { await connectProvider(runtime); return; }
  let name = providerName ?? (providers.length === 1 ? providers[0]?.name : undefined);
  if (!name) name = await choose({ title: "Provider", choices: providers.map((item) => ({ value: item.name, name: item.name })) }, { clearPromptOnDone: true });
  if (!name) return;
  const id = (await ask("Model ID")).trim();
  if (!id) return;
  const model = runtime.addModel({ providerName: name, modelId: id });
  runtime.selectModel(model);
  console.log(theme.accent(`  Model: ${plain(runtime.selectedModel())}\n`));
}

function connectionError(error: unknown, endpoint?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch failed|ECONNREFUSED/.test(message)) return `Cannot reach ${endpoint ?? "the provider"}. Check that the server is running.`;
  return plain(message);
}

function cancelled(error: unknown): boolean {
  return error instanceof Error && (error.message === "Cancelled." || ["ExitPromptError", "AbortPromptError", "AbortError"].includes(error.name));
}
