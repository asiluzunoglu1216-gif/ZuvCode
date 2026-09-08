# Development

`pnpm test:terminal` runs the real CLI in a native pseudoterminal at 100x36 and 42x26. It verifies model discovery/selection, immediate input, repeated chat, Markdown bold terminal cells, all three permission modes, HTML edits, command approval, ordinary-chat isolation, live team objections and revisions, unanimous agreement before tasks exist, peer questions, automatic roles, team model menus, persisted conversation/results, the deduplicated slash filter, cancellation and exit. The fixture uses an isolated temporary project and local HTTP server. Screen captures are written under `.tmp-terminal-captures/`.

The test suite includes provider wire-contract checks (including Gemini signatures and Ollama tool results), JSON compatibility mode, real file changes, permission persistence and switching, Smart command classification, Full Access outside-project paths, Markdown wrapping/control-character handling, path protections, stale-write rejection, web parsing/address restrictions, shell timeout/cancellation, and activity/approval UI tests. Windows native terminal and child-process tests need an environment that allows ConPTY and process spawning. A sandbox `spawn EPERM` is an environment restriction, not a passing test.

Terminal prompts share a session-owned raw input mode through `withTerminalSession`. Avoid giving individual prompts the real stdin directly: on Windows, closing a loading prompt can otherwise leave the next editor unable to receive keys until Enter is pressed.

`tests/team-flow.test.ts` verifies real worker file/command execution against an isolated mock HTTP provider, separate conversation contexts, prerequisite handoffs, per-agent models, permission denial, rejected completion claims, cancellation, retry, persistence, provider compatibility and cross-runtime execution locking. Discussion checks include dynamic frontend/backend/UI-UX roles, independent votes, objection/revision cycles, refusal after three failed rounds, keeping dissenters, peer questions that block writes, objections surviving restart, ordinary-chat isolation and task fingerprint checks. These fixtures test protocol and runtime behavior without calling a user's paid provider. They are not a guarantee of any particular model's code quality.

`vitest.config.mjs` limits discovery to `tests/**/*.test.ts`; generated test projects under `.tmp-tests` must never be collected as repository test suites. The legacy TypeScript REST API integration test has a longer timeout because it compiles a generated project.

The message-length/step-budget regression checks cover 8,000-character peer messages, malformed and over-limit arguments corrected in-place, no peer-question slot consumed by invalid arguments, continuation beyond 40 model turns, budget persistence and explicit resume with preserved files. Context checkpoint tests cover complete batch boundaries, user-constraint retention, Gemini metadata and real large-HTML read/edit calls through the HTTP fixture. Report tests distinguish a finished component from a complete team run. The native terminal script also exercises Work budget, Custom 2, an incomplete run, Extended 300 and `/team resume` at both widths.

File-history regressions cover the reported Node cleanup, broad Chrome termination guards, deletion inside an indirect script, nonzero exits, timeout/cancellation, preservation of modified/new files, persistent recovery export, link/traversal/corrupt-blob rejection, backup limits and credential-store exclusions. Team tests reproduce malformed calls followed by valid work and a peer handoff while retaining real test-failure gates. The native terminal script covers `/changes history` and additive checkpoint recovery at both widths. Research and the diagnosed incident are recorded in [agent-file-safety.md](agent-file-safety.md).

The repository uses:

- TypeScript
- Node.js 22+
- pnpm workspaces
- ESM
- strict TypeScript
- SQLite through Node's `node:sqlite`
- Vitest

Core commands:

```bash
pnpm install
pnpm build
pnpm test
pnpm dev -- --help
```

Optional local development handoff notes live in `.zuvcode-dev/` and are not published. Distribution checks and the automatic main-branch release workflow are described in [releases.md](releases.md).
