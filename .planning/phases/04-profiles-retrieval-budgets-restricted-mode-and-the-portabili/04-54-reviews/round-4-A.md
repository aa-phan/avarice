**Round 4 review, group A (scoped)**

- Group: A (policy-and-approvals, processes, doctor, profiles-and-credentials, findings)
- Round: 4, scoped
- Base: f19ae4e..1987922
- Reviewer: fresh
- Date: 2026-11-23
- Digests as read, all matching the dispatch:
  - docs/system/policy-and-approvals.md a0b051e98259fb011d888485f7dda7093bf2c0b3f568f4ff4c7e4c2befc5b7e1
  - docs/system/processes.md d077412b7e07c90ab09c0deeb2970b909fb4885eec0f74b1c22fde6b0b758ede
  - docs/system/doctor.md cd1cdc2e428c75b0d1e42e6d0ec00e8982347680d8dcd2d54046927c28076ea3
  - docs/system/profiles-and-credentials.md 033642c7cdca121836e3cb5812642d9f89d268841418173758f2a755ecc715c4
  - docs/system/findings.md 4794f93830877af3f07c0c7414d6218932b53842300071861544dfe67b84f756

**Verdict: PASS.** Counts in scope: BLOCKER 0, WARNING 0, NIT 0. Every changed line checked out against the code at HEAD.

## Findings in scope

FINDINGS: none

## What I checked in scope, and found correct

**policy-and-approvals.md, line 44 (slot rule)**
- `policySources` returns `err({kind:'invalid', field:'policy sources'})` when a file is not parsed for its own slot: `src/domain/policy.ts:227-261` (258 for user and repository, 247 for organization).
- The evaluator's `usable()` handling is rank 1 broken (`policy.ts:184-207`) and rank 3/4 absent (`policy.ts:209-212`). So "applies only to sources assembled without the builder" holds.

**policy-and-approvals.md, line 142 (end without start)**
- `src/app/authorize.ts:177-203`: an end with no `startSeq` closes the earliest open start of its action.
- An end with no open start of that action returns a `conflict` error, so "is refused" is correct.

**policy-and-approvals.md, line 173 (test paths)**
- `test/integration/approvals.test.ts` and `restricted-mode.test.ts` exist. The prose now carries no paths.

**policy-and-approvals.md, line 189 (three recording commands)**
- `context`, `evidence` and `pr` call `refuseInsideRun` before the profile resolves and need no terminal. `refuseInsideRun` is at `src/cli/identity.ts:34`.
- `comment.ts` has no such refusal and requires `--print`. It reads read-only and records nothing.
- The prose no longer says "four commands that record". It says "all four" only for the flags and exit codes link, which is accurate.

**processes.md, line 174 (drift anchors)**
- All five anchors exist: `src/hook/pre-tool-use.ts`, `src/domain/privileged-commands.ts`, `src/cli/commands/approve.ts`, `src/adapters/sqlite/approval-rows.ts`, `src/adapters/sqlite/ledger.ts`.
- The hook imports `privileged-commands.ts` and `approval-rows.ts` (`pre-tool-use.ts:25-27`).
- The ledger imports `approval-rows.ts` (`ledger.ts:92`).
- `approve.ts` no longer needs `authorize.ts`.
- The diagram flow (classify, request, approve, consume) matches those modules.

**doctor.md, line 6 (writes)**
- `src/cli/doctor-deps.ts:1-4` and `:36` call `resolveProfile`.
- `src/adapters/fs/profile-paths.ts:126-139` runs `mkdirSync` for config home, data root, work root and profile dir, then `writeFileSync` with `wx` for the config file.
- The ledger is opened with `readOnly: true`, and its write hook throws "doctor does not write" (`doctor-deps.ts:69-75`).
- This matches "writes nothing to the store; only other writes are the profile directories and configuration file ... and the one repair". It is consistent with the unchanged "Reads and writes" section.

**profiles-and-credentials.md, retention row (line 51)**
- `src/domain/redactor.ts:86-94` accepts only `summary` or `full` for `retention.transcripts`.

**profiles-and-credentials.md, line 67 (moved-root denial)**
- `src/app/invocation.ts:130` (onboarding, via `computeInvocationScope`) and `:453` (run, via `computeRunScope`) both pass `deps.profile.otherRoots`.
- `invocation-scope.ts:304` and `:570` put those roots in `denyRead`.
- `otherRoots` comes from `knownProfileRoots` in `composition.ts:312-318`.
- The exit 70 message `cannot read the other profiles of this machine` matches `composition.ts:313`.

**profiles-and-credentials.md, Limits (line 111)**
- `src/adapters/host-claude/transcript-collector.ts:1-3` and `:49-52` redact each complete line.
- `src/domain/secret-patterns.ts:24` and `:54` define and apply `PEM_BLOCK` over whole strings, so the block goes whole, body included.
- Event strings and the listed artifact kinds go through the redactor, as the Boundaries table says.

**findings.md header**
- The added sentence is consistent with the owner exemption. It contains no dash violations.

**Mechanical sweep**
- No em dash, en dash or ` -- ` in any added line.
- No delivery history in the prose of the three living documents.
- Longest added sentence is 34 words (the policy slot sentence, the findings header sentence), within the 35-word cap.
- processes.md still links `approve-privileged-action.puml`, and the file exists.
- All cross-links in the added lines (`cli-reference.md`, `findings.md`, `containment.md`, `profiles-and-credentials.md`) resolve to existing files.

## Observations outside scope (not counted)

1. profiles-and-credentials.md:67 (moved-root denial, unchanged part). The sentence "The denial covers declared checks, validation, the baseline, the dependency install and the host's file tools, with the run's own clone and scratch allowed again" describes run stages. It now follows a subject that includes "an onboarding invocation", so it reads as if onboarding has checks and a baseline. Consider splitting the scope: runs get that list, and onboarding gets the host's file tools only.
2. profiles-and-credentials.md:111 (changed line, arguably in scope). The text says a multi-line secret at the transcript boundary "is matched per line". It does not state the consequence: the header line is replaced and the body lines stay, because the per-line pass leaves no BEGIN for the later whole-string artifact pass to anchor on (`secret-patterns.ts:24`, `transcript-collector.ts:52`). This is accurate and not misleading, so I recorded it as an observation. A clause saying the key body lines remain would make the limit explicit.
3. The untracked file `.planning/phases/04-.../04-54-reviews/round-4-B.md` appeared in the worktree during my run. I did not read or create it.

## Read-only proof

- I modified no repository file. My only write was `/tmp/r4a.diff`, outside the repo.
- `git status --short` at the end shows only untracked `.planning/config.json`, `.planning/milestone.lock` and `round-4-B.md`. There are no modified tracked files.
- I did not open the `04-54-reviews/` directory.
