import { normalize, sep } from "node:path";

export function isProtectedPath(path: string, patterns: string[]): boolean {
  const normalized = normalizeForMatch(path);
  return patterns.some((pattern) => matchesPattern(normalized, normalizeForMatch(pattern)));
}

function normalizeForMatch(value: string): string {
  return normalize(value).split(sep).join("/");
}

function matchesPattern(path: string, pattern: string): boolean {
  if (pattern === path) {
    return true;
  }

  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return path === prefix || path.startsWith(`${prefix}/`);
  }

  if (pattern.includes("*")) {
    const escaped = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${escaped}$`).test(path);
  }

  return false;
}

