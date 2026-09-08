export const permissionChoices = [
  { value: "SAFE", name: "Ask Every Time", description: "Default. Approve each file, web, and command operation." },
  { value: "BALANCED", name: "Smart", description: "Auto-run project work and checks; ask for risky or unfamiliar commands." },
  { value: "FULL_ACCESS", name: "Full Access", description: "No prompts. External access. Destructive cleanup guard stays on." }
] as const;

export function permissionLabel(mode: string): string {
  return permissionChoices.find((choice) => choice.value === mode)?.name ?? mode;
}
