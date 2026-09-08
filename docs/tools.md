# Tools

The model-driven coding loop exposes:

- `update_plan`: a short public checklist, not private reasoning.
- `list_files`, `search_files`, `read_file`: project inspection with bounded results; Full Access also permits explicit paths outside the project.
- `write_file`, `edit_file`: real writes and unique exact-text edits, with read-before-write and concurrent-change checks.
- `run_command`: approval according to the selected permission mode, minimal environment, output limits, maximum 120 seconds and process-tree cancellation.
- `web_search`, `read_url`: public web research, keyless DuckDuckGo or Google through Serper.

Tools use validated JSON schemas. Calls execute sequentially and each result goes back to the model. Chat and worker attempts default to 120 model turns, configurable through Work budget in `/team`; tool calls are bounded to five times the turn budget. Planning and discussion sessions keep smaller explicit limits. Work budget is independent of Full Access. Complete old tool-call batches are checkpointed when context grows large, without modifying retained provider metadata or dropping user requirements. Budget exhaustion preserves files and blocks unfinished team work for explicit resume. Truncated provider responses are still rejected before execution. `/doctor` reports actual access and `/changes` lists writes in the current session.

File history is separate from context compression. File tools save before/after content; commands save covered project files before execution and after settlement. Obvious deletion and broad process-kill commands are rejected in every mode. If an indirect script removes covered files, they are restored without overwriting existing/new work, including on cancellation. `/changes history` and `/changes recover <id>` expose persistent, non-overwriting recovery without involving a model. See [security](security.md#file-history-and-cleanup-guard) for scope, exclusions and limits. Invalid arguments and rejected edit conflicts are returned for correction, not treated as permanently failing executed operations.

Team planning adds `submit_plan` to read-only inspection tools. Specialists vote through `review_plan`; all must agree before implementation. Workers use `finish_task` for a structured complete/blocked/failed result. Team workers also have `ask_agent`; a recipient answers through `reply_message` in a read-only session, with negative replies blocking the sender's edits and commands until resolved. These tools are session-scoped and absent from ordinary chat. Unknown/unavailable tools cannot run even if the provider emits them. Each worker has its own read-before-write state; bounded public discussion and prerequisite reports are shared. See [agents](agents.md).

`/permissions` selects Ask Every Time (the default), Smart or Full Access. Ask requires approval for each file/web/command operation; Smart automatically allows routine project work and recognized commands; Full Access removes approval prompts. Smart scripts and Full Access commands are not OS-sandboxed. See [security](security.md) for the exact boundaries.

Native OpenAI-compatible and Ollama tool calls are supported. Gemini signatures are passed back unchanged and never displayed. A provider that explicitly rejects native tools switches to JSON action mode; models that cannot produce valid actions require selecting a more capable model. Ordinary JSON examples are never executed in native mode.

Protocol references: [Gemini signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures), [Ollama tools](https://docs.ollama.com/capabilities/tool-calling), [DuckDuckGo HTML search](https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript), [Serper Google search](https://serper.dev/).
