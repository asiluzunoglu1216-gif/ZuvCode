# Configuration

Project state is stored under:

```text
.zuvcode/state.db
.zuvcode/memory/
```

The SQLite schema includes projects, sessions, providers, models, agents, agent messages, tasks, task dependencies, tool calls, memories, checkpoints, usage records, settings, and events.

The active configuration schema version is stored in the `settings` table.

Shared user settings use `~/.zuvcode`, or the directory set by `ZUVCODE_HOME`. Existing installations reuse `.orvynx` storage when `.zuvcode` is absent, including saved credentials, history and project skills. `ORVYNX_HOME` remains a fallback for old installations. No live database is moved or reset during the rename. See [upgrade behavior](../README.md#existing-installations).
