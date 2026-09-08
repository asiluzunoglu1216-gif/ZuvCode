import { maskSecretReference } from "@zuvcode/shared";

export type SecretRef = { kind: "env"; name: string } | { kind: "session"; id: string };

const knownProviderEnvVars = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "NVIDIA_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "XAI_API_KEY"
] as const;

export class SecretResolver {
  private readonly sessionSecrets = new Map<string, string>();

  public setSessionSecret(id: string, value: string): SecretRef {
    this.sessionSecrets.set(id, value);
    return { kind: "session", id };
  }

  public resolve(ref: SecretRef | undefined): string | undefined {
    if (ref === undefined) {
      return undefined;
    }

    if (ref.kind === "env") {
      return process.env[ref.name];
    }

    return this.sessionSecrets.get(ref.id);
  }

  public describe(ref: SecretRef | undefined): string {
    if (ref === undefined) {
      return "none";
    }

    if (ref.kind === "env") {
      return `env:${ref.name}`;
    }

    return `session:${maskSecretReference(ref.id)}`;
  }
}

export interface DetectedCredential {
  envVar: string;
  present: boolean;
}

export function detectCredentialEnv(): DetectedCredential[] {
  return knownProviderEnvVars.map((envVar) => ({
    envVar,
    present: typeof process.env[envVar] === "string" && String(process.env[envVar]).length > 0
  }));
}

export function providerEnvVar(kind: string): string | undefined {
  const map: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    google: "GEMINI_API_KEY",
    nvidia: "NVIDIA_API_KEY",
    groq: "GROQ_API_KEY",
    mistral: "MISTRAL_API_KEY",
    deepseek: "DEEPSEEK_API_KEY",
    xai: "XAI_API_KEY",
    "openai-compatible": "OPENAI_API_KEY"
  };

  return map[kind];
}

export function availableProviderEnvVar(kind: string): string | undefined {
  return [providerEnvVar(kind), ...(kind === "google" ? ["GOOGLE_API_KEY"] : [])]
    .find((name): name is string => Boolean(name && process.env[name]?.trim()));
}
