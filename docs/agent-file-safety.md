# Agent File Safety: 2026-09-07

## Confirmed Incident

Read-only inspection of the user's `Desktop/test/.zuvcode/state.db` found that the first worker of the latest team run invoked Node `fs.unlinkSync` to remove seven named test/helper files. Its output explicitly listed only `.zuvcode` and `audio-engine.js` afterward. The runtime did not automatically roll back that project; the model issued cleanup commands through unrestricted shell access. The evidence also contains attempts to stop all Chrome processes. The disappearance of every older file (including the earlier `index.html`) cannot be attributed solely to these retained command entries.

The worker's final status was caused by rejected completion attempts. The old failure set retained invalid argument keys even after corrected calls, and treated non-repository `git status` as a failed required check. There were also genuine failed checks during the attempt, later successful reruns and an unmatched edit; the fix must preserve real test-failure gates rather than declare all errors successful.

The old `tool_calls` and `checkpoints` tables have no recoverable records for this run. Task summaries contain paths/evidence, not full versions of the deleted source files. The user project and credentials were not modified during this investigation, and no paid model was invoked.

## Primary References

- [Claude Code checkpointing](https://code.claude.com/docs/en/checkpointing): file-edit snapshots and rewind; shell changes are not tracked, and checkpoints are not a replacement for Git.
- [OpenCode snapshot implementation](https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/snapshot/index.ts): a separate Git object store, tree snapshots and file restoration, with serialized operations.
- [OpenCode TUI undo](https://opencode.ai/docs/tui/#undo): undo includes file changes and depends on a Git repository.
- [Aider Git integration](https://aider.chat/docs/git.html): automatic change commits and preservation of preexisting dirty edits as separate history.

These systems use reversible edits and explicit controls, not a promise that an agent never makes mistakes. ZuvCode uses a small content-addressed file history with Node standard-library filesystem/crypto APIs because its projects need not have Git. It does not modify the user's Git index, create commits or use destructive Git resets. No upstream code was copied or dependency migration performed.

## Implemented Controls

1. Durable before/after file versions, shared by ordinary chat and all team workers.
2. Before/after command snapshots, with missing-file recovery after settlement, even on failure, timeout or cooperative cancellation.
3. No blanket rollback or deleting newly generated files on task failure.
4. Pre-spawn rejection of obvious cleanup/deletion and broad process termination in every mode.
5. Persistent history and additive user-invoked recovery through the existing `/changes` command.
6. Corrective argument/edit errors no longer poison completion; executed check failures and permission/peer gates remain enforced and are identified explicitly.

See [security.md](security.md#file-history-and-cleanup-guard) for exact coverage and residual risks. Arbitrary command execution is not OS-isolated, and model output quality still requires project-specific verification.
