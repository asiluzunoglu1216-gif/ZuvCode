import { permissionModeSchema } from "@zuvcode/shared";
import { z } from "zod";

export const projectConfigSchema = z.object({
  schemaVersion: z.literal(1),
  permissionMode: permissionModeSchema.default("SAFE"),
  router: z
    .object({
      mode: z.enum(["AUTO", "MANUAL"]).default("AUTO"),
      budgetMode: z.enum(["economy", "balanced", "quality"]).default("balanced"),
      preferLocal: z.boolean().default(false)
    })
    .default({ mode: "AUTO", budgetMode: "balanced", preferLocal: false }),
  agents: z
    .object({
      maxAgents: z.number().int().positive().max(32).default(8),
      cleanupIdleAfterMinutes: z.number().int().positive().default(60)
    })
    .default({ maxAgents: 8, cleanupIdleAfterMinutes: 60 }),
  protectedPaths: z.array(z.string()).default([".env", ".env.*", "production/**"])
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;

export function defaultProjectConfig(): ProjectConfig {
  return projectConfigSchema.parse({ schemaVersion: 1 });
}
