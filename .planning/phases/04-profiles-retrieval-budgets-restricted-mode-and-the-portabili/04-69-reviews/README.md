# Plan 04-69 documentation review records

Status: round 1 not yet run. The executor of plan 04-69 has no way to start a fresh `technical-writer:prose-reviewer` (no Agent tool, and the `technical-writer:prose-review` skill only instructs the caller to dispatch reviewer agents), so the plan stopped at a checkpoint after Task 1. No document is marked `reviewed` in `docs/system/coverage.md`; the ten documents below are `changed after review` there.

Code under review: `3a6c10c` (the last commit that touched `src`, `scripts`, `bin` or `test`; the last `src` commit is `2bd1e03`). Documents under review: the changes of plans 04-56 to 04-68 to `docs/system/`, as `git diff 96a0718..HEAD -- docs/system` shows for each file. The version to review is the one with the digest below (HEAD `b07b088`).

`findings.md` is a log and is exempt from prose review by the owner's decision of 2026-11-23 (`04-54-reviews/README.md`, decision 2); that exemption is kept. Its changed lines are checked against their `file:line` by the plan's acceptance criteria, not by a prose round.

## Review groups

Groups follow `04-68-doc-worklist.md`. `README.md` changed in Task 1 of this plan (one counterparts row) and joins group B, so that its status is backed by a review.

| Group | Document | sha256 of the version to review in round 1 | Reviewer checks against the code |
|---|---|---|---|
| A | `policy-and-approvals.md` | `aee16bfa541f30941072cdd159c8ab285c1dd0e37a13210c612cc3612a2eeeb3` | the classifier's wrappers, launchers, string forms and residual list; the refusal cases; the unshowable-value conditions and caps (`src/domain/privileged-commands.ts`, `src/domain/approval.ts`, `src/hook/pre-tool-use.ts`, `src/domain/hook-decision.ts`, `src/domain/enforcement-map.ts`) |
| A | `containment.md` | `f482d11fff951cec5e5109c9854f3daefb564e2265d231bbfff7d463b8834caa` | the restricted patch, the corrupt-config whole-root denial, the brace-glob reason, the events the hook records (`src/adapters/fs/profile-registry.ts`, `src/domain/privileged-commands.ts`, `src/hook/pre-tool-use.ts`) |
| A | `diagrams/approve-privileged-action.puml` | `ef09bc83cf5a77b3df4f3826ffb0bcacda6a6767b56ee034011082db19f88a15` | read with `processes.md` |
| A | `processes.md` (approve flow, steps 2 to 4) | `d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51` | the approve steps against the hook and the `approve` command |
| A | `cli-reference.md` (approve, context `items` row) | `a9a8093a44d1f9016ec1faba98e0342edfb878be677b702e462399a084a1f451` | `src/cli/commands/approve.ts`, `src/cli/commands/context.ts`, the item `format` field |
| A | `data-model.md` (config home row, `policy.denied` row) | `25c4fcf61c9cf74cad6a01dd263333b7bddac54fc2316e4727b03b74e4ad7daf` | the event data of `policy.denied` and the bindings lock rules; must say the same as `profiles-and-credentials.md` |
| B | `runs.md` (restricted runs, run end and patch) | `3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879` | the patch's exclusion lists (`excludePaths`), in-scope edits kept |
| B | `profiles-and-credentials.md` | `430857d04a34524798acc573fe9df322dc6e3ed62cafc00651842ecb38e6321d` | the lock's four takeover cases against `lockIsStale`, the 2-second margin and the 60-second fallback (`src/adapters/fs/profile-bindings.ts`); the registry's whole-root denial (`src/adapters/fs/profile-registry.ts`) |
| B | `integrations.md` (`ps` row, Run workspace Patch, failure table) | `eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858` | the lock holder's start read through `ps`; the run workspace `excludePaths` |
| B | `indexes-and-context.md` (Reuse and access) | `56d118c0b317c4416ab4f803dbc3e722400839ef27af5826b57304b99c14ae31` | the order of the five cache misses, the item `format`, when it is raised (`src/app/run-stages/item.ts`, `src/app/context.ts`) |
| B | `README.md` (ADR-017 counterparts row) | `e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53` | the row against `docs/decisions/ADR-017-ac8-brief-coverage.md` and `findings.md` |

Each reviewer should read every sentence that states a limit (2 seconds, 60 seconds, 1 second for `ps`, 1 MiB, 440 characters, 80 characters, 400 characters, 512 characters, 16 prefix words) against the constant in the code.

Round budget: at most three rounds per group, each by a fresh reviewer that has not seen an earlier round. Each report is stored verbatim as `round-<n>-<group>.md`. A group passes when its last round records no BLOCKER and no WARNING. A document is marked `reviewed` in `coverage.md` only after its group passed, naming the round file. An edit after a passing round voids the verdict.

## Review rounds

| Round | Group | Report | Verdict | Found and done |
|---|---|---|---|---|
| 1 | A | `round-1-A.md` (pending) | not run | |
| 1 | B | `round-1-B.md` (pending) | not run | |
