import type { ModelMetadata } from "@zuvcode/protocol";

export type TaskKind = "planning" | "coding" | "research" | "small-edit" | "testing" | "offline" | "vision";

export interface ModelRouteRequest {
  taskKind: TaskKind;
  requireVision?: boolean;
  preferLocal?: boolean;
  budgetMode?: "economy" | "balanced" | "quality";
}

export interface ModelRouteDecision {
  model: ModelMetadata;
  reason: string;
}

export class AutoModelRouter {
  public constructor(private readonly models: ModelMetadata[]) {}

  public route(request: ModelRouteRequest): ModelRouteDecision | undefined {
    const available = this.models.filter((model) => model.availability !== "unavailable");
    const candidates = available.filter((model) => {
      if (request.requireVision === true && !model.capabilities.vision) {
        return false;
      }

      if (request.preferLocal === true && model.locality !== "local") {
        return false;
      }

      return true;
    });

    const scored = candidates
      .map((model) => ({ model, score: this.score(model, request) }))
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best === undefined) {
      return undefined;
    }

    return {
      model: best.model,
      reason: this.explain(best.model, request)
    };
  }

  private score(model: ModelMetadata, request: ModelRouteRequest): number {
    let score = 0;
    score += model.availability === "available" ? 40 : 10;
    score += model.speed === "fast" ? 8 : model.speed === "balanced" ? 4 : 0;
    score += model.locality === "local" ? 4 : 0;

    if (request.taskKind === "coding") {
      score += suitabilityScore(model.codingSuitability) * 3;
    }
    if (request.taskKind === "planning" || request.taskKind === "research") {
      score += suitabilityScore(model.reasoningSuitability) * 3;
    }
    if (request.taskKind === "small-edit" || request.taskKind === "testing") {
      score += model.speed === "fast" ? 10 : 2;
    }
    if (request.budgetMode === "economy") {
      score += model.locality === "local" ? 20 : 0;
      score -= model.approximateInputCostPerMillion ?? 0;
    }
    if (request.budgetMode === "quality") {
      score += suitabilityScore(model.reasoningSuitability) + suitabilityScore(model.codingSuitability);
    }

    return score;
  }

  private explain(model: ModelMetadata, request: ModelRouteRequest): string {
    if (request.preferLocal === true && model.locality === "local") {
      return `Selected ${model.displayName} because local execution was preferred.`;
    }

    if (request.taskKind === "coding") {
      return `Selected ${model.displayName} for coding suitability and availability.`;
    }

    if (request.taskKind === "planning") {
      return `Selected ${model.displayName} for planning and reasoning suitability.`;
    }

    return `Selected ${model.displayName} for ${request.taskKind}.`;
  }
}

function suitabilityScore(value: "low" | "medium" | "high"): number {
  if (value === "high") {
    return 10;
  }

  if (value === "medium") {
    return 5;
  }

  return 1;
}

