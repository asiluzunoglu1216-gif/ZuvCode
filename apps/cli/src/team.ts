import type { ZuvCodeRuntime } from "@zuvcode/orchestration";
import type { TaskRecord } from "@zuvcode/persistence";
import { ask, choose, plain, renderMarkdown, runActivity, section } from "@zuvcode/terminal-ui";
import { renderAgents, renderTeamReport } from "./render.js";

export async function handleTeam(runtime: ZuvCodeRuntime, args: string, interactive: boolean): Promise<void> {
  const report = (tasks: TaskRecord[]) => {
    const state = runtime.teamState();
    const all = state.run ? state.run.taskIds.map((id) => runtime.findTask(id)) : tasks;
    console.log(renderTeamReport(all, runtime.listAgents()));
  };
  const run = async (goal: string) => report(await runActivity((signal, callbacks) => runtime.runTeam(goal, signal, callbacks)));
  const resume = async () => report(await runActivity((signal, callbacks) => runtime.runSavedPlan(signal, callbacks)));
  const retry = async (id: string) => report(await runActivity((signal, callbacks) => runtime.retryTeamTask(id, signal, callbacks)));
  const conversation = () => {
    const state = runtime.teamState();
    const name = (id?: string) => state.agents.find((agent) => agent.id === id)?.name ?? "team";
    console.log(section("TEAM CONVERSATION", state.messages.map((item) =>
      renderMarkdown(`### ${name(item.fromAgentId)} -> ${name(item.toAgentId)} (${item.kind})\n\n${item.body}`)).join("\n") || "No conversation yet."));
  };
  if (args === "resume") { await resume(); return; }
  if (args === "chat") { conversation(); return; }
  if (/^retry\s+\S+$/.test(args)) { await retry(args.split(/\s+/)[1]!); return; }
  if (args) { await run(args); return; }
  const state = runtime.teamState();
  console.log(section("TEAM", state.run ? `${plain(state.run.goal)}\n${state.run.status}` : "No team task yet."));
  if (state.agents.length) console.log(renderAgents(state.agents));
  if (!interactive) return;
  const unfinished = runtime.listTasks().filter((task) => state.run?.taskIds.includes(task.id) && task.status !== "complete");
  const action = await choose({ title: "Team", choices: [
    { value: "new", name: "New team task" },
    ...(state.messages.length ? [{ value: "chat", name: "Read conversation" }] : []),
    ...(state.run?.approvedFingerprint && unfinished.length ? [{ value: "resume", name: "Resume unfinished work" }, { value: "retry", name: "Retry one task" }] : []),
    ...(state.agents.length ? [{ value: "model", name: "Agent models" }] : []),
    { value: "budget", name: "Work budget", description: `${runtime.executionStepLimit()} model turns per task` },
    { value: "back", name: "Back" }
  ] }, { clearPromptOnDone: true });
  if (action === "new") { const goal = (await ask("Team task")).trim(); if (goal) await run(goal); }
  else if (action === "chat") conversation();
  else if (action === "resume") await resume();
  else if (action === "retry") {
    const id = await choose({ title: "Retry task", choices: unfinished.map((task) => ({ value: task.id, name: task.title, description: `${task.id.slice(-8)} | ${task.status}` })) }, { clearPromptOnDone: true });
    if (id) await retry(id);
  } else if (action === "budget") {
    const budget = await choose({ title: `Work budget: ${runtime.executionStepLimit()} model turns per task`, choices: [
      { value: "120", name: "Standard", description: "120 model turns per task" },
      { value: "300", name: "Extended", description: "300 model turns; potentially higher token cost" },
      { value: "40", name: "Economy", description: "40 model turns" },
      { value: "custom", name: "Custom", description: "1-1000 model turns" }
    ] }, { clearPromptOnDone: true });
    if (!budget) return;
    const limit = Number(budget === "custom" ? await ask("Model turns per task (1-1000)") : budget);
    runtime.setExecutionStepLimit(limit);
    console.log(`  Work budget: ${limit} model turns per task. Applies to chat and team workers in this project.\n  Independent of permissions; a larger budget can use more tokens.\n`);
  } else if (action === "model") {
    const name = await choose({ title: "Agent", choices: state.agents.map((agent) => ({ value: agent.name, name: agent.name, description: agent.role })) }, { clearPromptOnDone: true });
    if (!name) return;
    const model = await choose({ title: `Model for ${name}`, choices: [
      { value: "AUTO", name: "Use current model" },
      ...runtime.savedModels().map((item) => ({ value: `${item.provider}/${item.id}`, name: item.displayName, description: item.provider }))
    ] }, { clearPromptOnDone: true });
    if (model) { runtime.setAgentModel(name, model); console.log(renderAgents(runtime.teamState().agents)); }
  }
}
