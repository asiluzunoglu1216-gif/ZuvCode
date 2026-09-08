import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveDataDirectory } from "@zuvcode/shared";

export interface LoadedSkill {
  name: string;
  path: string;
  instructions: string;
}

export class SkillLoader {
  public constructor(private readonly projectRoot: string) {}

  public listProjectSkills(): LoadedSkill[] {
    const root = join(resolveDataDirectory(this.projectRoot), "skills");
    if (!existsSync(root)) {
      return [];
    }

    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = join(root, entry.name, "SKILL.md");
        if (!existsSync(skillPath)) {
          return undefined;
        }

        return {
          name: entry.name,
          path: skillPath,
          instructions: readFileSync(skillPath, "utf8")
        };
      })
      .filter((skill): skill is LoadedSkill => skill !== undefined);
  }
}
