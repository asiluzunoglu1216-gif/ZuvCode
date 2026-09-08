export interface DefinitionOfDoneItem {
  id: string;
  text: string;
  verified: boolean;
  evidence?: string;
}

export function createDefaultDefinitionOfDone(goal: string): DefinitionOfDoneItem[] {
  return [
    item("install", "Project installs successfully"),
    item("build", "Project builds successfully"),
    item("features", `Main requested goal is represented: ${goal}`),
    item("tests", "Automated tests pass or an explicit limitation is recorded"),
    item("runtime", "No known critical runtime error"),
    item("config", "Required configuration exists"),
    item("docs", "README or handoff documentation exists"),
    item("request-check", "Original request is checked against implementation")
  ];
}

function item(id: string, text: string): DefinitionOfDoneItem {
  return { id, text, verified: false };
}

