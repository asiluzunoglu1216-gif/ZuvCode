export type ZuvCodeErrorCode =
  | "PROVIDER_AUTHENTICATION"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "CONTEXT_LIMIT"
  | "TOOL_PERMISSION"
  | "TOOL_EXECUTION"
  | "BUDGET_EXCEEDED"
  | "AGENT_FAILURE"
  | "TASK_BLOCKED"
  | "CONFIGURATION"
  | "VALIDATION"
  | "PERSISTENCE"
  | "UNKNOWN";

export interface ZuvCodeErrorOptions {
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class ZuvCodeError extends Error {
  public readonly code: ZuvCodeErrorCode;
  public readonly details?: Record<string, unknown>;

  public constructor(code: ZuvCodeErrorCode, message: string, options: ZuvCodeErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.code = code;

    if (options.details !== undefined) {
      this.details = options.details;
    }

    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export class ProviderAuthenticationError extends ZuvCodeError {
  public constructor(message = "Provider authentication failed", options?: ZuvCodeErrorOptions) {
    super("PROVIDER_AUTHENTICATION", message, options);
  }
}

export class ProviderRateLimitError extends ZuvCodeError {
  public constructor(message = "Provider rate limit reached", options?: ZuvCodeErrorOptions) {
    super("PROVIDER_RATE_LIMIT", message, options);
  }
}

export class ProviderUnavailableError extends ZuvCodeError {
  public constructor(message = "Provider is unavailable", options?: ZuvCodeErrorOptions) {
    super("PROVIDER_UNAVAILABLE", message, options);
  }
}

export class ModelNotFoundError extends ZuvCodeError {
  public constructor(message = "Model was not found", options?: ZuvCodeErrorOptions) {
    super("MODEL_NOT_FOUND", message, options);
  }
}

export class ContextLimitError extends ZuvCodeError {
  public constructor(message = "Context limit exceeded", options?: ZuvCodeErrorOptions) {
    super("CONTEXT_LIMIT", message, options);
  }
}

export class ToolPermissionError extends ZuvCodeError {
  public constructor(message = "Tool permission denied", options?: ZuvCodeErrorOptions) {
    super("TOOL_PERMISSION", message, options);
  }
}

export class ToolExecutionError extends ZuvCodeError {
  public constructor(message = "Tool execution failed", options?: ZuvCodeErrorOptions) {
    super("TOOL_EXECUTION", message, options);
  }
}

export class BudgetExceededError extends ZuvCodeError {
  public constructor(message = "Budget exceeded", options?: ZuvCodeErrorOptions) {
    super("BUDGET_EXCEEDED", message, options);
  }
}

export class AgentFailureError extends ZuvCodeError {
  public constructor(message = "Agent failed", options?: ZuvCodeErrorOptions) {
    super("AGENT_FAILURE", message, options);
  }
}

export class TaskBlockedError extends ZuvCodeError {
  public constructor(message = "Task is blocked", options?: ZuvCodeErrorOptions) {
    super("TASK_BLOCKED", message, options);
  }
}

export class ConfigurationError extends ZuvCodeError {
  public constructor(message = "Configuration error", options?: ZuvCodeErrorOptions) {
    super("CONFIGURATION", message, options);
  }
}

export class ValidationError extends ZuvCodeError {
  public constructor(message = "Validation failed", options?: ZuvCodeErrorOptions) {
    super("VALIDATION", message, options);
  }
}

export class PersistenceError extends ZuvCodeError {
  public constructor(message = "Persistence failed", options?: ZuvCodeErrorOptions) {
    super("PERSISTENCE", message, options);
  }
}

export function toZuvCodeError(error: unknown): ZuvCodeError {
  if (error instanceof ZuvCodeError) {
    return error;
  }

  if (error instanceof Error) {
    return new ZuvCodeError("UNKNOWN", error.message, { cause: error });
  }

  return new ZuvCodeError("UNKNOWN", "Unknown error", { details: { value: String(error) } });
}

