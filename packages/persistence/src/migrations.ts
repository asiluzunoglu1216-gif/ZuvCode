export const migrations: string[] = [
  `
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    root_path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    status TEXT NOT NULL,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    base_url TEXT,
    api_key_env TEXT,
    api_key_session TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    availability TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider_id, model_id),
    FOREIGN KEY(provider_id) REFERENCES providers(id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    system_instructions TEXT NOT NULL,
    selected_model TEXT NOT NULL,
    allowed_tools_json TEXT NOT NULL,
    allowed_files_json TEXT NOT NULL,
    memory_scope TEXT NOT NULL,
    current_task_id TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    from_agent_id TEXT NOT NULL,
    to_agent_id TEXT,
    kind TEXT NOT NULL,
    body TEXT NOT NULL,
    artifact_refs_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    owner_agent_id TEXT,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    generated_files_json TEXT NOT NULL,
    test_requirements_json TEXT NOT NULL,
    completion_evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    PRIMARY KEY(task_id, depends_on_task_id),
    FOREIGN KEY(task_id) REFERENCES tasks(id),
    FOREIGN KEY(depends_on_task_id) REFERENCES tasks(id)
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS tool_calls (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    agent_id TEXT,
    tool_name TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT,
    status TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    git_ref TEXT,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE IF NOT EXISTS usage_records (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_usd REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  `
  ALTER TABLE tasks ADD COLUMN result_text TEXT NOT NULL DEFAULT '';
  ALTER TABLE tasks ADD COLUMN model_used TEXT NOT NULL DEFAULT '';
  CREATE TABLE execution_locks (
    name TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    pid INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE agent_messages ADD COLUMN team_run_id TEXT;
  ALTER TABLE agent_messages ADD COLUMN round INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX agent_messages_team_run ON agent_messages(team_run_id);
  `
];
