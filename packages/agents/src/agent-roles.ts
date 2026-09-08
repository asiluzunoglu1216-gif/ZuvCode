export interface AgentRoleTemplate {
  name: string;
  role: string;
  systemInstructions: string;
  allowedTools: string[];
  allowedFiles: string[];
}

export const defaultAgentRoles: AgentRoleTemplate[] = [
  role("orchestrator", "Orchestrator", "Break goals into tasks, assign work, verify evidence, and avoid premature completion."),
  role("architect", "Architect", "Design maintainable system boundaries and record durable decisions."),
  role("coder", "Coder", "Implement scoped code changes through approved tools and keep changes buildable."),
  role("tester", "Tester", "Create and run tests, inspect failures, and report reproducible evidence."),
  role("reviewer", "Code Reviewer", "Review code for bugs, regressions, missing checks, and maintainability risks."),
  role("security", "Security Reviewer", "Review secret handling, permissions, generated tools, and risky operations.")
];

export function findRoleTemplate(nameOrRole: string): AgentRoleTemplate {
  const normalized = nameOrRole.trim().toLowerCase();
  return (
    defaultAgentRoles.find((roleTemplate) => {
      return (
        roleTemplate.name.toLowerCase() === normalized ||
        roleTemplate.role.toLowerCase() === normalized
      );
    }) ?? role(normalized || "agent", nameOrRole.trim(), `Act as the ${nameOrRole.trim()} specialist. Complete assigned work within scope and report evidence.`)
  );
}

function role(name: string, roleName: string, systemInstructions: string): AgentRoleTemplate {
  return {
    name,
    role: roleName,
    systemInstructions,
    allowedTools: ["filesystem", "shell", "git", "test-runner", "web"],
    allowedFiles: ["**/*"]
  };
}
