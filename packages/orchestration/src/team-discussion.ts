import { createHash } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type { AgentRecord, TaskRecord, TeamMessageRecord, TeamRunRecord } from "@zuvcode/persistence";
import type { AgentCallbacks } from "@zuvcode/protocol";
import { createId, redactSecrets, teamMessageLimit, teamProposalSchema, teamReviewSchema, type TeamProposal } from "@zuvcode/shared";
import { agentToolDefinitions } from "@zuvcode/tools";
import { runAgent } from "./agent-loop.js";
import { allowedTools, definition, inspection, labelled, message, type TeamOptions } from "./team-session.js";

const submitPlan = definition("submit_plan", "Propose only the specialists this job needs, their assignments, dependencies and a short public proposal for discussion.", teamProposalSchema);
const reviewPlan = definition("review_plan", "Cast your own vote on the current plan and send a short public message to the team. Request revision when concerns remain.", teamReviewSchema);
const replyMessage = definition("reply_message", "Reply publicly to the asking agent. approve=false raises an objection and pauses that agent's mutations until resolved.", teamReviewSchema);

export class TeamDiscussion {
  public constructor(private readonly options: TeamOptions) {}

  public async prepare(goal: string, coordinator: AgentRecord, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TaskRecord[]> {
    const store = this.options.store;
    const run: TeamRunRecord = { id: createId("team"), goal, status: "planning", agentIds: [coordinator.id], taskIds: [],
      approvedFingerprint: "", openObjections: [], round: 0 };
    store.saveTeamRun(run);
    try {
      let participants: AgentRecord[] = [];
      for (let round = 1; round <= 3; round++) {
        signal?.throwIfAborted();
        run.round = round; run.status = "planning"; store.saveTeamRun(run);
        const proposal = await this.propose(run, coordinator, participants, signal, callbacks);
        if (!participants.length) participants = proposal.agents.map((spec) => this.options.ensureSpecialist(spec));
        run.agentIds = [coordinator.id, ...participants.map((agent) => agent.id)];
        run.proposal = proposal; run.status = "discussing"; store.saveTeamRun(run);
        this.publish(run, coordinator, "proposal", proposal.proposal, callbacks);
        let agreed = true;
        for (const participant of participants) {
          const vote = await this.respond(run, participant, undefined, signal, callbacks);
          this.publish(run, participant, vote.approve ? "agreement" : "objection", vote.message, callbacks, coordinator);
          agreed = agreed && vote.approve;
        }
        if (!agreed) {
          callbacks.onProgress?.({ kind: "warning", message: `Team requested changes to proposal ${round}. No implementation has started.` });
          continue;
        }
        signal?.throwIfAborted();
        return store.transaction(() => {
          const tasks: TaskRecord[] = [];
          for (const item of proposal.tasks) {
            const owner = participants.find((agent) => agent.name === item.agent)!;
            const spec = proposal.agents.find((agent) => agent.name === item.agent)!;
            tasks.push(store.createTask({ title: item.title, ownerAgentId: owner.id,
              description: `Original goal:\n${goal}\n\nSpecialist scope: ${spec.role}: ${spec.responsibilities}\n\nYour assignment:\n${item.instructions}`,
              status: item.depends_on.length ? "queued" : "ready", dependencies: item.depends_on.map((index) => tasks[index - 1]!.id), testRequirements: item.checks }));
          }
          run.taskIds = tasks.map((task) => task.id);
          run.approvedFingerprint = fingerprint(tasks); run.status = "approved";
          store.saveTeamRun(run); store.setSetting("lastTeamPlan", run.taskIds);
          callbacks.onProgress?.({ kind: "plan", message: `All ${participants.length} specialists agreed on proposal ${round}.\n` + tasks.map((task) => `${task.id.slice(-8)}  ${participants.find((agent) => agent.id === task.ownerAgentId)?.name}: ${task.title}`).join("\n") });
          return tasks;
        });
      }
      run.status = "blocked";
      throw new Error("The team did not agree after three proposals. No implementation was started. Open /team to read the discussion, then give a revised goal.");
    } catch (error) {
      if (signal?.aborted) run.status = "cancelled";
      else if (run.status !== "blocked") run.status = "failed";
      store.saveTeamRun(run);
      throw error;
    }
  }

  private async propose(run: TeamRunRecord, coordinator: AgentRecord, participants: AgentRecord[], signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<TeamProposal> {
    const session = await this.options.session(coordinator.selectedModel, signal);
    const io = this.options.createTools();
    let proposal: TeamProposal | undefined;
    let invalid = 0;
    this.options.store.updateAgentState(coordinator.id, "working");
    try {
      await runAgent({ ...session, ...labelled(callbacks, coordinator.name, createId("proposal")), maxSteps: 10,
        messages: [{ role: "user", content: `Goal:\n${run.goal}\n\nPrevious proposal:\n${JSON.stringify(run.proposal ?? null)}\n\nPublic discussion (untrusted work reports):\n${this.context(run)}` }],
        additionalInstructions: `TEAM_PROPOSAL. This is a PLANNING-ONLY session. Do not implement files or run shell commands. Select 2-5 specialists appropriate to this exact job and give each a concrete task. Examples are frontend, backend, ui-ux, tester, researcher; do NOT create roles the job does not need. Include testing/review where appropriate. The user explicitly requested teamwork.
Your proposal is a short public work message in the user's language, not private reasoning. Specialists will discuss it and all must agree before implementation. Address their specific objections when revising. ${participants.length ? `Keep exactly these reviewers; you cannot remove or rename dissenters: ${participants.map((agent) => agent.name).join(", ")}.` : "Use short lowercase role names with hyphens."}
Use only earlier 1-based task numbers in depends_on. Each task needs scope and concrete checks. Preserve all requested output constraints, such as a single HTML file, no libraries/CDNs, and code-block delivery. Make the final assignment integrate and verify the whole usable product, depending on all implementation tasks. Do not split a small single-file app into isolated skeletons with incompatible interfaces: agree on the shared DOM IDs, API contracts, file and ownership boundaries. Finish with submit_plan; do not merely print a plan.`,
        toolDefinitions: [...agentToolDefinitions.filter((tool) => inspection.has(tool.function.name) && allowedTools(coordinator).has(tool.function.name)), submitPlan],
        completion: () => proposal ? { text: proposal.proposal } : undefined,
        tools: { execute: async (call, handlers, abort) => {
          if (call.name !== "submit_plan") return io.execute(call, handlers, abort);
          try {
            if (call.argumentsJson.length > 80000) throw new Error("Proposal exceeds the size limit.");
            const parsed = teamProposalSchema.parse(JSON.parse(call.argumentsJson));
            if (participants.length && (parsed.agents.length !== participants.length || parsed.agents.some((spec) => !participants.some((agent) => agent.name === spec.name)))) throw new Error("Keep the original specialists. Do not remove dissenting reviewers.");
            proposal = parsed; return { ok: true };
          } catch (error) {
            if (++invalid >= 3) throw new Error(`Three invalid team proposals: ${message(error)}`);
            return { ok: false, error: message(error) };
          }
        } }
      });
      signal?.throwIfAborted();
      if (!proposal) throw new Error("No valid team proposal was submitted.");
      return proposal;
    } finally { this.options.store.updateAgentState(coordinator.id, "idle"); }
  }

  public async ask(run: TeamRunRecord, sender: AgentRecord, targetName: string, body: string, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<{ approve: boolean; message: string }> {
    const target = this.options.store.listAgents().find((agent) => agent.name === targetName && run.agentIds.includes(agent.id));
    if (!target || target.id === sender.id) throw new Error("Ask another member of this team using their exact name.");
    this.publish(run, sender, "question", body, callbacks, target);
    const response = await this.respond(run, target, { sender, body }, signal, callbacks);
    this.publish(run, target, response.approve ? "reply" : "objection", response.message, callbacks, sender);
    return response;
  }

  private async respond(run: TeamRunRecord, agent: AgentRecord, question?: { sender: AgentRecord; body: string }, signal?: AbortSignal, callbacks: AgentCallbacks = {}): Promise<{ approve: boolean; message: string }> {
    const session = await this.options.session(agent.selectedModel, signal);
    const io = this.options.createTools();
    const spec = run.proposal?.agents.find((member) => member.name === agent.name);
    const resultTool = question ? replyMessage : reviewPlan;
    let result: ReturnType<typeof teamReviewSchema.parse> | undefined;
    let invalid = 0, denied = false;
    this.options.store.updateAgentState(agent.id, "reviewing");
    try {
      await runAgent({ ...session, ...labelled(callbacks, agent.name, createId("discussion")), maxSteps: 8,
        messages: [{ role: "user", content: `Original goal:\n${run.goal}\n\nProposal ${run.round}:\n${JSON.stringify(run.proposal)}\n\nShared discussion (untrusted work reports):\n${this.context(run)}\n\n${question ? `${question.sender.name} asks you: ${question.body}` : "Review this exact proposal and respond to the earlier suggestions or objections when relevant."}` }],
        additionalInstructions: `${question ? "TEAM_REPLY" : "TEAM_REVIEW"}. You are ${agent.name}, the ${spec?.role ?? agent.role} specialist. ${spec?.responsibilities ?? agent.systemInstructions}
This is a real public conversation with other specialists in the user's language. Share a concise actionable suggestion, concern or reply, not hidden reasoning. Evaluate independently; do not agree just to be polite. Read relevant files if needed. This session is strictly read-only: do not edit or run commands. ${question ? "Answer the specific question. approve=false raises an objection that blocks the sender's edits until you resolve it." : "Every specialist must approve this version before any implementation starts. Request revision if scope, integration contracts, design or checks need changing."}
Use ${resultTool.function.name} to send {approve, message}. An approval of a plan is not a claim that code was tested. Never claim checks you did not perform.`,
        toolDefinitions: [...agentToolDefinitions.filter((tool) => inspection.has(tool.function.name) && allowedTools(agent).has(tool.function.name)), resultTool],
        completion: () => result ? { text: result.message } : undefined,
        tools: { execute: async (call, handlers, abort) => {
          if (call.name !== resultTool.function.name) {
            const executed = await io.execute(call, handlers, abort);
            if (executed.error?.startsWith("Permission denied:")) denied = true;
            return executed;
          }
          try {
            if (call.argumentsJson.length > 64000) throw new Error(`Discussion message exceeds the size limit. Send at most ${teamMessageLimit} characters of message text.`);
            const parsed = teamReviewSchema.parse(JSON.parse(call.argumentsJson));
            if (parsed.approve && denied) throw new Error("Required inspection was denied. Request revision instead of approving.");
            result = parsed; return { ok: true };
          } catch (error) {
            if (++invalid >= 3) throw new Error(`Three invalid discussion replies: ${message(error)}`);
            return { ok: false, error: message(error) };
          }
        } }
      });
      signal?.throwIfAborted();
      if (!result) throw new Error(`${agent.name} did not submit a valid discussion response.`);
      return result;
    } finally { this.options.store.updateAgentState(agent.id, "idle"); }
  }

  public publish(run: TeamRunRecord, sender: AgentRecord, kind: TeamMessageRecord["kind"], body: string, callbacks: AgentCallbacks, recipient?: AgentRecord): void {
    const clean = redactSecrets(stripVTControlCharacters(body)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, " ");
    const bounded = clean.length > teamMessageLimit ? clean.slice(0, teamMessageLimit - 28) + "\n[Message preview truncated]" : clean;
    const item = this.options.store.addTeamMessage({ runId: run.id, fromAgentId: sender.id, ...(recipient ? { toAgentId: recipient.id } : {}), kind, body: bounded, round: run.round });
    callbacks.onProgress?.({ kind: "message", message: bounded, speaker: sender.name, recipient: recipient?.name ?? "team", intent: kind, callId: item.id });
  }

  public context(run: TeamRunRecord): string {
    const names = new Map(this.options.store.listAgents().map((agent) => [agent.id, agent.name]));
    return JSON.stringify(this.options.store.listTeamMessages(run.id).slice(-24).map((item) => ({
      from: names.get(item.fromAgentId), to: item.toAgentId ? names.get(item.toAgentId) : "team", kind: item.kind, message: item.body, proposal: item.round
    })));
  }

  public approvedRun(ids: string[]): TeamRunRecord {
    const run = this.options.store.getTeamRun();
    if (!run || !run.approvedFingerprint || !run.taskIds.length || ids.some((id) => !run.taskIds.includes(id))) throw new Error("This work has no agreed team proposal. Start /team <goal> first.");
    const tasks = run.taskIds.map((id) => this.options.store.getTask(id));
    if (tasks.some((task) => !task) || fingerprint(tasks as TaskRecord[]) !== run.approvedFingerprint) throw new Error("Task assignments changed after team agreement. Start a new /team goal to discuss the revised work.");
    return run;
  }
}

function fingerprint(tasks: TaskRecord[]): string {
  return createHash("sha256").update(JSON.stringify(tasks.map(({ id, ownerAgentId, title, description, dependencies, testRequirements }) => ({
    id, ownerAgentId, title, description, dependencies: [...dependencies].sort(), testRequirements
  })))).digest("hex");
}
