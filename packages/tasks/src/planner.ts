import type { AgentRecord, StateStore, TaskRecord } from "@zuvcode/persistence";
import { createDefaultDefinitionOfDone, type DefinitionOfDoneItem } from "./definition-of-done.js";

export interface PlanResult {
  goal: string;
  definitionOfDone: DefinitionOfDoneItem[];
  tasks: TaskRecord[];
}

export class TaskPlanner {
  public constructor(private readonly store: StateStore) {}

  public createPlan(goal: string, owner?: AgentRecord): PlanResult {
    const definitionOfDone = createDefaultDefinitionOfDone(goal);
    const taskInputs = inferTasks(goal);
    const tasks: TaskRecord[] = [];

    for (const [index, task] of taskInputs.entries()) {
      const input: Parameters<StateStore["createTask"]>[0] = {
        title: task.title,
        description: task.description,
        status: index === 0 ? "ready" : "queued",
        testRequirements: task.testRequirements
      };
      if (owner !== undefined) {
        input.ownerAgentId = owner.id;
      }
      const created = this.store.createTask(input);
      tasks.push(created);
    }

    this.store.setSetting("lastDefinitionOfDone", definitionOfDone);

    return { goal, definitionOfDone, tasks };
  }
}

interface TaskInput {
  title: string;
  description: string;
  testRequirements: string[];
}

function inferTasks(goal: string): TaskInput[] {
  const normalized = goal.toLowerCase();
  if (normalized.includes("rest api") || normalized.includes("typescript api")) {
    return [
      {
        title: "Inspect target project",
        description: "Detect existing package manager, TypeScript settings, and safe output location.",
        testRequirements: ["Project detection completes"]
      },
      {
        title: "Create TypeScript REST API",
        description: "Generate a minimal no-framework Node HTTP REST API with health and items endpoints.",
        testRequirements: ["Generated server compiles"]
      },
      {
        title: "Run verification",
        description: "Run build and tests for the generated API and store evidence.",
        testRequirements: ["Build passes", "Tests pass"]
      }
    ];
  }

  return [
    {
      title: "Clarify implementation surface",
      description: "Inspect project context and convert the user goal into a Definition of Done.",
      testRequirements: ["Definition of Done created"]
    },
    {
      title: "Plan implementation",
      description: "Break the goal into dependency-aware tasks and assign an owner agent.",
      testRequirements: ["Task graph persisted"]
    },
    {
      title: "Verify current milestone",
      description: "Run available build and tests, then record pass/fail evidence without fabrication.",
      testRequirements: ["Verification evidence recorded"]
    }
  ];
}
