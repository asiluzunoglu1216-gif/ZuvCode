# Security

ZuvCode security principles in this milestone:

- Do not store plaintext API keys in project files.
- Keys entered in `/connect` use Windows DPAPI user encryption in the user settings directory. On other operating systems the credentials file has mode `0600`.
- API key input is masked, cleared after submission, and never added to command history or process arguments.
- Detect provider credential environment variables without silently importing or exposing them.
- Mask common secret patterns in logs.
- Default to Ask Every Time; changing to Smart or Full Access is an explicit user choice.
- Show the active permission mode in the input footer and persist the selection across projects.
- Use explicit risk classes: LOW, MEDIUM, HIGH, CRITICAL.

## Permission Modes

`/permissions` opens the mode selector:

- **Ask Every Time** (`SAFE`, `/permissions ask`): approval before every file read, listing, search, write, web request or command. Task-plan updates do not access external state and do not ask.
- **Smart** (`BALANCED`, `/permissions smart`): normal project reads/writes and public web access are automatic. A small allowlist covers routine shell checks and project build/test/lint scripts; unknown, compound, installation and deployment commands ask. Project scripts can execute arbitrary code, so this mode requires trust in the project and installed tools.
- **Full Access** (`FULL_ACCESS`, `/permissions full`): no application approval prompts. Explicit file paths can be outside the project, point through links, or reference normally protected files. The agent-tool destructive cleanup/process-termination guard remains enabled. This mode has the current OS user's access, not automatic administrator privileges.

Ask and Smart file tools block secret/internal folders and linked paths outright, including nested and differently cased `.env` files. Full Access removes those access restrictions except ZuvCode state, credential-store and recovery paths, which agents cannot read/write through file tools. Directory listings still omit generated and sensitive entries. Existing files must be read before modification in every mode; edits require one exact unique match. These checks are application-level safeguards, not an OS sandbox against another process concurrently mutating the filesystem.

When approval is required, the full command and working directory are shown with Deny initially selected. Non-interactive requests cannot approve operations. Any executed command can access files and network outside the project, including commands automatically allowed by Smart. Commands receive a minimal environment rather than provider API key variables, bounded captured output, and at most 120 seconds. Escape terminates the process tree. Full Access does not remove these execution bounds.

The legacy `AUTONOMOUS` policy remains readable from existing configurations, retains protected/high-risk checks, and is not exposed as another menu choice.

## File History and Cleanup Guard

Agent file tools save durable before/after versions; shell execution saves a checkpoint of covered project files before starting and again after the process settles. The CLI stores content-addressed blobs and manifests under `ZUVCODE_HOME/file-history/<project-hash>` (normally `~/.zuvcode/file-history`), outside the working project. Programmatic runtimes without a user config directory use `.zuvcode/file-history` inside the project instead. A backup failure stops the pending edit/command rather than silently proceeding without protection. This is file history, separate from conversation-context compression.

After a shell command, missing covered files are recreated from its checkpoint using exclusive creation. Existing modified files and new work are left intact. Recovery also runs after nonzero exit, timeout and cooperative cancellation. No task failure triggers a whole-project rollback or deletion of newly generated files. Path conflicts or recovery errors stop the operation and leave the checkpoint available for inspection/export. A hard application/OS crash cannot execute this finalizer; use the saved checkpoint manually.

`/changes history [page]` lists persistent checkpoints, six nonempty records per page. `/changes recover <id>` exports a copy under `.zuvcode/recovered/<unique-id>`, never overwriting the current working files or deleting anything. Recovery verifies hashes and rejects traversal, symlinks, junctions and hard links. Checkpoint blobs/manifests are flushed and published by atomic rename so interrupted temporary writes do not appear as valid history. It requires no provider/API call. Old deleted files from versions without file history cannot be reconstructed from task summaries.

Coverage is regular files within the project, including untracked source files and tests. Secret filenames, generated folders (`node_modules`, `dist`, `build`, `coverage`, `.next`, virtual environments), linked paths, internal state and user credential directories are excluded. External paths and remote side effects are not covered. Shell-created files deleted again within the same command cannot be captured. Checkpoints are limited to 8 MiB per file, 128 MiB total and 10,000 files; exceeding the limit blocks execution with an explanation. History has no automatic pruning; identical blobs are deduplicated, but history uses local disk and should be managed by the user. Stored source content is local, not encrypted; protect the user settings directory appropriately.

The command guard rejects obvious deletion/reset/cleanup patterns and broad process-termination commands before spawning, including the reported Node `fs.unlinkSync` cleanup and `Stop-Process`/`taskkill` cases. It is intentionally a heuristic, not a comprehensive shell parser or security boundary: indirect scripts and encoded commands can bypass detection. Checkpoints provide additional recovery for covered project files, not protection for the entire computer. Full Access still lets arbitrary scripts affect external files, processes and networks. Prefer Ask/Smart for untrusted tasks. Do not edit/delete project files concurrently with a running command: the missing-file recovery cannot distinguish a user's simultaneous deletion from the command's deletion.

## Agent Execution

Work budget and permissions are separate. Full Access does not disable the configurable model-turn/tool-call budgets. Context checkpoints omit only complete tool batches and never modify retained provider signatures, discard user messages, reset permission denials, clear peer objections or bypass read-before-write checks. Invalid peer-message arguments return a corrective tool result before any peer request or objection state change.

Malformed tool arguments and rejected stale/non-unique edits produce corrective results without adding an operation that can never be cleared. Their error evidence remains visible. A simple `git status` returning `not a git repository` is a diagnostic, not a failed build/test. Real executed command failures, permission denials and peer objections still block successful completion. Completion errors list unresolved operation keys instead of a generic warning.

Named agents inherit the current permission engine and stored tool allowlist. Planning and discussion sessions expose read-only inspection plus their structured proposal, vote or reply tool. Workers expose permitted tools, `finish_task` and (only in a team) `ask_agent`. A provider-emitted tool outside the session's list is rejected before execution. The model cannot change permission mode or create recursive agents through these tools. Ordinary chat has no delegation tools.

All specialists must approve the same proposal before implementation. Reviewers cannot be removed in a revision to bypass their objection. Agreement is bound to the task assignments; changed assignments require a new discussion. Worker questions persist a pending objection before the peer request, so cancellation or provider failure cannot silently discard it. Unresolved objections block that worker's future file edits, commands and successful completion, including after restart. These are coordination checks, not proof of correctness or a rollback mechanism.

Team tasks run sequentially. A SQLite project execution lock records the owning process and prevents another CLI from overlapping model work on that project. Dead-process locks can be recovered on a later explicit execution; interrupted tasks are marked cancelled, not complete. The lock does not protect against other applications, external editors or commands modifying files outside the project. Prerequisite reports are treated as untrusted data and workers read files themselves before editing.

## Web Access

Web tools allow only public HTTP(S) text pages on normal web ports. They check DNS at connection time and validate every redirect, preventing private-network fetches. They do not run page scripts, send browser cookies or forward search credentials across redirects. Search queries and URLs still go to external services, so the model is instructed not to include private project content. `/web off` disables these tools. Retrieved content is untrusted data, never authority for new instructions.

## Protected Paths

Default protected paths outside Full Access include:

```text
.env
.env.*
production/**
```
