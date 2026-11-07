# Unknowns

This document lists what the grounding did not determine, and for each entry what was checked before stopping, so the next attempt starts where this one ended. Nothing in the tree rests on these points.

## From cli-reference

- Whether the stage loop always ends in a stop state for `paused`, `stale`, `validation_failed` and `planning_ready`. Checked: the loop and stage table in the onboarding service; not executed end to end.
- The exact budget names and limits the contract compiler accepts. Checked: that the onboarding contract validates them; not enumerated in the CLI reference.
- Whether `--mode fast` differs in exit codes. Checked: mode is stored and validated; not traced further.
- `context` behavior over real index data. Checked: the context service and source port, and the exit-code assertions in the context integration test.
- No CLI command was executed for this document; behavior comes from code at HEAD and the init, preflight, ledger-status, lease and context integration tests.

## From config-reference

- Whether the hook process reads environment variables implicitly through its imports. Checked: no env reference in the hook entry; imports not read line by line.
- The exact derived invocation and subagent totals were not read for this document (see onboarding.md for the derivation).
- Internal timeouts of the sandboxed executor and staging caps were seen but left out as internals.

## From indexes-and-context

- Whether GSD's `graphify query` and `intel query` apply the described edge-trimming order in the installed GSD version. Checked: the adapter comment and the context integration test against a fake graphify; GSD source not read.
- Whether anything rewrites the record's stored graph freshness after a later commit. Checked: context recomputes freshness itself; no rewriter traced.

## From onboarding

- Whether the never-entered states (`planning`, `stale`, `deactivated`) and the edges out of `blocked` and `incompatible` are planned or leftover. Checked: git grep of each state literal outside the lifecycle and status modules.
- Whether the excludedDirectories contract input is meant to be filled later. Checked: git grep across src and test.
- Host reaping on non-macOS platforms. Checked: reaping uses absolute macOS paths for pgrep and ps; not run elsewhere.

## From data-model

- Whether the six schema-only tables are planned for specific later work. Checked: git grep of each name in src; the spec describes them without a schedule.
- Whether backups, per-invocation directories and staging clones are ever cleaned up by an operator procedure. Checked: git grep for deletions in src; no cleanup command among the six CLI commands; no runbook found.
- Hook and CLI write contention beyond the busy timeout. Not tested.

## From integrations

- Whether a `claude` installed through a launcher that needs `node` on PATH passes the readiness probe. Checked: the fixed probe PATH; no real install run.
- Whether any non-macOS run is supported. Checked: mount parsing has a Linux branch, but sandbox-exec is macOS-only.

## From containment

- Whether the three admitted host versions pass the live containment suite now. Checked: the constant and the recorded run files under test/containment; the live suite was not re-run (it needs AVARICE_LIVE=1 and spend).
- Whether the host honors each generated setting on the admitted versions. Host behavior; not determinable from code.
- Hook latency against its 5 second host timeout. No performance test run.

## From runs

- Whether the states `waiting_external`, `awaiting_review`, `failed`, `cancelled`, `closed` and the four unrecorded blocked reasons are meant to be driven by a later feature or are leftovers. Checked: a search of `src/app` and `src/cli` for a transition into each of those states (no match), a search of `src` for the four reason names (only the lifecycle definition and an unrelated freshness enum), and the command list in `src/cli/main.ts` (no command answers a decision).
- Whether containment.md is complete for the run purpose. Checked: the run-owner rule, the scope inputs, the scratch directory creation, the run skill and agents and the canonical clone working directory were read in `src/domain/invocation-scope.ts`, `src/adapters/host-claude/claude-host.ts` and `src/app/invocation.ts`; the hook rule list and the settings generator were not read for this document.
- What the install, check validation, baseline, evidence and gate rules do in detail. Checked: `src/app/checks.ts` lines 325 to 390 (the install summary and the start of the install) and `src/domain/evidence.ts` (the baseline delta); `src/app/check-validation.ts` was not read for this document.
- Whether the behavior holds on a live host. Checked: code only; no run was executed and no test was run.
- Whether the onboarding document's statement that the worktree adapter is dormant still holds for onboarding. Checked: for runs, the run workspace module is separate from the onboarding staging modules, reuses only the clone helper and has no worktree variant; the onboarding side was not re-checked here.

## From checks-and-evidence

- Whether the validation sandbox (no read re-allowance, `src/app/check-validation.ts:90`) denies a check its own clone under the default roots: read the seatbelt profile builder and the executor call; did not execute a validation.
- Whether installers other than npm honour `npm_config_ignore_scripts`, and whether an install argument can override it: checked only the environment set in `src/app/checks.ts:364`; no installer was run.
- Which parts of `src/app/run-stages/item.ts` were not read: covered in part. Read the gate, commit and routing-entry portions (lines 145-195, 236-263, 535-563, 685-871); the launch, prompt, classification internals, discard and retry portions were not read (owned by runs.md).
- `src/adapters/git/run-workspace.ts` is covered in part: read in full, but only the revision, status, snapshot, diff and read behavior is documented; clone, discard, commit and fetch behavior belongs to runs.md.
- Whether the repository ignores the GSD configuration file in a real run, which decides whether baseline rows carry `git:` or `tree:` revisions: not checked at runtime.

## From cli-reference (run slice)

- Whether an exception thrown by a command's usage check or by profile composition (outside the try in `src/cli/main.ts`) ends the process with a code other than 70 (for example Node's own code 1 through the top-level await in `bin/avarice.ts`): checked by reading `src/cli/main.ts` and `bin/avarice.ts` only; no such exception was provoked.
- The exit codes of the interactive shell (the "the shell's" row of the dispatch table): only the usage refusal under `AVARICE_RUN` was read; `src/cli/shell/` is owned by interactive-shell.md and was not read in full.
- Behavior of `src/app/context.ts` and the context adapters: unchanged since the diff base, so the existing `context` section was kept after checking the CLI layer and the budget constants only.
- Whether a second supervisor spawned by `resume` against a just-started run is refused the lease: not read in `acquireRunLease`; no claim made in the document.
- Order in which the ledger returns open decisions (`listDecisions`): not read; the document says "the order the ledger returns them".

## From config-reference (run slice)

- Whether check validation can read its own clone under the default work root: the validation call passes no allow-read paths (`src/app/check-validation.ts:90`) and I did not run it. Checked: the sandbox profile builder and the call sites by reading; not checked: a live run.
- What a run ends in when an artifact file over 2 MiB stops classification: the stage returns an error to the supervisor loop, which releases the lease without a transition (`src/app/run-service.ts`). Not traced further into resume or status rendering.
- Whether the hook's search-loop window (the last 2000 decision events) can hide a long search run: not read beyond the constant and the call.
- Shell source (`src/cli/shell/shell.ts`, `src/cli/render/style.ts`) read only for environment, history and polling constants; the key handling and views were not read. Not covered: the rest of the 537-line shell.

## From containment (run slice)

- Whether a declared check validated under the default roots can read its own validation clone: the code passes read denials without a re-allowance (`src/app/check-validation.ts:90`); no Seatbelt run was made. Checked: the code path and `git log` for that file.
- Whether the package manager's ignore-scripts environment variable outranks a flag in a declared install argv: npm behavior, not in this code. Checked: `src/app/checks.ts:364`.
- Whether the settings keys the host honors (permission rules, sandbox lists) take effect as generated: host behavior, outside this code. Checked: settings generator and preflight.
- Evidence files (`test/containment/*.jsonl`, `LIVE-CASES.md`) were not read, so no runtime claim is made.
- `src/app/stages/validate.ts` (the scope check run before the index steps) was not read; its description is carried from the previous document and `src/app/stages/activate.ts:98`.

## From data-model (run slice)

- Whether the absent decision-answering path, the unused evidence external reference and the unreachable decision states are deliberate staging for later work: checked every INSERT, UPDATE and DELETE statement under src for decisions and evidence (only ledger.ts writes them, with no update); the owner classifies intent.
- Event levels: invocation.finished, invocation.reconciled and the ledger-written kinds were checked for a level argument and have none, so they take the default info; every other kind's level was read at its call site.
- The `containment.finding` check names a run's blocking stage chooses were not enumerated: the name comes from callers of the block function in item.ts, finish.ts and prepare.ts, read only where they write run rows and events. The runs and containment documents own the names.
- src/ports/ledger.ts was read only for the Ledger method list (61 methods), not line by line.

## From history

- The evidence files of the exit run were not opened (brief item 6): the exit-run entries rest on commit subjects of `f759ec8` and `58fd5e9` and the file stat of `92bdf9c` and `52fe97c`.
- Whether the other-profile sandbox finding was recorded as closed by the suite itself was not read. The "inferred" label rests on the subjects of `95b494e`, `059cd3d`, `e1740a6` and `4c4cd49`.
- Commit bodies were not read for the run slice; entries rest on subjects, plus the file stat of `3fb6ae4`, `059cd3d`, `7fe273c`, `52fe97c`, `92bdf9c` and `f742b3e`.

## From integrations (run slice)

- The test-only adapters of the agent host, executor and egress ports come from the previous document plus a search of `test/` for the egress override; the fake host and fake `claude` executable were not re-read at HEAD.
- Whether the hook policy fields of the run purpose (globs, loop limits, denied tools) are enforced as the settings describe was not checked; the hook source is outside this packet and belongs to containment.md.
- Whether `avarice contract amend` and `avarice budget` are planned commands is not determinable from the code (checked the command list in `src/cli/main.ts` and searched `src` for "contract amend").
- Claims in unchanged files (the GSD adapter files, `graphify.ts`, `local-mount.ts`, `sqlite/db.ts`, `stream-json.ts`) were kept from the existing document after spot checks of timeouts and limits by grep; they were not re-read line by line.
- The order in which supervisor steps call the install and validation helpers was read only at the call sites in `src/app/run-stages/prepare.ts`; runs.md owns the sequence.

## From interactive-shell

- Whether a terminal in raw mode delivers Ctrl-C as a key and never as SIGINT in every Node and terminal combination: checked only that the code takes the key path (`src/cli/shell/shell.ts:176`, `:249`) and queues input while an action runs (`:290-:306`); the signal behavior is runtime and was not run. The document states only the queueing and the key path.
- Whether the shell behaves well with `TERM` unset on real terminals: checked the code (`full` is true when `TERM` is not `dumb`, `src/cli/shell/shell.ts:153`); no live terminal run was made.
- Test files (`test/unit/shell.test.ts`, `shell-tty.test.ts`, `shell-supervisor.test.ts`) were listed but not read; no claim rests on them.

## From overview

- Whether `claude` itself, when driven by the contained host, contacts a network service: checked `src/cli/composition.ts` and the sandboxed executor (network denied there), and the footprint test; the host's own network behavior was not read, so the overview says only that AVARICE's own code opens connections in one place.
- Whether `README.md` of `docs/system/` and `coverage.md` carry the new counts (ten commands, eleven ports): not in this packet; routed in seams.md.

## From processes

- The five PlantUML sources were not rendered or syntax-checked. Checked: no render command in package.json or scripts/, and `which plantuml` finds nothing (java exists). Not determined: whether the sources parse.
- The 24-point run fault suite was read, not run. Checked: its list and expected states in test/helpers/fault-run.ts and test/fault/run-killpoints.test.ts. Not determined: that every point passes at this HEAD.
- Onboarding flow steps were rechecked against the diff of shared modules (invocation, budget, hook, host adapter, composition), not re-traced through every onboarding stage file. Checked: those stage files and src/app/resume.ts are absent from the `git diff e725db6..HEAD --stat -- src` listing. Not determined: behavior of unchanged files beyond that.
- Resume of a run with a refusing host was not traced. Checked: run reconcile code only, and no run test was read for it. The hand-off bullet on this describes onboarding and is carried over unchanged.

## Campaign-wide

- What the documentation pass executed: the denominator commands of coverage.md, the import-boundary lint, the prose and link gates over this tree, and the type check and the unit suite named in coverage.md. It executed no live run and no full test run, so every behavior claim rests on code read at the counted commit and on test files read, not run.
- Nothing in this tree was checked against a running host: the admitted host versions, the sandbox profile, the egress proxy and the run flows are described from code, and the diagrams were not rendered (no render step exists in the repository).
