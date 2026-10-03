# ZuvCode

ZuvCode is a terminal-first AI orchestration runtime. It is built to coordinate providers, models, agents, tasks, tools, permissions, project memory, and verification evidence from one CLI.

The guiding product idea is:

```text
One terminal. Every model. A complete AI team.
```

The CLI includes model-driven coding tools, live task activity, public web research, SQLite project state, provider/model selection, and permission checks. It is not a full OS sandbox or the entire long-term multi-agent roadmap.

## Install on Windows

Windows 10/11 x64 and ARM64, with Windows PowerShell 5.1 or newer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/asiluzunoglu1216-gif/ZuvCode/releases/latest/download/install.ps1 | iex"
```

Open a new terminal in your project folder and run **`zuv`**. `zuvcode` works too. No administrator access, Git, pnpm or preinstalled Node.js is required. The installer downloads a private Node.js runtime and a tested release to `%LOCALAPPDATA%\ZuvCode`, verifies SHA-256 checksums, and adds its commands to your user PATH. Only run installers from a publisher you trust; you can [inspect this installer](install.ps1) before executing it.

Managed installations check for updates on launch, at most once every 15 minutes. A newer published version is downloaded, checked and activated before the coding session starts. Running sessions are never hot-swapped. If the check or download fails, the current installation remains usable. Force a check with `zuv update`, or disable automatic checks by setting `ZUVCODE_AUTO_UPDATE=0`. Personal keys, models, project state and file history are stored separately and are not replaced by updates.

Every successful push to `main` runs the test/build/release workflow. Local unsaved edits, unpushed commits and failing builds are **not** distributed. See [releases and updates](docs/releases.md).

## Install from Source

```bash
pnpm install
pnpm setup
```

## Start ZuvCode

```bash
cd path/to/your/project
zuvcode
```

`pnpm setup` builds and registers `zuvcode` and `zuv` in the global npm bin directory. It only needs to run once. The launcher uses the current directory as the project; it never switches into the ZuvCode source directory. Keep this source checkout in place. After code updates, `pnpm build` updates the global command too.

For development, `pnpm dev` still works. You can also specify a different project:

```bash
zuvcode --project "C:/Projects/my-app"
zuvcode doctor
```

## First Provider

Run `/connect`, select a provider, and select a model from the returned list. Ollama and LM Studio use their default local addresses with no key prompt. Cloud providers ask only for an API key, unless the standard environment variable or a saved key is already available. Custom providers ask for an endpoint and, for remote endpoints, an optional key.

Google Gemini and NVIDIA Build are ready-made options in `/connect`; no Custom endpoint setup is needed. Select the provider, enter its key once, then choose a model from its live catalog. Gemini uses `https://generativelanguage.googleapis.com/v1beta/openai` and accepts `GEMINI_API_KEY` or `GOOGLE_API_KEY` (Gemini's variable takes priority). NVIDIA Build uses `https://integrate.api.nvidia.com/v1` and `NVIDIA_API_KEY`. Keys can be obtained from [Google AI Studio](https://aistudio.google.com/apikey) or [NVIDIA Build](https://build.nvidia.com/). These use the existing OpenAI-compatible adapter: see [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai) and [NVIDIA hosted API documentation](https://docs.nvidia.com/nemo/microservices/25.8.0/set-up/deploy-as-microservices/data-designer/troubleshooting.html). Model availability, native tool support and API quotas depend on the provider and model; no hardcoded model version or free/unlimited usage is promised.

Connections and model selection are shared across folders in `~/.zuvcode`. Windows encrypts saved keys with DPAPI for the current Windows user. Project files only contain secret references. On macOS/Linux the private credentials file uses mode `0600`. `ZUVCODE_HOME` can override the user settings directory.

### Existing Installations

ZuvCode replaces the former ORVYNX name. Run `pnpm setup` once to register both `zuvcode` and the short command `zuv`. Previously installed launchers continue to open ZuvCode. The source checkout does not need to be renamed or moved.

New installations use `.zuvcode` for project state and `~/.zuvcode` for user settings. When the new directory is absent, an existing `.orvynx` directory is reused in place. This keeps API keys, model selection, tasks, skills, memories, backups and execution locks together without deleting or copying live data. `ZUVCODE_HOME` takes precedence over the legacy `ORVYNX_HOME` override. When both storage directories exist, `.zuvcode` wins; they are not automatically merged. Both directory names remain protected from agent file tools.

Non-interactive setup remains available:

```bash
node apps/cli/dist/index.js provider:add --kind openai-compatible --name "Local AI" --base-url http://localhost:1234/v1 --api-key-env LOCAL_AI_KEY
node apps/cli/dist/index.js provider:add --kind ollama --name Ollama --base-url http://localhost:11434
```

Inside the interactive shell:

```text
/connect
/providers
/model
```

## Add a Model

`/model` opens one searchable menu for selection, Auto, refresh, manual model IDs and provider connections. Type part of a name, use Up/Down, and press Enter. Selection is remembered. Choose Auto in this menu to restore automatic selection from connected providers.

Manual registry add:

```bash
zuvcode model:add --provider Ollama --model llama3.1:8b
```

Inside ZuvCode:

```text
/model
```

Choose Enter a model ID in `/model`. It asks only for the model ID when one provider is connected. With several providers, choose one first. No suitability scores or context-window questions are needed. Registering a model ID does not download the model into a local server.

## Interactive Input

Typing `/` opens the live command menu immediately. `/m` leaves only commands beginning with `m`. Up/Down selects a command, Tab completes it, Enter accepts it, and Escape closes the menu. Commands that need arguments leave the cursor ready for your text. Up/Down outside the menu recalls session input history. `/clear` starts a fresh conversation; `/exit` closes ZuvCode.

Paste a multi-line prompt directly into the composer. It stays as one editable draft, including blank lines and indentation, until you press Enter. Use Ctrl+J to add a line while composing by keyboard.

Plain text starts a single-agent coding task with the selected model and conversation history. Asking for HTML or a feature instructs the model to create/edit real files in the current directory. Asking explicitly for code-only output or an explanation does not require file changes. `zuvcode run <goal>` uses the same coding tools. Only `/team` starts teamwork in the interactive shell.

The live activity view shows short task plans, reads, writes, searches, elapsed time, and actual tool outcomes. It does not expose private reasoning. Escape cancels work; completed file changes are preserved. `/changes` lists this session's changed files.

Responses render Markdown headings, bold text, lists, links, tables and code blocks instead of showing raw formatting markers. Content wraps to the terminal width. Headings use emphasis and color; terminals control the actual font size, so individual headings cannot have a different point size.

## First Coding Task

```text
Create a responsive HTML page in index.html and verify the file.
/changes
```

The model can list/search/read files, create them, make exact edits, and run build/test commands according to your permission mode. Existing files must be read before editing; concurrent user changes cause the write to stop. Approval dialogs start with **Deny** selected. Use arrow keys and Enter to allow an operation once. Non-interactive runs reject operations that need approval.

OpenAI-compatible and Ollama tool calling are supported. Gemini's opaque tool-call metadata is preserved across turns. Providers that explicitly reject native tools are retried in JSON action compatibility mode. Model quality still determines whether the task is implemented correctly; invalid or truncated actions are not executed.

## Specialist Agents

```text
/team Build a calculator page, then test and review it.
/team
/tasks
```

`/team <goal>` creates 2-5 specialists suited to the job, not a fixed default team. Each specialist receives the proposal and shared conversation in its own model session. Real public suggestions, objections and agreement messages appear with speaker labels and a live reveal animation. These are work messages, not private reasoning or scripted dialogue.

Every specialist must approve the same proposal before implementation. Objections go back to the coordinator for revision; after three unsuccessful rounds the team stops without starting implementation. During work, an agent can ask another team member a question; an unresolved objection blocks that worker's edits and commands. Workers run sequentially in the shared project, pass results forward and inherit your permission settings.

`/team` opens one menu for a new goal, saved conversation, resume/retry and individual agent models using your existing connections. Shortcuts: `/team chat`, `/team resume`, `/team retry <id>`. `/tasks` lists assignments; `/tasks <id>` shows results, attempts, changed files and tool evidence. Escape cancels work and preserves completed edits. Completed tasks are skipped on resume. Multiple model calls cost more tokens than ordinary chat; agreement is not proof that the generated code is correct. See [agents](docs/agents.md).

Work budget in `/team` controls model turns per chat request or worker attempt for this project: Standard 120 (default), Extended 300, Economy 40 or Custom 1-1000. Full Access changes permissions, not this budget. Larger budgets can consume more tokens. The agent continues past turn 40 automatically within the chosen budget. Old complete tool-call batches are checkpointed when context grows large; original user requests, recent tool pairs and their provider metadata are preserved. Budget exhaustion pauses a team task as blocked, preserves edits and leaves remaining tasks queued. Restart the CLI after updating and use `/team resume`; no new provider connection is needed.

Peer messages allow up to 8,000 characters. Invalid arguments are returned to the model for correction instead of crashing a worker or spending a successful peer-question slot. Reports explicitly say TEAM INCOMPLETE until every assignment finishes; one completed component is not a completed application.

## Permissions

Open `/permissions` to select a mode. You can also switch directly:

| Command | Mode | Behavior |
| --- | --- | --- |
| `/permissions ask` | Ask Every Time (default) | Ask before each file, web or command operation. |
| `/permissions smart` | Smart | Allow normal project reads/writes, web research and recognized checks; ask for risky or unfamiliar commands. |
| `/permissions full` | Full Access | No application approval prompts; file tools and commands can access outside the project. |

The active mode is always shown beside the model in the input footer. Selection is remembered across launches and projects. Public task-plan updates do not need approval in any mode.

Smart recognizes a small command allowlist, including common status/version checks and project build/test/lint scripts. Those scripts still execute project code: only use automatic execution in projects you trust. Installs, deployments, arbitrary scripts and compound commands require approval.

Full Access runs with your current operating-system account's permissions. It does not grant administrator rights or provide an OS sandbox. It can modify files outside the project. Obvious destructive cleanup and broad process-termination commands are blocked by agent tools in every mode; arbitrary scripts can still bypass this heuristic. `/permissions ask` restores approval prompts. Tool timeouts, bounded text output, read-before-write checks and web URL restrictions remain in place.

### File Recovery

Project file edits and shell commands now create durable file checkpoints. Missing covered files are restored after commands, including failure/timeout/cancellation; existing edits and new work are not rolled back. In the CLI, backups are stored in the user settings directory, separate from the working project, and work without Git.

- `/changes history`: show checkpoint IDs and times across restarts.
- `/changes recover <id>`: export the selected checkpoint to `.zuvcode/recovered/<unique-id>` without overwriting working files.
- `/team resume`: retry unfinished team tasks after restarting the updated CLI. Completed tasks are not repeated.

History starts with this version; it cannot restore older deleted files without an existing backup. Coverage excludes secrets, links, generated/internal folders, external files and remote actions. Limits are 8 MiB/file, 128 MiB and 10,000 files/checkpoint; backup failures stop the pending operation. See [file safety and limitations](docs/security.md#file-history-and-cleanup-guard). No runtime can guarantee the correctness of arbitrary model-generated code.

## Web Research

Web search is enabled by default using keyless DuckDuckGo, followed by public page reading. Ask naturally, for example: `Research the HTML dialog element and use the official documentation to implement it.` The model receives real result URLs for citations.

```text
/web
/web google
/web off
/web on
/web default
```

`/web google` asks for a [Serper](https://serper.dev/) API key to use Google search results. The key is masked and stored like model credentials, shared across folders. Alternatively set `SERPER_API_KEY` before launch. `/web default` selects keyless search again. `/web` opens settings and shows the selected backend, not a guarantee of connectivity. Search services can rate-limit or challenge requests; these failures are reported, not replaced with invented results. Web reading is text-only, not a browser that runs JavaScript or signs into websites.

## Commands

Top-level commands:

```bash
zuvcode doctor
zuvcode providers
zuvcode provider:add
zuvcode models
zuvcode team
zuvcode tasks
zuvcode run
zuvcode update
```

The interactive palette has 13 commands. Options live in menus instead of duplicate aliases:

| Command | Purpose |
| --- | --- |
| `/connect` | Connect a model provider. |
| `/model` | Select, add or refresh models; choose Auto. |
| `/providers` | Inspect saved connections. |
| `/team` | Start teamwork, read its conversation, resume/retry or set agent models. |
| `/tasks` | List tasks; append an ID for evidence and results. |
| `/changes` | List this session's changed files. |
| `/skills` | List project skill files; these are not automatically executed. |
| `/web` | Choose or disable web search. |
| `/permissions` | Choose Ask, Smart or Full Access. |
| `/doctor` | Inspect project/runtime health and tool access. |
| `/clear` | Clear the ordinary conversation. |
| `/help` | Show commands; append a command name for details. |
| `/exit` | Close the CLI. |

## Security Notes

- Project secrets are represented by references; saved user keys are encrypted on Windows.
- Logs and UI avoid exposing secret values.
- Ask Every Time (`SAFE`) is the default and asks before file reads, writes, web calls and commands. Smart (`BALANCED`) allows normal project work and recognized checks automatically.
- In Ask and Smart modes, agent file tools reject paths outside the project, junctions/symlinks, hard-linked files, secrets such as `.env`, and internal/generated folders. Full Access explicitly removes these file-access restrictions.
- Full Access (`FULL_ACCESS`) bypasses application approval checks; agent-tool cleanup guards and protected runtime/history paths remain enforced. It is an opt-in mode, not a sandbox.
- Commands run with a minimal environment, bounded output, and a timeout; cancellation kills the command process tree. A working directory is **not** an OS sandbox: any executed command can access files and network outside the project.
- Web reads reject private/reserved IPs, credential-bearing URLs, nonstandard ports, and redirects into private networks. DNS addresses are checked on the actual connection. Pages are size/time limited and treated as untrusted data.
- The legacy `AUTONOMOUS` policy remains supported for existing configurations but is not a fourth permission-menu choice; unlike Full Access, it retains high-risk safeguards.

## Development

See [development checks](docs/development.md) and [publishing releases](docs/releases.md). Local development notes, credentials, project databases, caches and generated test files are excluded from the repository and release archives.
