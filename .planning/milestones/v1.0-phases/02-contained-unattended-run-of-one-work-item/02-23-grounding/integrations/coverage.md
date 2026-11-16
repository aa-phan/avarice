# Coverage: integrations (HEAD 0632fd4, 2026-11-06)

Files of the packet:

- `src/adapters/exec/allowlist-proxy.ts`: covered
- `src/adapters/exec/sandboxed-executor.ts`: covered (one hunk: passes re-allowed read paths and loopback ports to the profile)
- `src/adapters/exec/seatbelt-profile.ts`: covered
- `src/adapters/git/run-source.ts`: covered
- `src/adapters/git/run-workspace.ts`: covered
- `src/adapters/git/safe-git.ts`: covered
- `src/adapters/git/staging-base.ts`: covered (hunks move file reading and directory creation into shared functions; documented as the read and ensure-directory behavior of the run workspace)
- `src/adapters/git/staging-clone.ts`: covered
- `src/adapters/host-claude/avarice-run-skill.ts`: covered
- `src/adapters/host-claude/claude-host.ts`: covered in part (invoke, run owner hunks, spawn, reap and outcome call read; the descriptor skimmed)
- `src/adapters/host-claude/launch-preflight.ts`: covered
- `src/adapters/host-claude/skill-install.ts`: covered
- `src/app/deps.ts`: covered
- `src/cli/composition.ts`: covered
- `src/ports/agent-host.ts`: covered (diff plus the cited fields)
- `src/ports/command-executor.ts`: covered
- `src/ports/egress-proxy.ts`: covered
- `src/ports/ledger.ts`: covered in part (new method names and count only; row shapes belong to data-model.md)
- `src/ports/run-source.ts`: covered
- `src/ports/run-workspace.ts`: covered

Also read beyond the packet: diffs of env, hook-policy, invocation-files, settings and launch-args under host-claude, the agents-json diff, the outcome diff, `src/cli/spawn-supervisor.ts`, the install-host, start and resume commands, `src/app/checks.ts` (install and sandbox setup), `src/app/check-validation.ts` and the call sites in `src/app/run-stages/prepare.ts`.

Not checked: the hook source, stream-json parser internals, the GSD and graphify adapters beyond constants, the SQLite ledger adapter, test files beyond the egress override search.

Counts:

- Ports: 11 of 12 files in the ports directory (the twelfth is the shared descriptor). Commands: `ls src/ports | wc -l` gives 12; `ls src/ports | grep -v capability | wc -l` gives 11.
- Spawn sites: 9 documented (sandbox-exec, git, claude, node identity check, node hook self-test, node supervisor, pgrep, ps, mount) of the matches of `git grep -nE "spawn|execFile|execSync|fork\(" -- src bin`, classified by reading; GSD and graphify spawn through the executor.
- Admitted host versions: 4 of 4 in the list at `src/adapters/host-claude/launch-preflight.ts:22`.
- Run purpose agents: 4 of 4 at `src/domain/invocation-scope.ts:65`.
- Proxy responses: 5 of 5 (200, 403, 400, 405, 502) in the allowlist proxy.
- New ledger port methods: 32 of 61 (not stated in the document); the diff of the ledger port from the plan base, counting added method lines, and a count of all method lines.
- `gh` unused: `git grep -nE "'gh'|\"gh\"" -- src bin scripts` finds only deny lists and credential directory paths, no spawn.
- Alive proofs: run source `git grep -nE "(deps|d)\.runSource" -- src` (run-start service); fetch `git grep -nE "[.]fetchIntoSource" -- src` (finish stage line 279); commit (item stage line 851); egress `git grep -nE "deps\.egress" -- src`; skill install (install-host command line 41); supervisor spawn (start command line 126, resume command line 97).
- Dormant: the worktree staging adapter (selected only by a constant that is 'clone'); `extraPath` (never passed).
- `findGraphifyBinary` unused in composition: `grep -n findGraphifyBinary src/cli/composition.ts` finds only the import (line 27).
