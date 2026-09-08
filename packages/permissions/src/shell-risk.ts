import type { RiskLevel } from "@zuvcode/shared";

const criticalPatterns: RegExp[] = [
  /\brm\s+-rf\b/i,
  /\bdel\s+\/[sq]\b/i,
  /\brmdir\s+\/s\b/i,
  /\bformat\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+push\b.*\s--force\b/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bshutdown\b/i
];

const highPatterns: RegExp[] = [
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\bvercel\s+deploy\b.*\s--prod\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\bgit\s+push\b/i,
  /\bprisma\s+migrate\s+deploy\b/i,
  /\bcurl\b.*\|\s*(sh|bash|powershell|pwsh)\b/i
];

const mediumPatterns: RegExp[] = [
  /\b(pnpm|npm|yarn)\s+install\b/i,
  /\b(pnpm|npm|yarn)\s+add\b/i,
  /\bgit\s+commit\b/i,
  /\bnode\b/i,
  /\btsx\b/i,
  /\btsc\b/i
];

export function classifyShellCommand(command: string): RiskLevel {
  if (criticalPatterns.some((pattern) => pattern.test(command))) {
    return "CRITICAL";
  }

  if (highPatterns.some((pattern) => pattern.test(command))) {
    return "HIGH";
  }

  if (mediumPatterns.some((pattern) => pattern.test(command))) {
    return "MEDIUM";
  }

  return "LOW";
}

/** Smart mode has a small command allowlist; compound and unfamiliar commands still ask. */
export function needsCommandApproval(command: string): boolean {
  const text = command.trim();
  if (/[\r\n;&|<>`$(){}\[\]]/.test(text) || /["']/.test(text)) return true;
  if (classifyShellCommand(text) === "HIGH" || classifyShellCommand(text) === "CRITICAL") return true;
  if (/\b(?:--(?:prefix|cwd|directory|config|require|import|exec|eval)|-C)\b/i.test(text)) return true;
  if (/(?:^|\s)(?:[A-Za-z]:|\/|\.\.)(?:[\\/]|\S)/.test(text)) return true;
  const parts = text.split(/\s+/);
  const program = parts[0]?.toLowerCase();
  const args = parts.slice(1);
  if (args.some((arg) => /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(arg))) return true;
  if (["pwd", "get-location"].includes(program ?? "")) return args.length !== 0;
  if (["echo", "write-output"].includes(program ?? "")) return args.some((arg) => arg.startsWith("-"));
  if (["ls", "dir", "get-childitem"].includes(program ?? "")) return args.some((arg) => !/^(?:\.|-la?|-al?|--all|-Force|-Name|-Recurse)$/i.test(arg));
  if (program === "git") {
    if (["status", "log", "diff", "show"].includes(args[0] ?? "")) {
      return args.slice(1).some((arg) => !/^(?:--short|--porcelain(?:=v[12])?|--oneline|--stat|--name-only|--cached|--staged|--no-ext-diff|--no-textconv|--no-pager|-\d+|HEAD(?:~\d+)?)$/.test(arg));
    }
    return args.join(" ") !== "--version";
  }
  if (["node", "npm", "pnpm", "yarn", "bun", "python", "python3", "tsc"].includes(program ?? "") && args.join(" ") === "--version") return false;
  if (["npm", "pnpm", "yarn", "bun"].includes(program ?? "")) {
    const script = args[0] === "run" ? args[1] : args[0];
    const rest = args.slice(args[0] === "run" ? 2 : 1);
    if (["build", "test", "lint", "typecheck", "check"].includes(script ?? "")) {
      return rest.some((arg) => !/^(?:--|--run|--watch=false|--noEmit|--pretty=false|--runInBand)$/.test(arg));
    }
  }
  if (program === "node" && args[0] === "--check" && args.length === 2) return !/^[\w./\\-]+\.(?:cjs|mjs|js)$/.test(args[1] ?? "");
  if (program === "tsc" && args.join(" ") === "--noEmit") return false;
  return true;
}
