# Agents

## Start a Team

```text
/team Build a product dashboard with an API, responsive UI and tests.
```

Only `/team` activates teamwork in the interactive CLI. Ordinary chat uses the selected model directly, creates no agents and has no delegation tools. There are no separate slash commands for creating agents or running plans.

The coordinator proposes 2-5 job-specific specialists and 1-8 assignments. A web application might need frontend, backend, UI/UX and testing; a different job gets different roles. Every specialist must own a task. Dependencies reference earlier tasks only, so unknown owners, forward dependencies and cycles are rejected before work starts. Existing agent names reuse their saved model and tool settings.

## Discussion and Agreement

Each specialist receives the exact proposal and previous public messages in a separate model session. They make real suggestions, approve or request changes. The terminal shows speaker names, recipients, message type and a reveal animation. Displayed messages are public work communication, not hidden reasoning or prewritten dialogue.

Every specialist must approve the same proposal before task assignments are saved and implementation starts. On objection, the coordinator revises the proposal and all specialists review again. A revision cannot remove or rename dissenting reviewers. After three unsuccessful rounds the run stops as blocked, with no implementation started. Planning and review tools are read-only and never run shell commands.

During implementation, workers can use `ask_agent` to consult another member, for example about an API contract or animation choice. The recipient sees the shared conversation and responds in its own read-only session. A negative reply blocks the sender's file edits and shell commands until that recipient resolves the objection. Outstanding objections persist across restart and retry. This pauses future mutations; it does not undo files already changed before the question.

Workers share bounded public discussion and prerequisite reports, not unrestricted private histories. They execute sequentially because the project files are shared. Each worker has independent read-before-write state. A project execution lock prevents two ZuvCode instances from overlapping model work on the same project, but does not lock external editors.

## Team Menu

```text
/team
```

The menu provides a new goal, saved conversation, resume unfinished work, retry one task, individual agent models and Work budget. Model selection uses saved provider connections without another API key. Use current model inherits the main `/model` choice. Explicit agent models are persisted per project and do not change the main selection.

Shortcuts:

```text
/team chat
/team resume
/team retry <task-id>
/tasks
/tasks <task-id>
```

Task IDs may be full IDs or the eight-character suffix from `/tasks`; ambiguous IDs are rejected. Details include owners, dependencies, selected model, attempts, changed files, tool evidence and results. Resume skips complete tasks, retries unfinished work and stops on failure. A focused retry requires completed prerequisites. Task assignment edits made after agreement invalidate that approval and require a new team goal.

The menu currently manages the latest team run. Older task records remain visible through `/tasks`. A new goal does not resume an older run automatically.

## Outcomes and Cancellation

Workers submit structured complete, blocked or failed outcomes using `finish_task`. Completion requires actual successful tool work and is refused after a permission denial or while an operation remains failed. Correcting a path changes the operation key and can require a fresh attempt. Successful tools and unanimous plan agreement do not prove that generated code is correct; review the results and recorded checks.

The final report distinguishes component completion from the whole job. If any task is unfinished, it ends with TEAM INCOMPLETE, the completed/total count and resume instructions. Detailed component reports remain in `/tasks <id>`; a successful overall run shows the final assignment's result. A mocked Web Audio API or a source-text assertion is not evidence of real browser/audio behavior. Planning instructions require preserving output constraints and a final integration/checking assignment, but this is model guidance, not an automatic browser quality gate.

Work budget is independent of permissions. The default is 120 model turns per chat request or worker attempt. `/team` offers Standard 120, Extended 300, Economy 40 and Custom 1-1000; the setting persists per project. At turn 40 the default worker continues automatically, without a fresh attempt. At the selected ceiling a team task becomes blocked, not failed, and can be resumed explicitly with preserved files. A higher ceiling can cost more tokens and does not guarantee completion.

Above 300,000 context characters, old complete tool-call/result batches are replaced with a bounded activity checkpoint, aiming below 180,000 characters. All user messages remain, and retained tool calls and opaque provider metadata are unchanged. Workers are told to reread omitted file contents. Required permission refusals, failed operations and peer objections remain in runtime state. If mandatory retained context still exceeds 400,000 characters, work pauses with a continuation hint rather than sending an oversized request.

Escape cancels the active operation, stops its tools and preserves completed edits and messages. On the next execution, dead-process locks are recovered and interrupted tasks/discussions are marked cancelled. Nothing resumes automatically after a crash. An approved run can resume explicitly; a cancelled, unapproved discussion needs a new goal.

## Limits and Permissions

- Up to three proposal/review rounds, five specialists and eight tasks per run.
- Up to ten model steps per proposal and eight per review/reply. Worker/chat steps use the project Work budget, default 120; tool calls are bounded to five times the turn budget.
- Up to four peer questions per worker attempt; replies cannot recursively delegate.
- The last 24 public messages are shared as context, with each stored message bounded to 8,000 characters. Longer completion previews are visibly marked as truncated; full results remain on the task record.
- Invalid `ask_agent` arguments return a corrective tool result instead of throwing a task failure. They do not contact a peer or consume a valid peer-question slot. Over-limit messages must be shortened, not silently approved.
- More model sessions mean more tokens than ordinary chat. All calls use existing connections; separate providers are optional.
- Agents inherit `/permissions` and their stored tool allowlists. Full Access does not bypass agreement, task completion or sequential execution rules.
- Custom file scopes other than the default `**/*` are rejected, not silently ignored. Skills are listed but not automatically injected or executed.
