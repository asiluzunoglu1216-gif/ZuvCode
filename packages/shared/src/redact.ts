const secretPatterns: RegExp[] = [
  /(sk-[a-zA-Z0-9_-]{12,})/g,
  /(xox[baprs]-[a-zA-Z0-9-]+)/g,
  /(api[_-]?key["'\s:=]+)([^"',\s]+)/gi,
  /(authorization["'\s:=]+bearer\s+)([^"',\s]+)/gi,
  /(password["'\s:=]+)([^"',\s]+)/gi,
  /(token["'\s:=]+)([^"',\s]+)/gi
];

export function redactSecrets(input: string): string {
  return secretPatterns.reduce((value, pattern) => {
    return value.replace(pattern, (_match: string, prefixOrSecret: string, maybeSecret?: string) => {
      if (typeof maybeSecret !== "string") {
        return "[REDACTED]";
      }

      return `${prefixOrSecret}[REDACTED]`;
    });
  }, input);
}

export function maskSecretReference(value: string): string {
  if (value.length <= 4) {
    return "****";
  }

  return `${value.slice(0, 2)}${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
}
