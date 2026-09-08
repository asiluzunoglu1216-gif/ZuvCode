# Getting Started

Run the local development workflow:

```bash
pnpm install
pnpm setup
```

Then open a terminal in any project folder and run `zuv` or `zuvcode`. Its working directory is the folder you launched it from. You do not need to return to the source checkout. Keep the source checkout in place because the installed command links to it. Existing connections and project history are retained; see [existing installations](../README.md#existing-installations).

Use `/connect` to select a provider, then select a discovered model. Local providers use default addresses; cloud providers request a key once. Settings carry across projects. Use `/model` to search, switch, add or refresh models.

For Gemini, choose **Google Gemini** and enter a Google AI Studio API key. For NVIDIA, choose **NVIDIA Build** and enter its API key. Both have official endpoint defaults and live model discovery; you do not need Custom endpoint. Existing `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) and `NVIDIA_API_KEY` environment variables can supply the key instead. Restart ZuvCode after an update to see the new menu entries. Connecting does not purchase API credits or guarantee access to every listed model.

Type `/` for commands, or `/m` to filter them. Use Up/Down to select, Tab to complete, Enter to accept, and Esc to dismiss. The menu updates in place.

Useful first commands:

```text
/doctor
/connect
/model
/permissions
Create an HTML page in index.html and verify it.
/changes
/web
```

The selected model can inspect, create and edit files, research public web pages, and run build/test commands. The activity view shows short plans and actual tool results, not private reasoning. Responses format Markdown headings, bold text, lists and code blocks and wrap to your terminal width.

`/permissions` selects the permission mode. Ask Every Time is the default and asks before every file/web/command operation, with Deny initially selected. `/permissions smart` allows normal project work and recognized checks automatically. `/permissions full` removes approval prompts and permits access outside the project using your OS account's rights. Full Access can execute destructive commands without another confirmation; it does not grant administrator rights. Smart also executes project scripts without an OS sandbox, so use automatic modes only with trusted projects. The selected mode is remembered across launches and shown in the input footer. `/permissions ask` restores the default.

Web search works without a key using DuckDuckGo. For Google results, enter `/web google` and supply a Serper API key once. `/web off` disables web tools and `/web default` returns to keyless search.

To split a larger task, use `/team <goal>`. It creates specialists suited to the job, lets them discuss and revise a proposal, and starts implementation only after all agree. Live messages identify who is speaking and whether they agree or object. Workers execute sequentially and can consult teammates during work. Ordinary chat never starts a team. `/team` opens conversation history, resume/retry and individual agent models without new credentials. `/tasks` lists assignments; `/tasks <id>` shows evidence and results. See [agents](agents.md) for limits and cancellation behavior.

Escape stops the current operation without undoing completed file changes. `/clear` clears conversation history and `/exit` exits. For development, `pnpm dev` remains available. After editing source code, run `pnpm build` and restart ZuvCode; the global launcher uses the new build.
