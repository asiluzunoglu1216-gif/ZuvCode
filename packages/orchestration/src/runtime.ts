import { AgentManager } from "@zuvcode/agents";
import { defaultProjectConfig, EventBus, type ZuvCodeEventName } from "@zuvcode/core";
import { ProjectMemory } from "@zuvcode/memory";
import { AutoModelRouter, builtinModelRegistry } from "@zuvcode/model-router";
import { PermissionEngine, type PermissionDecision } from "@zuvcode/permissions";
import { StateStore, type AgentRecord, type ProviderRecord, type TaskRecord } from "@zuvcode/persistence";
import { detectProject, type ProjectSnapshot } from "@zuvcode/project";
import type { AgentCallbacks, ChatMessage, ModelMetadata, ModelResponse } from "@zuvcode/protocol";
import { ProviderManager, providerDefaults, SecretResolver, UserConfigStore, type ProviderStatusView } from "@zuvcode/providers";
import { createLogger, createSilentLogger, type Logger, type PermissionMode, type ProviderKind } from "@zuvcode/shared";
import { createId, defaultExecutionStepLimit, executionStepLimitSchema, permissionModeSchema, providerKindSchema } from "@zuvcode/shared";
import { SkillLoader, type LoadedSkill } from "@zuvcode/skills";
import { TaskPlanner, type PlanResult } from "@zuvcode/tasks";
import { AgentTools, agentToolDefinitions, FileHistory, FilesystemTool, ShellTool, type FileChange, type WebOptions } from "@zuvcode/tools";
import { SimpleCodingExecutor, type SimpleExecutionResult } from "./simple-coding-executor.js";
import { runAgent, type AgentRunOptions } from "./agent-loop.js";
import { TeamRunner, validateGoal } from "./team-runner.js";

export interface ZuvCodeRuntimeOptions {
  projectRoot?: string;
  permissionMode?: PermissionMode;
  logger?: Logger;
  userConfigDir?: string;
}

export interface DoctorReport {
  nodeVersion: string;
  project: ProjectSnapshot;
  databasePath: string;
  providerCount: number;
  agentCount: number;
  taskCount: number;
  skillCount: number;
  permissionMode: PermissionMode;
  protectedPaths: string[];
}

export interface RunGoalResult {
  plan: PlanResult;
  selectedModel?: ModelMetadata;
  routeReason?: string;
  execution?: SimpleExecutionResult;
  evidence: string[];
}

export interface AddProviderOptions {
  kind: ProviderKind;
  name?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKey?: string;
}

export interface AddModelOptions {
  providerName: string;
  providerKind?: ProviderKind;
  modelId: string;
  displayName?: string;
  locality?: ModelMetadata["locality"];
  codingSuitability?: ModelMetadata["codingSuitability"];
  reasoningSuitability?: ModelMetadata["reasoningSuitability"];
  contextWindow?: number;
}

export class ZuvCodeRuntime {
  public readonly projectRoot: string;
  public readonly store: StateStore;
  public readonly permissions: PermissionEngine;
  public readonly secrets = new SecretResolver();
  public readonly events = new EventBus();

  private readonly logger: Logger;
  private readonly providers: ProviderManager;
  private readonly agents: AgentManager;
  private readonly planner: TaskPlanner;
  private readonly memory: ProjectMemory;
  private readonly skills: SkillLoader;
  private initialized = false;
  private readonly userConfig: UserConfigStore | undefined;
  private conversation: ChatMessage[] = [];
  private readonly agentTools: AgentTools;
  private readonly fileHistory: FileHistory;
  private chatting = false;
  private serperKey: string | undefined;
  private readonly jsonToolModels = new Set<string>();
  private readonly explicitPermissionMode: boolean;
  private readonly teamChanges: FileChange[] = [];

  public constructor(options: ZuvCodeRuntimeOptions = {}) {
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.logger = options.logger ?? createLogger("zuvcode");
    this.userConfig = options.userConfigDir ? new UserConfigStore(options.userConfigDir) : undefined;
    this.explicitPermissionMode = options.permissionMode !== undefined;
    this.permissions = new PermissionEngine({ mode: options.permissionMode ?? this.userConfig?.read().permissionMode ?? "SAFE" });
    this.store = new StateStore({ projectRoot: this.projectRoot, logger: this.logger });
    this.providers = new ProviderManager(this.secrets);
    this.agents = new AgentManager(this.store);
    this.planner = new TaskPlanner(this.store);
    this.memory = new ProjectMemory(this.projectRoot);
    this.skills = new SkillLoader(this.projectRoot);
    this.fileHistory = options.userConfigDir ? FileHistory.forUser(this.projectRoot, options.userConfigDir) : new FileHistory(this.projectRoot);
    this.agentTools = new AgentTools(this.projectRoot, this.permissions, () => this.webOptions(), this.fileHistory);
  }

  public static silent(options: ZuvCodeRuntimeOptions = {}): ZuvCodeRuntime {
    return new ZuvCodeRuntime({ ...options, logger: options.logger ?? createSilentLogger() });
  }

  public initialize(): void {
    if (this.initialized) {
      return;
    }

    this.store.initialize();
    if (!this.explicitPermissionMode && !this.userConfig) {
      this.permissions.mode = permissionModeSchema.parse(this.store.getSetting("permissionMode") ?? "SAFE");
    }
    const snapshot = detectProject(this.projectRoot);
    const project = this.store.ensureProject(this.projectRoot, snapshot.name);
    this.store.createSession(project.id);
    this.memory.ensureBaseFiles();
    if (!this.store.getSetting("projectConfig")) this.store.setSetting("projectConfig", defaultProjectConfig());
    if (this.userConfig) {
      const existing = new Set(this.userConfig.read().providers.map((item) => item.name.toLowerCase()));
      for (const provider of this.store.listProviders()) {
        if (!existing.has(provider.name.toLowerCase()) && !provider.apiKeySession) this.userConfig.saveProvider(provider);
      }
      const saved = new Set(this.userConfig.read().models.map((item) => `${item.provider}/${item.id}`));
      const legacy = this.store.listStoredModels().map((item) => item.metadata)
        .filter((item) => !saved.has(`${item.provider}/${item.id}`));
      if (legacy.length) this.userConfig.saveModels(legacy);
    }
    for (const provider of this.userConfig?.read().providers ?? []) {
      if (provider.apiKeySession) {
        const secret = this.userConfig?.loadSecret(provider.apiKeySession);
        if (secret) this.secrets.setSessionSecret(provider.apiKeySession, secret);
      }
    }
    this.emit("project.detected", {
      project: snapshot.name,
      hasGit: snapshot.hasGit,
      packageManager: snapshot.packageManager ?? "unknown"
    });
    this.emit("session.started", {
      project: snapshot.name,
      rootPath: this.projectRoot
    });
    this.initialized = true;
  }

  public doctor(): DoctorReport {
    this.initialize();
    return {
      nodeVersion: process.version,
      project: detectProject(this.projectRoot),
      databasePath: this.store.dbPath,
      providerCount: this.configuredProviders().length,
      agentCount: this.store.listAgents().length,
      taskCount: this.store.listTasks().length,
      skillCount: this.skills.listProjectSkills().length,
      permissionMode: this.permissions.mode,
      protectedPaths: this.permissions.protectedPaths
    };
  }

  public listProviders(): ProviderStatusView[] {
    this.initialize();
    return this.providers.listProviderStatus(this.configuredProviders());
  }

  public configuredProviders(): ProviderRecord[] {
    this.initialize();
    const records = new Map<string, ProviderRecord>();
    for (const provider of [...this.store.listProviders(), ...(this.userConfig?.read().providers ?? [])]) {
      records.set(provider.name.toLowerCase(), provider as ProviderRecord);
    }
    return [...records.values()];
  }

  public addProvider(options: AddProviderOptions): ProviderRecord {
    this.initialize();
    const kind = providerKindSchema.parse(options.kind);
    const defaults = providerDefaults(kind);
    const name = options.name?.trim() || defaults.name;
    const existing = this.configuredProviders().find((item) => item.name.toLowerCase() === name.toLowerCase());
    const input: Parameters<StateStore["upsertProvider"]>[0] = {
      id: existing?.id ?? defaults.id,
      kind,
      name,
      status: "detected"
    };
    const baseUrl = options.baseUrl ?? existing?.baseUrl ?? defaults.baseUrl;
    if (baseUrl !== undefined) {
      const url = new URL(baseUrl);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Enter an HTTP(S) endpoint without embedded credentials.");
      input.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    if (options.apiKeyEnv !== undefined) {
      input.apiKeyEnv = options.apiKeyEnv;
    } else if (existing?.apiKeyEnv) {
      input.apiKeyEnv = existing.apiKeyEnv;
    }
    if (options.apiKey?.trim()) {
      input.apiKeySession = `provider:${input.id}`;
      this.userConfig?.saveSecret(input.apiKeySession, options.apiKey.trim());
      this.secrets.setSessionSecret(input.apiKeySession, options.apiKey.trim());
      delete input.apiKeyEnv;
    } else if (existing?.apiKeySession && !options.apiKeyEnv) {
      input.apiKeySession = existing.apiKeySession;
    }
    const provider = this.store.upsertProvider(input);
    this.userConfig?.saveProvider(provider);
    this.emit("provider.configured", {
      provider: provider.name,
      kind: provider.kind,
      apiKeyEnv: provider.apiKeyEnv
    });
    return provider;
  }

  public async listModels(): Promise<ModelMetadata[]> {
    this.initialize();
    const configured = this.configuredProviders();
    const liveModels = await this.providers.listModels(configured);
    const storedModels = this.store.listStoredModels().map((model) => model.metadata);
    return mergeModels(liveModels, storedModels, this.userConfig?.read().models ?? [], builtinModelRegistry());
  }

  public async discoverModels(providerId?: string, signal?: AbortSignal): Promise<ModelMetadata[]> {
    const records = this.configuredProviders().filter((item) => !providerId || item.id === providerId);
    const outcomes = await Promise.all(records.map(async (record) => {
      const adapter = this.providers.createProvider(record);
      if (!adapter) throw new Error(`${record.name} is not supported yet.`);
      const models = await adapter.listModels(signal);
      signal?.throwIfAborted();
      const updated = this.store.upsertProvider({ ...record, status: "connected" });
      this.userConfig?.saveProvider(updated);
      for (const model of models) this.store.upsertModel(record.id, model);
      this.userConfig?.saveModels(models);
      return models;
    }).map((job) => job.then((models) => ({ models }), (error: unknown) => ({ error }))));
    signal?.throwIfAborted();
    const models = outcomes.flatMap((item) => "models" in item ? item.models : []);
    if (!models.length && outcomes.some((item) => "error" in item)) {
      const failed = outcomes.find((item) => "error" in item);
      throw failed && "error" in failed ? failed.error : new Error("Model discovery failed.");
    }
    return mergeModels(models);
  }

  public savedModels(): ModelMetadata[] {
    this.initialize();
    const connected = new Set(this.configuredProviders().map((provider) => provider.name));
    return mergeModels(this.userConfig?.read().models ?? [], this.store.listStoredModels().map((item) => item.metadata))
      .filter((model) => connected.has(model.provider) && !model.id.endsWith(":unavailable"));
  }

  public selectedModel(): string {
    this.initialize();
    return this.userConfig?.read().selectedModel ?? this.store.getSetting<string>("selectedModel") ?? "AUTO";
  }

  public selectModel(model: ModelMetadata | "AUTO"): void {
    const value = model === "AUTO" ? "AUTO" : `${model.provider}/${model.id}`;
    if (value !== this.selectedModel()) this.clearConversation();
    if (model !== "AUTO") {
      const provider = this.configuredProviders().find((item) => item.name === model.provider);
      if (!provider) throw new Error("Connect the provider first with /connect.");
      this.store.upsertProvider(provider);
      this.store.upsertModel(provider.id, model);
      this.userConfig?.saveModel(model);
    }
    this.store.setSetting("selectedModel", value);
    this.userConfig?.selectModel(value);
  }

  public clearConversation(): void { this.conversation = []; }

  public executionStepLimit(): number {
    this.initialize();
    return executionStepLimitSchema.parse(this.store.getSetting("executionStepLimit") ?? defaultExecutionStepLimit);
  }

  public setExecutionStepLimit(limit: number): void {
    if (this.chatting) throw new Error("Wait for the current task before changing its work budget.");
    this.initialize();
    this.store.setSetting("executionStepLimit", executionStepLimitSchema.parse(limit));
  }

  public async chat(text: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<ModelResponse> {
    return this.withExecution(async () => {
    const session = await this.agentSession(this.selectedModel(), signal);
    while (JSON.stringify(this.conversation).length > 160_000) {
      const nextTurn = this.conversation.findIndex((message, index) => index > 0 && message.role === "user");
      this.conversation.splice(0, nextTurn > 0 ? nextTurn : this.conversation.length);
    }
    this.conversation.push({ role: "user", content: text });
    return runAgent({ ...session, messages: this.conversation, tools: this.agentTools, ...callbacks });
    });
  }

  private async agentSession(selection: string, signal?: AbortSignal): Promise<Omit<AgentRunOptions, "messages" | "tools">> {
    const selected = selection === "AUTO" ? this.selectedModel() : selection;
    let models = this.savedModels();
    if (!models.length) models = await this.discoverModels(undefined, signal);
    const model = selected === "AUTO"
      ? new AutoModelRouter(models).route({ taskKind: "coding", budgetMode: "balanced" })?.model
      : models.find((item) => `${item.provider}/${item.id}` === selected);
    if (!model) throw new Error("No model selected. Open /connect, then /model.");
    const record = this.configuredProviders().find((item) => item.name === model.provider);
    const adapter = record && this.providers.createProvider(record);
    if (!adapter) throw new Error("This model's provider is unavailable. Open /connect.");
    const toolModel = `${record!.id}/${record!.baseUrl}/${model.id}`;
    return { provider: adapter, model: model.id, root: this.projectRoot,
      maxSteps: this.executionStepLimit(),
      permissionMode: this.permissions.mode, jsonMode: this.jsonToolModels.has(toolModel),
      onNativeToolsUnsupported: () => this.jsonToolModels.add(toolModel), ...(signal ? { signal } : {}) };
  }

  private async withExecution<T>(action: () => Promise<T>): Promise<T> {
    if (this.chatting) throw new Error("Another task is already running.");
    this.initialize();
    const owner = createId("execution");
    this.store.acquireExecutionLock(owner);
    this.chatting = true;
    try { return await action(); }
    finally { this.chatting = false; this.store.releaseExecutionLock(owner); }
  }

  private teamRunner(): TeamRunner {
    return new TeamRunner({ store: this.store, session: (selection, signal) => this.agentSession(selection, signal),
      createTools: () => new AgentTools(this.projectRoot, this.permissions, () => this.webOptions(), this.fileHistory),
      ensureSpecialist: (spec) => this.agents.ensureSpecialist(spec),
      recordChanges: (changes) => this.teamChanges.push(...changes) });
  }

  public async planTeam(goal: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    return this.withExecution(() => this.teamRunner().plan(goal, this.agents.createAgent("orchestrator"), signal, callbacks));
  }

  public async runTeam(goal: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    return this.withExecution(async () => {
      const runner = this.teamRunner();
      const tasks = await runner.plan(goal, this.agents.createAgent("orchestrator"), signal, callbacks);
      return runner.execute(tasks.map((task) => task.id), signal, callbacks);
    });
  }

  public async runSavedPlan(signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    return this.withExecution(() => this.teamRunner().execute(this.store.getTeamRun()?.taskIds ?? [], signal, callbacks));
  }

  public findTask(reference: string): TaskRecord {
    this.initialize();
    const tasks = this.store.listTasks().filter((task) => task.id === reference || (reference.length >= 4 && task.id.endsWith(reference)));
    if (tasks.length !== 1) throw new Error(tasks.length ? "Ambiguous task ID. Use the full ID." : "Task not found. Use /tasks to see task IDs.");
    return tasks[0]!;
  }

  public async runTask(reference: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord> {
    return this.withExecution(async () => {
      const task = this.findTask(reference);
      if (task.status === "complete") throw new Error("This task is already complete. Start a new /team goal for follow-up work.");
      if (this.store.getTeamRun()?.taskIds.includes(task.id)) return (await this.teamRunner().execute([task.id], signal, callbacks))[0]!;
      return this.teamRunner().runTask(task, signal, callbacks);
    });
  }

  public teamState() {
    this.initialize();
    const run = this.store.getTeamRun();
    return { run, agents: this.listAgents().filter((agent) => run?.agentIds.includes(agent.id)), messages: run ? this.store.listTeamMessages(run.id) : [] };
  }

  public async retryTeamTask(reference: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    return this.withExecution(() => {
      const task = this.findTask(reference);
      if (task.status === "complete") throw new Error("This task is already complete.");
      return this.teamRunner().execute([task.id], signal, callbacks);
    });
  }

  public async runNamedAgent(name: string, goal: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord> {
    return this.withExecution(async () => {
      validateGoal(goal);
      const agent = this.store.findAgentByName(name);
      if (!agent) throw new Error(`Agent not found: ${name}. Start /team <goal> to create the specialists the job needs.`);
      const task = this.store.createTask({ title: goal.trim().split("\n")[0]!.slice(0, 120), description: goal, ownerAgentId: agent.id, status: "ready" });
      return this.teamRunner().runTask(task, signal, callbacks);
    });
  }

  public setAgentModel(name: string, selection: string): void {
    this.initialize();
    if (this.chatting) throw new Error("Wait for the current task before changing agent models.");
    const agent = this.store.findAgentByName(name);
    if (!agent) throw new Error(`Agent not found: ${name}.`);
    if (selection !== "AUTO" && !this.savedModels().some((model) => `${model.provider}/${model.id}` === selection)) throw new Error("Model not found. Use /connect or Enter a model ID in /model first.");
    this.store.setAgentModel(agent.id, selection);
  }

  public fileChanges() { return [...this.agentTools.files.changes, ...this.teamChanges]; }

  public async fileCheckpoints() {
    return this.withExecution(() => this.fileHistory.list());
  }

  public async recoverFiles(reference: string): Promise<string> {
    return this.withExecution(() => this.fileHistory.recover(reference));
  }

  public setPermissionMode(value: PermissionMode): void {
    if (this.chatting) throw new Error("Wait for the current task before changing permissions.");
    this.initialize();
    const mode = permissionModeSchema.parse(value);
    this.userConfig?.setPermissionMode(mode);
    this.store.setSetting("permissionMode", mode);
    this.permissions.mode = mode;
  }

  public webStatus(): string {
    const options = this.webOptions();
    return options.enabled === false ? "Off" : options.serperKey ? "Google (Serper)" : "DuckDuckGo (no key)";
  }

  public configureWeb(mode: "on" | "off" | "default" | "google", key?: string): void {
    this.initialize();
    if (mode === "google") {
      if (!key?.trim()) throw new Error("Enter a Serper API key.");
      this.userConfig?.saveSecret("web:serper", key.trim());
      this.serperKey = key.trim();
    }
    const options = { webEnabled: mode !== "off", ...(mode === "google" || mode === "default" ? { googleSearch: mode === "google" } : {}) };
    this.userConfig?.configureWeb(options);
    this.store.setSetting("webOptions", { ...this.store.getSetting<object>("webOptions"), ...options });
  }

  private webOptions(): WebOptions {
    this.initialize();
    const saved = this.userConfig?.read() ?? this.store.getSetting<{ webEnabled?: boolean; googleSearch?: boolean }>("webOptions") ?? {};
    const google = saved.googleSearch ?? Boolean(process.env.SERPER_API_KEY);
    if (saved.webEnabled !== false && google && !this.serperKey) this.serperKey = process.env.SERPER_API_KEY || this.userConfig?.loadSecret("web:serper");
    return { enabled: saved.webEnabled ?? true, ...(google && this.serperKey ? { serperKey: this.serperKey } : {}) };
  }

  public addModel(options: AddModelOptions): ModelMetadata {
    this.initialize();
    const providerKind = providerKindSchema.parse(options.providerKind ?? "openai-compatible");
    const provider =
      this.configuredProviders()
        .find((candidate) => candidate.name.toLowerCase() === options.providerName.toLowerCase() || candidate.id === options.providerName) ??
      this.addProvider({
        kind: providerKind,
        name: options.providerName
      });

    const metadata: ModelMetadata = {
      provider: provider.name,
      id: options.modelId,
      displayName: options.displayName ?? options.modelId,
      capabilities: {
        vision: false,
        toolCalling: provider.kind !== "ollama",
        structuredOutput: provider.kind !== "ollama",
        streaming: true
      },
      speed: "balanced",
      codingSuitability: options.codingSuitability ?? "medium",
      reasoningSuitability: options.reasoningSuitability ?? "medium",
      locality: options.locality ?? (["ollama", "lmstudio", "vllm", "llamacpp"].includes(provider.kind) || /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(provider.baseUrl ?? "") ? "local" : "cloud"),
      availability: "unknown"
    };

    if (options.contextWindow !== undefined) {
      metadata.contextWindow = options.contextWindow;
    }

    this.store.upsertProvider(provider);
    this.store.upsertModel(provider.id, metadata);
    this.userConfig?.saveModel(metadata);
    this.emit("model.response", {
      provider: provider.name,
      model: metadata.id,
      source: "manual-registry"
    });
    return metadata;
  }

  public createAgent(role: string, selectedModel = "AUTO"): AgentRecord {
    this.initialize();
    const agent = this.agents.createAgent(role, selectedModel);
    this.emit("agent.spawned", { agentId: agent.id, role: agent.role, selectedModel });
    return agent;
  }

  public listAgents(): AgentRecord[] {
    this.initialize();
    return this.agents.listAgents();
  }

  public listTasks(): TaskRecord[] {
    this.initialize();
    return this.store.listTasks();
  }

  public listSkills(): LoadedSkill[] {
    this.initialize();
    return this.skills.listProjectSkills();
  }

  public plan(goal: string): PlanResult {
    this.initialize();
    const team = this.agents.ensureDefaultTeam();
    const owner = team.find((agent) => agent.name === "orchestrator") ?? team[0];
    const plan = this.planner.createPlan(goal, owner);
    this.memory.append("decisions", "Definition of Done Created", `Goal:\n${goal}\n\nTasks: ${plan.tasks.length}`);
    this.emit("tasks.planned", { goal, taskCount: plan.tasks.length });
    return plan;
  }

  public async runGoal(goal: string): Promise<RunGoalResult> {
    this.initialize();
    const plan = this.plan(goal);
    const models = await this.listModels();
    const configuredNames = new Set(this.configuredProviders().map((item) => item.name));
    const selected = this.selectedModel();
    const usable = models.filter((item) => configuredNames.has(item.provider));
    const manual = usable.find((item) => `${item.provider}/${item.id}` === selected);
    const router = new AutoModelRouter(usable);
    const route = selected !== "AUTO" ? (manual ? { model: manual, reason: "Manually selected model." } : undefined) : router.route({
      taskKind: inferRouteKind(goal),
      budgetMode: "balanced"
    });

    const evidence: string[] = [];
    if (route !== undefined) {
      evidence.push(`Model route: ${route.model.provider}/${route.model.id}`);
    } else {
      evidence.push("Model route: no compatible model available");
    }

    let execution: SimpleExecutionResult | undefined;
    if (canUseSimpleExecutor(goal)) {
      const filesystem = new FilesystemTool(this.projectRoot, this.permissions);
      const shell = new ShellTool(this.projectRoot, this.permissions);
      const executor = new SimpleCodingExecutor({
        projectRoot: this.projectRoot,
        filesystem,
        shell
      });
      execution = await executor.tryExecute(goal);
      evidence.push(...execution.evidence);
      if (execution.ok) {
        markVerified(plan.definitionOfDone, "build", "Generated TypeScript compiled successfully.");
        markVerified(plan.definitionOfDone, "features", "Generated REST API implements health, create, and list endpoints.");
        markVerified(plan.definitionOfDone, "tests", "In-process endpoint verification passed.");
        markVerified(plan.definitionOfDone, "runtime", "Generated server started and responded without a critical runtime error.");
        markVerified(plan.definitionOfDone, "config", "Generated package.json and tsconfig.json.");
        markVerified(plan.definitionOfDone, "docs", "Generated README.md.");
        markVerified(plan.definitionOfDone, "request-check", "Goal matched and completed by built-in REST API executor.");
      }
      for (const task of plan.tasks) {
        this.store.updateTaskStatus(task.id, execution.ok ? "complete" : "failed", execution.evidence);
      }
    } else {
      evidence.push("Execution: plan persisted. Automatic implementation is currently limited to the built-in TypeScript REST API workflow. Use chat for model responses.");
    }

    this.emit("goal.run", {
      goal,
      taskCount: plan.tasks.length,
      selectedModel: route?.model.id,
      executed: execution !== undefined
    });

    const result: RunGoalResult = {
      plan,
      evidence
    };

    if (route !== undefined) {
      result.selectedModel = route.model;
      result.routeReason = route.reason;
    }
    if (execution !== undefined) {
      result.execution = execution;
    }

    return result;
  }

  public toolSecurityStatus() {
    return { tools: agentToolDefinitions.map((tool) => tool.function.name),
      workBudget: { modelTurnsPerTask: this.executionStepLimit(), independentOfPermissions: true },
      fileRecovery: { directory: this.fileHistory.directory, enabled: true, scope: "Regular project files; excludes secrets, links and generated/internal folders", limits: "8 MiB/file, 128 MiB and 10000 files/checkpoint", command: "/changes history" },
      destructiveCleanupGuard: "On in every mode; heuristic, not an OS sandbox",
      filesystem: this.permissions.mode === "FULL_ACCESS" ? "OS user access, including paths outside the project" : "Project-scoped; secrets and linked paths blocked",
      shell: this.permissions.mode === "FULL_ACCESS" ? "No approval prompts; not OS-sandboxed"
        : this.permissions.mode === "SAFE" ? "Approval for every operation" : "Routine project checks run automatically; other commands ask",
      web: this.webStatus(), mode: this.permissions.mode };
  }

  public evaluatePermission(kind: Parameters<PermissionEngine["evaluate"]>[0]): PermissionDecision {
    return this.permissions.evaluate(kind);
  }

  public close(): void {
    this.store.close();
  }

  private emit(name: ZuvCodeEventName, payload: Record<string, unknown>): void {
    this.events.emit(name, payload);
    this.store.recordEvent(name, payload);
  }
}

function mergeModels(...groups: ModelMetadata[][]): ModelMetadata[] {
  const seen = new Set<string>();
  const merged: ModelMetadata[] = [];
  for (const model of groups.flat()) {
    const key = `${model.provider}:${model.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(model);
  }

  return merged;
}

function inferRouteKind(goal: string): "planning" | "coding" | "research" | "small-edit" | "testing" | "offline" | "vision" {
  const normalized = goal.toLowerCase();
  if (normalized.includes("test")) {
    return "testing";
  }
  if (normalized.includes("research")) {
    return "research";
  }
  if (normalized.includes("image") || normalized.includes("vision")) {
    return "vision";
  }
  if (normalized.includes("fix") || normalized.includes("edit")) {
    return "small-edit";
  }
  if (normalized.includes("api") || normalized.includes("build") || normalized.includes("code")) {
    return "coding";
  }
  return "planning";
}

function canUseSimpleExecutor(goal: string): boolean {
  const normalized = goal.toLowerCase();
  return normalized.includes("simple") && normalized.includes("typescript") && normalized.includes("rest api");
}

function markVerified(items: PlanResult["definitionOfDone"], id: string, evidence: string): void {
  const item = items.find((candidate) => candidate.id === id);
  if (item !== undefined) {
    item.verified = true;
    item.evidence = evidence;
  }
}
