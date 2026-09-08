export class CommandSafetyError extends Error {}

/** A guardrail for obvious mistakes, not a parser or an OS sandbox. Shell backups cover indirect project deletions. */
export function assertCommandSafety(command: string): void {
  const deletion = /\b(?:Remove-Item|Clear-Content|rmdir|rd|erase|unlink|shred)\b|\b(?:rm|del)\s|\b(?:unlinkSync|rmSync|rmdirSync|rmtree|removeAll|DeleteFile)\s*\(|\b(?:fs|os)\.(?:unlink|rm|remove|rmdir)\s*\(|\[\s*(?:System\.)?IO\.(?:File|Directory)\s*\]\s*::\s*Delete\b|\bgit\s+(?:clean|reset\b[^\r\n]*--hard|checkout\s+--|restore\b)|\b(?:format|mkfs)\s/i;
  const processes = /\b(?:Stop-Process|taskkill|killall|pkill|shutdown|Restart-Computer|Stop-Computer)\b|\bkill\s+-9\b/i;
  if (deletion.test(command) || processes.test(command)) {
    throw new CommandSafetyError("Safety guard: destructive cleanup or broad process termination is not available to agents, including Full Access. Nothing ran. Preserve project/test files; use edit_file for changes and only stop a child process you created via its own handle. Ask the user to perform genuinely necessary deletion manually.");
  }
}
