import type { DoctorReport, RunGoalResult } from "@zuvcode/orchestration";
import type { AgentRecord, TaskRecord } from "@zuvcode/persistence";
import type { ModelMetadata } from "@zuvcode/protocol";
import type { ProviderStatusView } from "@zuvcode/providers";
import { banner, section, table, fit, plain, renderMarkdown, terminalWidth, theme } from "@zuvcode/terminal-ui";

export function renderFileHistory(checkpoints: Array<{ id: string; createdAt: string; reason: string; files: unknown[] }>, page = 1): string {
  const records = checkpoints.filter((item) => item.files.length);
  const pages = Math.max(1, Math.ceil(records.length / 6));
  if (!Number.isSafeInteger(page) || page < 1 || page > pages) throw new Error(`History page must be between 1 and ${pages}.`);
  const body = records.slice((page - 1) * 6, page * 6).map((item) =>
    `**${plain(item.id.slice(0, 8))}**  ${plain(item.createdAt.slice(0, 19).replace("T", " "))}\n\n${item.files.length} files - ${plain(item.reason)}`).join("\n\n");
  return renderMarkdown(`### File History\n\n${body || "No file checkpoints yet. Older deleted files need an existing backup."}\n\nPage ${page}/${pages}${page < pages ? `. Next: \`/changes history ${page + 1}\`` : ""}\n\nRecover a copy:\n\n\`/changes recover <id>\`\n\nCurrent files stay unchanged.`);
}

export function renderDoctor(report: DoctorReport): string {
  return section(
    "ZuvCode DOCTOR",
    table(
      ["Check", "Value"],
      [
        ["Node", report.nodeVersion],
        ["Project", `${report.project.name} (${report.project.rootPath})`],
        ["Git", report.project.hasGit ? `${report.project.gitBranch ?? "unknown"} ${report.project.gitDirty ? "dirty" : "clean"}` : "none"],
        ["Package manager", report.project.packageManager ?? "unknown"],
        ["SQLite", report.databasePath],
        ["Providers", String(report.providerCount)],
        ["Agents", String(report.agentCount)],
        ["Tasks", String(report.taskCount)],
        ["Skills", String(report.skillCount)],
        ["Permission mode", report.permissionMode],
        ["Protected paths", report.protectedPaths.join(", ")]
      ]
    )
  );
}

export function renderProviders(providers: ProviderStatusView[]): string {
  return section(
    "AI PROVIDERS",
    table(
      ["Group", "Provider", "Status", "Detail"],
      providers.map((provider) => [provider.group, provider.name, provider.status, provider.detail ?? ""])
    )
  );
}

export function renderModels(models: ModelMetadata[]): string {
  return section(
    "AI MODELS",
    table(
      ["Provider", "Model", "Locality", "Coding", "Reasoning", "Status"],
      models.map((model) => [
        model.provider,
        model.displayName,
        model.locality,
        model.codingSuitability,
        model.reasoningSuitability,
        model.availability
      ])
    )
  );
}

export function renderAgents(agents: AgentRecord[]): string {
  return section(
    "AGENTS",
    table(
      ["Name", "Role", "Model", "Status"],
      agents.map((agent) => [agent.name, agent.role, agent.selectedModel, agent.status])
    )
  );
}

export function renderTasks(tasks: TaskRecord[], agents: AgentRecord[] = []): string {
  if (tasks.length === 0) {
    return section("TASKS", "No tasks recorded yet.");
  }

  return section(
    "TASKS",
    table(
      ["Task", "Agent", "Status", "Title"],
      tasks.map((task) => [task.id.slice(-8), agents.find((agent) => agent.id === task.ownerAgentId)?.name ?? "-", task.status, task.title])
    )
  );
}

export function renderTaskDetails(task: TaskRecord, agents: AgentRecord[]): string {
  return section(`TASK ${plain(task.id)}`, [
    table(["Field", "Value"], [
      ["Agent", agents.find((agent) => agent.id === task.ownerAgentId)?.name ?? "Missing"],
      ["Status", task.status], ["Attempts", String(task.attempts)], ["Model", task.modelUsed || "Not run"],
      ["Depends on", task.dependencies.map((id) => id.slice(-8)).join(", ") || "None"],
      ["Files", task.generatedFiles.join(", ") || "None recorded"]
    ]),
    "", plain(task.title), "", plain(task.description),
    "", "Required checks:", ...task.testRequirements.map((check) => `  ${plain(check)}`),
    "", "Tool evidence:", ...task.completionEvidence.map((item) => `  ${plain(item)}`),
    "", "Result:", renderMarkdown(task.resultText || "No result yet.")
  ].join("\n"));
}

export function renderTeamReport(tasks: TaskRecord[], agents: AgentRecord[]): string {
  const count = tasks.filter((task) => task.status === "complete").length;
  const complete = tasks.length > 0 && count === tasks.length;
  const header = section(complete ? "TEAM TASKS COMPLETE" : "TEAM INCOMPLETE",
    renderMarkdown(`${count}/${tasks.length} tasks complete.` + (complete ? "" : "\n\nThe requested deliverable is unfinished. Completed component work is not a finished application.\n\nUse /team resume to continue; /tasks <id> shows evidence.")));
  const reports = complete ? tasks.slice(-1) : tasks.filter((task) => task.resultText && task.status !== "complete");
  return [renderTasks(tasks, agents), ...reports.map((task) => renderMarkdown(`### ${task.title} (${task.status})\n\n${task.resultText}`)), header].join("\n\n");
}

export function renderRunResult(result: RunGoalResult): string {
  const lines = [
    "ZuvCode RUN REPORT",
    "",
    `Goal: ${result.plan.goal}`,
    `Tasks: ${result.plan.tasks.length}`,
    result.selectedModel === undefined ? "Model: unavailable" : `Model: ${result.selectedModel.provider}/${result.selectedModel.id}`,
    result.routeReason === undefined ? undefined : `Route: ${result.routeReason}`,
    result.execution === undefined ? undefined : `Execution: ${result.execution.ok ? "PASS" : "FAIL"} (${result.execution.outputDir})`,
    "",
    "Definition of Done:",
    ...result.plan.definitionOfDone.map((item) => `  [${item.verified ? "x" : " "}] ${item.text}`),
    "",
    "Evidence:",
    ...result.evidence.map((item) => `  - ${item}`)
  ].filter((line): line is string => line !== undefined);

  return lines.join("\n");
}

export function renderWelcome(report: DoctorReport, selectedModel: string): string {
  const width = terminalWidth() - 4;
  const branch = report.project.gitBranch ? `  [${plain(report.project.gitBranch)}]` : "";
  return [
    "", banner(), "",
    `  ${fit(plain(report.project.name) + branch, width)}`,
    `  ${theme.muted(fit(plain(report.project.rootPath), width))}`,
    `  ${fit(selectedModel === "AUTO" ? "Auto" : plain(selectedModel), width)}`,
    `  ${theme.muted(`${report.providerCount} connections  /  ${report.agentCount} agents`)}`,
    ""
  ].join("\n");
}
