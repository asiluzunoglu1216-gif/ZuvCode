import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync, type SqliteValue } from "node:sqlite";
import { modelMetadataSchema, type ModelMetadata } from "@zuvcode/protocol";
import {
  createId,
  resolveDataDirectory,
  nowIso,
  PersistenceError,
  providerKindSchema,
  taskStatusSchema,
  type AgentStatus,
  type Logger
} from "@zuvcode/shared";
import { migrations } from "./migrations.js";
import type { AgentRecord, EventRecord, ModelRecord, ProjectRecord, ProviderRecord, SessionRecord, TaskRecord, TeamMessageRecord, TeamRunRecord } from "./types.js";

export interface StateStoreOptions {
  projectRoot: string;
  logger: Logger;
}

export interface CreateProviderInput {
  id?: string;
  kind: ProviderRecord["kind"];
  name: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKeySession?: string;
  status?: ProviderRecord["status"];
}

export interface CreateAgentInput {
  id?: string;
  name: string;
  role: string;
  systemInstructions: string;
  selectedModel?: string;
  allowedTools?: string[];
  allowedFiles?: string[];
  memoryScope?: string;
  status?: AgentStatus;
}

export interface CreateTaskInput {
  id?: string;
  title: string;
  description: string;
  ownerAgentId?: string;
  status?: TaskRecord["status"];
  generatedFiles?: string[];
  testRequirements?: string[];
  completionEvidence?: string[];
  dependencies?: string[];
}

export class StateStore {
  public readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly logger: Logger;

  public constructor(options: StateStoreOptions) {
    this.dbPath = join(resolveDataDirectory(options.projectRoot), "state.db");
    this.logger = options.logger.child("state");
    mkdirSync(dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.exec("PRAGMA busy_timeout = 10000;");
    this.exec("PRAGMA journal_mode = WAL;");
  }

  public initialize(): void {
    this.exec("PRAGMA foreign_keys = ON;");
    this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL
      );
    `);
    for (const [index, migration] of migrations.entries()) {
      const name = `migration_${String(index + 1).padStart(3, "0")}`;
      const existing = this.getRow("SELECT id FROM schema_migrations WHERE name = ?", [name]);
      if (existing !== undefined) {
        continue;
      }

      this.exec("BEGIN IMMEDIATE;");
      try {
        const existingInsideTransaction = this.getRow("SELECT id FROM schema_migrations WHERE name = ?", [name]);
        if (existingInsideTransaction === undefined) {
          this.exec(migration);
          this.run("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)", [name, nowIso()]);
        }
        this.exec("COMMIT;");
        this.logger.debug("migration applied", { name });
      } catch (error) {
        try {
          this.exec("ROLLBACK;");
        } catch {
          // SQLite may already have cancelled the transaction after a lock error.
        }
        throw new PersistenceError(`Failed to apply ${name}`, { cause: error });
      }
    }
  }

  public ensureProject(rootPath: string, name: string): ProjectRecord {
    const existing = this.getRow("SELECT * FROM projects WHERE root_path = ?", [rootPath]);
    if (existing !== undefined) {
      return mapProject(existing);
    }

    const now = nowIso();
    const project: ProjectRecord = {
      id: createId("project"),
      rootPath,
      name,
      createdAt: now,
      updatedAt: now
    };

    this.run(
      "INSERT INTO projects (id, root_path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      [project.id, project.rootPath, project.name, project.createdAt, project.updatedAt]
    );

    return project;
  }

  public createSession(projectId: string): SessionRecord {
    const session: SessionRecord = {
      id: createId("session"),
      projectId,
      startedAt: nowIso(),
      status: "active"
    };

    this.run("INSERT INTO sessions (id, project_id, started_at, status) VALUES (?, ?, ?, ?)", [
      session.id,
      session.projectId,
      session.startedAt,
      session.status
    ]);

    return session;
  }

  public upsertProvider(input: CreateProviderInput): ProviderRecord {
    const now = nowIso();
    const provider: ProviderRecord = {
      id: input.id ?? createId("provider"),
      kind: input.kind,
      name: input.name,
      status: input.status ?? "add",
      createdAt: now,
      updatedAt: now
    };

    if (input.baseUrl !== undefined && input.baseUrl.trim().length > 0) {
      provider.baseUrl = input.baseUrl;
    }
    if (input.apiKeyEnv !== undefined && input.apiKeyEnv.trim().length > 0) {
      provider.apiKeyEnv = input.apiKeyEnv;
    }
    if (input.apiKeySession !== undefined && input.apiKeySession.trim().length > 0) {
      provider.apiKeySession = input.apiKeySession;
    }

    this.run(
      `
      INSERT INTO providers (id, kind, name, base_url, api_key_env, api_key_session, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        name = excluded.name,
        base_url = excluded.base_url,
        api_key_env = excluded.api_key_env,
        api_key_session = excluded.api_key_session,
        status = excluded.status,
        updated_at = excluded.updated_at
      `,
      [
        provider.id,
        provider.kind,
        provider.name,
        provider.baseUrl ?? null,
        provider.apiKeyEnv ?? null,
        provider.apiKeySession ?? null,
        provider.status,
        provider.createdAt,
        provider.updatedAt
      ]
    );

    return provider;
  }

  public listProviders(): ProviderRecord[] {
    return this.getRows("SELECT * FROM providers ORDER BY name ASC").map(mapProvider);
  }

  public upsertModel(providerId: string, metadata: ModelMetadata): ModelRecord {
    const now = nowIso();
    const validatedMetadata = modelMetadataSchema.parse(metadata);
    const model: ModelRecord = {
      id: createId("model"),
      providerId,
      modelId: validatedMetadata.id,
      displayName: validatedMetadata.displayName,
      metadata: validatedMetadata,
      availability: validatedMetadata.availability,
      updatedAt: now
    };

    this.run(
      `
      INSERT INTO models (id, provider_id, model_id, display_name, metadata_json, availability, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, model_id) DO UPDATE SET
        display_name = excluded.display_name,
        metadata_json = excluded.metadata_json,
        availability = excluded.availability,
        updated_at = excluded.updated_at
      `,
      [
        model.id,
        model.providerId,
        model.modelId,
        model.displayName,
        JSON.stringify(model.metadata),
        model.availability,
        model.updatedAt
      ]
    );

    const row = this.getRow("SELECT * FROM models WHERE provider_id = ? AND model_id = ?", [providerId, metadata.id]);
    if (row === undefined) {
      throw new PersistenceError(`Model was not saved: ${metadata.id}`);
    }

    return mapModel(row);
  }

  public listStoredModels(): ModelRecord[] {
    return this.getRows("SELECT * FROM models ORDER BY provider_id ASC, model_id ASC").map(mapModel);
  }

  public createAgent(input: CreateAgentInput): AgentRecord {
    const now = nowIso();
    const agent: AgentRecord = {
      id: input.id ?? createId("agent"),
      name: input.name,
      role: input.role,
      systemInstructions: input.systemInstructions,
      selectedModel: input.selectedModel ?? "AUTO",
      allowedTools: input.allowedTools ?? [],
      allowedFiles: input.allowedFiles ?? ["**/*"],
      memoryScope: input.memoryScope ?? "project",
      status: input.status ?? "idle",
      createdAt: now,
      updatedAt: now
    };

    this.run(
      `
      INSERT INTO agents
      (id, name, role, system_instructions, selected_model, allowed_tools_json, allowed_files_json, memory_scope, current_task_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        agent.id,
        agent.name,
        agent.role,
        agent.systemInstructions,
        agent.selectedModel,
        JSON.stringify(agent.allowedTools),
        JSON.stringify(agent.allowedFiles),
        agent.memoryScope,
        agent.currentTaskId ?? null,
        agent.status,
        agent.createdAt,
        agent.updatedAt
      ]
    );

    return agent;
  }

  public listAgents(): AgentRecord[] {
    return this.getRows("SELECT * FROM agents ORDER BY created_at ASC").map(mapAgent);
  }

  public findAgentByName(name: string): AgentRecord | undefined {
    const row = this.getRow("SELECT * FROM agents WHERE lower(name) = lower(?) LIMIT 1", [name]);
    return row === undefined ? undefined : mapAgent(row);
  }

  public updateAgentState(id: string, status: AgentStatus, taskId?: string): void {
    this.run("UPDATE agents SET status = ?, current_task_id = ?, updated_at = ? WHERE id = ?", [status, taskId ?? null, nowIso(), id]);
  }

  public setAgentModel(id: string, model: string): void {
    this.run("UPDATE agents SET selected_model = ?, updated_at = ? WHERE id = ?", [model, nowIso(), id]);
  }

  public createTask(input: CreateTaskInput): TaskRecord {
    const now = nowIso();
    const task: TaskRecord = {
      id: input.id ?? createId("task"),
      title: input.title,
      description: input.description,
      status: input.status ?? "queued",
      attempts: 0,
      generatedFiles: input.generatedFiles ?? [],
      testRequirements: input.testRequirements ?? [],
      completionEvidence: input.completionEvidence ?? [],
      dependencies: input.dependencies ?? [],
      resultText: "",
      modelUsed: "",
      createdAt: now,
      updatedAt: now
    };

    if (input.ownerAgentId !== undefined) {
      task.ownerAgentId = input.ownerAgentId;
    }

    this.run(
      `
      INSERT INTO tasks
      (id, title, description, owner_agent_id, status, attempts, generated_files_json, test_requirements_json, completion_evidence_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        task.id,
        task.title,
        task.description,
        task.ownerAgentId ?? null,
        task.status,
        task.attempts,
        JSON.stringify(task.generatedFiles),
        JSON.stringify(task.testRequirements),
        JSON.stringify(task.completionEvidence),
        task.createdAt,
        task.updatedAt
      ]
    );

    for (const dependency of input.dependencies ?? []) {
      this.run("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)", [
        task.id,
        dependency
      ]);
    }

    return task;
  }

  public listTasks(): TaskRecord[] {
    return this.getRows("SELECT * FROM tasks ORDER BY created_at ASC, rowid ASC").map((row) => this.taskWithDependencies(row));
  }

  public getTask(id: string): TaskRecord | undefined {
    const row = this.getRow("SELECT * FROM tasks WHERE id = ?", [id]);
    return row ? this.taskWithDependencies(row) : undefined;
  }

  private taskWithDependencies(row: Record<string, unknown>): TaskRecord {
    const task = mapTask(row);
    task.dependencies = this.getRows("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?", [task.id])
      .map((dependency) => String(dependency["depends_on_task_id"]));
    return task;
  }

  public saveTaskResult(id: string, status: TaskRecord["status"], result: string, model: string, files: string[], evidence: string[]): void {
    this.run("UPDATE tasks SET status = ?, result_text = ?, model_used = ?, generated_files_json = ?, completion_evidence_json = ?, updated_at = ? WHERE id = ?",
      [taskStatusSchema.parse(status), result.slice(0, 16000), model, JSON.stringify(files), JSON.stringify(evidence.slice(-100)), nowIso(), id]);
  }

  public transaction<T>(action: () => T): T {
    this.exec("BEGIN IMMEDIATE;");
    try { const value = action(); this.exec("COMMIT;"); return value; }
    catch (error) { this.exec("ROLLBACK;"); throw error; }
  }

  public acquireExecutionLock(owner: string): void {
    this.transaction(() => {
      const lock = this.getRow("SELECT * FROM execution_locks WHERE name = 'project'");
      if (lock) {
        let alive = true;
        try { process.kill(Number(lock["pid"]), 0); }
        catch (error) { alive = (error as NodeJS.ErrnoException).code !== "ESRCH"; }
        if (alive) throw new Error("Another ZuvCode operation is running in this project. Wait for it or cancel it first.");
        this.run("DELETE FROM execution_locks WHERE name = 'project'");
      }
      // A dead process cannot finish its tasks. Preserve files and require an explicit retry.
      this.run("UPDATE tasks SET status = 'cancelled', result_text = ?, updated_at = ? WHERE status = 'in_progress'",
        ["Previous process stopped. Inspect completed changes before retrying.", nowIso()]);
      this.run("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE status IN ('working', 'reviewing')");
      const interrupted = this.getTeamRun();
      if (interrupted && ["planning", "discussing", "running"].includes(interrupted.status)) {
        interrupted.status = "cancelled"; this.saveTeamRun(interrupted);
      }
      this.run("INSERT INTO execution_locks (name, owner, pid) VALUES ('project', ?, ?)", [owner, process.pid]);
    });
  }

  public releaseExecutionLock(owner: string): void {
    this.run("DELETE FROM execution_locks WHERE name = 'project' AND owner = ?", [owner]);
  }

  public updateTaskStatus(taskId: string, status: TaskRecord["status"], evidence: string[] = []): void {
    const current = this.getRow("SELECT * FROM tasks WHERE id = ?", [taskId]);
    if (current === undefined) {
      throw new PersistenceError(`Task not found: ${taskId}`);
    }

    const task = mapTask(current);
    const completionEvidence = [...task.completionEvidence, ...evidence];
    this.run(
      "UPDATE tasks SET status = ?, completion_evidence_json = ?, updated_at = ? WHERE id = ?",
      [status, JSON.stringify(completionEvidence), nowIso(), taskId]
    );
  }

  public incrementTaskAttempts(taskId: string): void {
    this.run("UPDATE tasks SET attempts = attempts + 1, updated_at = ? WHERE id = ?", [nowIso(), taskId]);
  }

  public recordEvent(name: string, payload: Record<string, unknown> = {}): EventRecord {
    const event: EventRecord = {
      id: createId("event"),
      name,
      payload,
      createdAt: nowIso()
    };

    this.run("INSERT INTO events (id, name, payload_json, created_at) VALUES (?, ?, ?, ?)", [
      event.id,
      event.name,
      JSON.stringify(event.payload),
      event.createdAt
    ]);

    return event;
  }

  public saveTeamRun(run: TeamRunRecord): void {
    this.setSetting(`teamRun:${run.id}`, run);
    this.setSetting("lastTeamRun", run.id);
  }

  public getTeamRun(id = this.getSetting<string>("lastTeamRun")): TeamRunRecord | undefined {
    return id ? this.getSetting<TeamRunRecord>(`teamRun:${id}`) : undefined;
  }

  public addTeamMessage(input: Omit<TeamMessageRecord, "id">): TeamMessageRecord {
    const message = { ...input, id: createId("message") };
    this.run("INSERT INTO agent_messages (id, from_agent_id, to_agent_id, kind, body, artifact_refs_json, created_at, team_run_id, round) VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?)",
      [message.id, message.fromAgentId, message.toAgentId ?? null, message.kind, message.body, nowIso(), message.runId, message.round]);
    return message;
  }

  public listTeamMessages(runId: string): TeamMessageRecord[] {
    return this.getRows("SELECT * FROM agent_messages WHERE team_run_id = ? ORDER BY rowid ASC", [runId]).map((row) => ({
      id: requiredString(row, "id"), runId, fromAgentId: requiredString(row, "from_agent_id"),
      ...(optionalString(row, "to_agent_id") ? { toAgentId: String(row["to_agent_id"]) } : {}),
      kind: requiredString(row, "kind") as TeamMessageRecord["kind"], body: requiredString(row, "body"), round: Number(row["round"])
    }));
  }

  public setSetting(key: string, value: unknown): void {
    this.run(
      `
      INSERT INTO settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `,
      [key, JSON.stringify(value), nowIso()]
    );
  }

  public getSetting<T>(key: string): T | undefined {
    const row = this.getRow("SELECT value_json FROM settings WHERE key = ?", [key]);
    if (row === undefined) {
      return undefined;
    }

    return JSON.parse(String(row["value_json"])) as T;
  }

  public close(): void {
    this.db.close();
  }

  private run(sql: string, params: SqliteValue[] = []): void {
    withSqliteRetry(() => {
      this.db.prepare(sql).run(...params);
    });
  }

  private getRow(sql: string, params: SqliteValue[] = []): Record<string, unknown> | undefined {
    const row = withSqliteRetry(() => this.db.prepare(sql).get(...params));
    if (row === undefined || row === null || typeof row !== "object" || Array.isArray(row)) {
      return undefined;
    }

    return row as Record<string, unknown>;
  }

  private getRows(sql: string, params: SqliteValue[] = []): Record<string, unknown>[] {
    return withSqliteRetry(() => this.db.prepare(sql).all(...params)).filter((row): row is Record<string, unknown> => {
        return row !== null && typeof row === "object" && !Array.isArray(row);
      });
  }

  private exec(sql: string): void {
    withSqliteRetry(() => {
      this.db.exec(sql);
    });
  }
}

function mapProject(row: Record<string, unknown>): ProjectRecord {
  return {
    id: requiredString(row, "id"),
    rootPath: requiredString(row, "root_path"),
    name: requiredString(row, "name"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at")
  };
}

function mapProvider(row: Record<string, unknown>): ProviderRecord {
  const kind = providerKindSchema.parse(requiredString(row, "kind"));
  const provider: ProviderRecord = {
    id: requiredString(row, "id"),
    kind,
    name: requiredString(row, "name"),
    status: requiredString(row, "status") as ProviderRecord["status"],
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at")
  };

  const baseUrl = optionalString(row, "base_url");
  const apiKeyEnv = optionalString(row, "api_key_env");
  const apiKeySession = optionalString(row, "api_key_session");
  if (baseUrl !== undefined) {
    provider.baseUrl = baseUrl;
  }
  if (apiKeyEnv !== undefined) {
    provider.apiKeyEnv = apiKeyEnv;
  }
  if (apiKeySession !== undefined) {
    provider.apiKeySession = apiKeySession;
  }

  return provider;
}

function mapModel(row: Record<string, unknown>): ModelRecord {
  const metadata = modelMetadataSchema.parse(JSON.parse(requiredString(row, "metadata_json")));
  return {
    id: requiredString(row, "id"),
    providerId: requiredString(row, "provider_id"),
    modelId: requiredString(row, "model_id"),
    displayName: requiredString(row, "display_name"),
    metadata,
    availability: metadata.availability,
    updatedAt: requiredString(row, "updated_at")
  };
}

function mapAgent(row: Record<string, unknown>): AgentRecord {
  const agent: AgentRecord = {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    role: requiredString(row, "role"),
    systemInstructions: requiredString(row, "system_instructions"),
    selectedModel: requiredString(row, "selected_model"),
    allowedTools: parseStringArray(requiredString(row, "allowed_tools_json")),
    allowedFiles: parseStringArray(requiredString(row, "allowed_files_json")),
    memoryScope: requiredString(row, "memory_scope"),
    status: requiredString(row, "status") as AgentStatus,
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at")
  };

  const currentTaskId = optionalString(row, "current_task_id");
  if (currentTaskId !== undefined) {
    agent.currentTaskId = currentTaskId;
  }

  return agent;
}

function mapTask(row: Record<string, unknown>): TaskRecord {
  const status = taskStatusSchema.parse(requiredString(row, "status"));
  const task: TaskRecord = {
    id: requiredString(row, "id"),
    title: requiredString(row, "title"),
    description: requiredString(row, "description"),
    status,
    attempts: Number(row["attempts"] ?? 0),
    generatedFiles: parseStringArray(requiredString(row, "generated_files_json")),
    testRequirements: parseStringArray(requiredString(row, "test_requirements_json")),
    completionEvidence: parseStringArray(requiredString(row, "completion_evidence_json")),
    dependencies: [],
    resultText: requiredString(row, "result_text"),
    modelUsed: requiredString(row, "model_used"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at")
  };

  const ownerAgentId = optionalString(row, "owner_agent_id");
  if (ownerAgentId !== undefined) {
    task.ownerAgentId = ownerAgentId;
  }

  return task;
}

function requiredString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new PersistenceError(`Expected string column: ${key}`);
  }

  return value;
}

function optionalString(row: Record<string, unknown>, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === "string");
}

function withSqliteRetry<T>(operation: () => T): T {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      lastError = error;
      if (!isSqliteLocked(error) || attempt === 7) {
        throw error;
      }

      sleepSync(25 * (attempt + 1));
    }
  }

  throw lastError;
}

function isSqliteLocked(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { code?: unknown; errcode?: unknown; message?: unknown };
  return maybeError.errcode === 5 || String(maybeError.message ?? "").toLowerCase().includes("database is locked");
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}
