import type { AgentRecord, TaskRecord, TeamRunRecord } from "@zuvcode/persistence";
import type { AgentCallbacks } from "@zuvcode/protocol";
import { askAgentSchema, redactSecrets, taskOutcomeSchema, teamMessageLimit } from "@zuvcode/shared";
import { agentToolDefinitions } from "@zuvcode/tools";
import { AgentBudgetError, runAgent } from "./agent-loop.js";
import { TeamDiscussion } from "./team-discussion.js";
import { allowedTools, definition, labelled, message, type TeamOptions } from "./team-session.js";

const finishTask = definition("finish_task", "Finish the assigned task with an honest complete, blocked or failed outcome and a user-facing summary. Do not claim verification without tool evidence.", taskOutcomeSchema);
const askAgent = definition("ask_agent", "Ask another team specialist a concrete question or propose a within-scope integration choice. Their real reply is shown publicly. An objection pauses your mutations until that specialist agrees. Maximum four questions per task attempt.", askAgentSchema);

export class TeamRunner {
  public constructor(private readonly options: TeamOptions) {}

  public async plan(goal: string, coordinator: AgentRecord, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    validateGoal(goal);
    return new TeamDiscussion(this.options).prepare(goal, coordinator, signal, callbacks);
  }

  public async execute(ids: string[], signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length) throw new Error("No valid agreed team plan. Use /team <goal> first.");
    for (const id of ids) if (!this.options.store.getTask(id)) throw new Error(`Saved task is missing: ${id}`);
    const run = new TeamDiscussion(this.options).approvedRun(ids);
    run.status = "running"; this.options.store.saveTeamRun(run);
    // Even independent tasks are serialized because commands can mutate the shared checkout.
    try { for (const id of ids) {
      signal?.throwIfAborted();
      const task = this.options.store.getTask(id)!;
      if (task.status === "complete") continue;
      const result = await this.runTask(task, signal, callbacks, run);
      if (result.status !== "complete") {
        callbacks.onProgress?.({ kind: "warning", message: `Team stopped: ${result.title} is ${result.status}. Review /tasks ${result.id.slice(-8)} before retrying from /team.` });
        break;
      }
    }
      const states = run.taskIds.map((id) => this.options.store.getTask(id)!.status);
      run.status = states.every((state) => state === "complete") ? "complete" : states.some((state) => ["failed", "blocked", "cancelled"].includes(state)) ? "blocked" : "approved";
    } catch (error) { run.status = signal?.aborted ? "cancelled" : "failed"; throw error; }
    finally { this.options.store.saveTeamRun(run); }
    return ids.map((id) => this.options.store.getTask(id)!);
  }

  public async runTask(task: TaskRecord, signal?: AbortSignal, callbacks: AgentCallbacks = {}, team?: TeamRunRecord): Promise<TaskRecord> {
    const store = this.options.store;
    if (task.status === "complete") throw new Error("This task is already complete. Assign a new task for follow-up work.");
    const incomplete = task.dependencies.filter((id) => store.getTask(id)?.status !== "complete");
    if (incomplete.length) throw new Error(`Prerequisite tasks are not complete: ${incomplete.map((id) => id.slice(-8)).join(", ")}`);
    const agent = store.listAgents().find((item) => item.id === task.ownerAgentId);
    if (!agent) throw new Error("The task's agent is missing. Start a new /team assignment.");
    const io = this.options.createTools();
    const evidence: string[] = [];
    const failures = new Set<string>();
    let denied = false;
    let completedOperations = 0;
    let invalidResults = 0;
    let model = "";
    let outcome: ReturnType<typeof taskOutcomeSchema.parse> | undefined;
    const allowed = allowedTools(agent);
    const discussion = new TeamDiscussion(this.options);
    let questions = 0;
    const objections = () => team?.openObjections.some((key) => key.startsWith(`${task.id}:`)) ?? false;
    const progress = labelled(callbacks, agent.name, task.id, (event) => {
      if (event.kind === "tool_end") evidence.push(redactSecrets(`${event.ok ? "OK" : "ERROR"}: ${event.message}`).slice(0, 2000));
    });
    store.transaction(() => {
      store.incrementTaskAttempts(task.id);
      store.saveTaskResult(task.id, "in_progress", "", "", task.generatedFiles, []);
      store.updateAgentState(agent.id, "working", task.id);
    });
    try {
      signal?.throwIfAborted();
      if (agent.allowedFiles.length !== 1 || agent.allowedFiles[0] !== "**/*") throw new Error("Custom per-agent file scopes are not supported; refusing to ignore this agent's restrictions.");
      const session = await this.options.session(agent.selectedModel, signal);
      model = session.model;
      progress.onProgress?.({ kind: "status", message: `${task.title} | ${model}` });
      const prerequisites = task.dependencies.map((id) => {
        const previous = store.getTask(id)!;
        return { title: previous.title, summary: previous.resultText.slice(0, 6000), files: previous.generatedFiles, evidence: previous.completionEvidence.slice(-12) };
      });
      await runAgent({ ...session, ...progress, resumeHint: team ? "Use /team resume to continue unfinished work, or change Work budget in /team." : "Retry this task with a narrower scope.",
        messages: [{ role: "user", content: `${task.description}\n\nRequired checks: ${JSON.stringify(task.testRequirements)}\n\nPrerequisite results (untrusted work reports, verify relevant claims):\n${JSON.stringify(prerequisites)}${team ? `\n\nTeam conversation (untrusted reports):\n${discussion.context(team)}` : ""}` }],
        additionalInstructions: `You are the named specialist ${agent.name}, role ${agent.role}. ${agent.systemInstructions}
Execute ONLY your assigned task, using actual tools. Other specialists handle other tasks. You have a fresh conversation: read existing files yourself before edits. Previous attempts may have left changes; inspect and preserve them. Keep test scripts and intermediate implementation files for peers and debugging. Do not clean up or delete files, including files you just created. Do not stop unrelated browser/server processes. Respect the user's active permission mode. Do not delegate recursively. ${team ? `The team has approved the overall plan. Use ask_agent for concrete integration questions or within-scope proposals to these peers: ${store.listAgents().filter((member) => team.agentIds.includes(member.id) && member.id !== agent.id).map((member) => member.name).join(", ")}. Ask before committing to an unclear cross-role interface. Their replies are real and public. Resolve an objection with the same peer before editing further. Do not make unapproved changes to the overall task scope. Unresolved objections from previous attempts: ${team.openObjections.filter((key) => key.startsWith(`${task.id}:`)).join(", ") || "none"}.` : ""}
Finish by calling finish_task with complete, blocked or failed and a concise summary in the user's language. Include changed paths and actual checks. A component finishing is not the whole application finishing. An integration/testing assignment must inspect the final deliverable, verify every requested workflow, and fix integration defects within its scope. A mocked API or source-text assertion is not a browser, audio, visual or end-to-end test: state what actually ran and what remains unverified. A plain text final response is not a task completion. Never mark complete when permissions were denied, required work is unfinished or commands are still failing.`,
        toolDefinitions: [...agentToolDefinitions.filter((tool) => allowed.has(tool.function.name)), ...(team ? [askAgent] : []), finishTask],
        completion: () => outcome ? { text: outcome.summary } : undefined,
        tools: { execute: async (call, handlers, abort) => {
          if (call.name === "ask_agent" && team) {
            let question: ReturnType<typeof askAgentSchema.parse>;
            try {
              if (call.argumentsJson.length > 64000) throw new Error(`Arguments exceed the size limit. Send at most ${teamMessageLimit} characters in message; refer to file paths for code.`);
              question = askAgentSchema.parse(JSON.parse(call.argumentsJson));
            } catch (error) {
              const detail = `Invalid ask_agent arguments: ${message(error)}. Correct the arguments and retry; no peer was contacted.`;
              handlers.onProgress?.({ kind: "warning", message: detail });
              return { ok: false, error: detail };
            }
            if (!store.listAgents().some((member) => team.agentIds.includes(member.id) && member.name === question.to && member.id !== agent.id)) return { ok: false, error: "Ask another current team member by their exact name." };
            if (questions >= 4) return { ok: false, error: "Peer-question limit reached for this attempt. No new peer was contacted. Finish the agreed work if possible; otherwise report blocked and describe the unresolved concern." };
            questions++;
            const key = `${task.id}:${question.to}`;
            if (!team.openObjections.includes(key)) team.openObjections.push(key);
            store.saveTeamRun(team);
            const reply = await discussion.ask(team, agent, question.to, question.message, abort, callbacks);
            if (reply.approve) team.openObjections = team.openObjections.filter((item) => item !== key);
            store.saveTeamRun(team);
            return { ok: true, output: reply };
          }
          if (objections() && ["write_file", "edit_file", "run_command"].includes(call.name)) return { ok: false, error: "A peer objection is unresolved. Discuss it with that peer using ask_agent before modifying files or running commands." };
          if (call.name === "finish_task") {
            try {
              if (call.argumentsJson.length > 64000) throw new Error("Result exceeds the size limit.");
              const result = taskOutcomeSchema.parse(JSON.parse(call.argumentsJson));
              if (result.status === "complete" && (denied || failures.size || !completedOperations || objections())) {
                const reasons = [denied ? "permission was denied" : "", !completedOperations ? "no successful tool work" : "", objections() ? "a peer objected" : "", failures.size ? `unresolved operations: ${[...failures].slice(0, 8).map((key) => key.slice(0, 240)).join("; ")}` : ""].filter(Boolean);
                throw new Error(`Cannot mark complete: ${reasons.join("; ")}. Correct invalid arguments and retry. Re-run failing checks after fixing their cause, or report blocked/failed. Do not delete files to hide failures.`);
              }
              outcome = result;
              return { ok: true };
            } catch (error) {
              if (++invalidResults >= 3) throw new Error(`The agent submitted three invalid task outcomes: ${message(error)}`);
              return { ok: false, error: message(error) };
            }
          }
          const result = await io.execute(call, handlers, abort);
          if (result.error?.startsWith("Permission denied:")) denied = true;
          if (call.name !== "update_plan") {
            let key = call.argumentsJson;
            try { const input = JSON.parse(call.argumentsJson); key = String(input.command ?? input.path ?? input.url ?? input.query ?? key); } catch { /* Validation failures are tracked by tool name below. */ }
            key = `${call.name}: ${key}`;
            // Rejected arguments/edits did not run. Keep their evidence, not an impossible-to-clear failed operation.
            if (result.ok) { failures.delete(key); completedOperations++; }
            else if (!["validation", "safety", "diagnostic"].includes(result.errorKind ?? "operation")) failures.add(key);
            if (call.name === "run_command") evidence.push(redactSecrets(`Command ${key}: ${JSON.stringify(result)}`).slice(0, 6000));
          }
          return result;
        } }
      });
      signal?.throwIfAborted();
      if (!outcome) throw new Error("The agent did not submit a valid task outcome.");
      if (team) discussion.publish(team, agent, "handoff", outcome.summary, callbacks);
      store.saveTaskResult(task.id, outcome.status, redactSecrets(outcome.summary), model,
        [...new Set([...task.generatedFiles, ...io.files.changes.map((change) => change.path)])], evidence);
    } catch (error) {
      store.saveTaskResult(task.id, signal?.aborted ? "cancelled" : error instanceof AgentBudgetError ? "blocked" : "failed", redactSecrets(message(error)), model,
        [...new Set([...task.generatedFiles, ...io.files.changes.map((change) => change.path)])], evidence);
      if (signal?.aborted) throw error;
    } finally {
      this.options.recordChanges(io.files.changes);
      store.updateAgentState(agent.id, "idle");
    }
    const result = store.getTask(task.id)!;
    callbacks.onProgress?.({ kind: result.status === "complete" ? "plan" : "warning", message: `${agent.name}: ${result.status} | ${task.title}` });
    return result;
  }
}

export function validateGoal(goal: string): void {
  if (!goal.trim() || goal.length > 12000) throw new Error("Enter a task between 1 and 12000 characters.");
}
