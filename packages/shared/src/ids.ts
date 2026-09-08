import { randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  const safePrefix = prefix.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `${safePrefix}_${randomUUID()}`;
}

