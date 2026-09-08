import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const problems = [];
for (const path of paths) {
  if (/(^|\/)(?:\.zuvcode(?:-dev)?|\.orvynx|node_modules|dist|artifacts|\.tmp-[^/]*|\.pnpm-[^/]*)(\/|$)|(^|\/)\.env(?:\.|$)|(?:credentials\.json|\.db(?:-wal|-shm)?)$/i.test(path)) {
    problems.push(`${path}: private/generated path`); continue;
  }
  const content = readFileSync(path, "utf8");
  const secret = /(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,}|AIza[A-Za-z0-9_-]{30,}|sk-(?!test-)(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
  if (secret.test(content)) problems.push(`${path}: possible credential (value withheld)`);
  if (/C:[\\/]+Users[\\/]+Asil10tr/i.test(content)) problems.push(`${path}: personal absolute path`);
}
if (!paths.length) throw new Error("No indexed publication files found.");
if (problems.length) throw new Error(`Publication check failed:\n${problems.join("\n")}`);
console.log(`PASS: checked ${paths.length} indexed files for private/generated paths and common credential patterns. This is not an exhaustive secret scanner.`);
