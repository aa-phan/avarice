---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 27
subsystem: cli
tags: [manual-inputs, context-add, evidence-add, pr-record, comment, offline, redaction, task-refs, untrusted, fr-19, fr-18, typescript]
status: complete

requires:
  - phase: 04-16
    provides: "`approve` (the manual equivalent of approvals) and the run refusal pattern (AVARICE_RUN, the run's process tree) that the new commands reuse without the terminal requirement"
  - phase: 04-20
    provides: "task_refs (recordTaskRefs, listTaskRefs) and the resume refresh that the manual references must not disturb"
  - phase: 04-25
    provides: "the COMMANDS list with doctor, and the redaction-suite exit gate re-run here"
provides:
  - "avarice context add --file <f> --source \"<title> rev <n>\" --run <id>: a redacted manual-context artifact and one manual-context/excerpt reference per source (src/app/manual-inputs.ts, src/cli/commands/context.ts)"
  - "The item pack adds the run's manual excerpts after the index items, within the pack budget, cited and untrusted (src/app/run-stages/item.ts)"
  - "avarice evidence add --kind ci|review|manual --file <f> [--ref <url>] --run <id>: one inconclusive, external evidence row on a revision no gate judges, file stored as a redacted manual-evidence artifact (src/cli/commands/evidence.ts)"
  - "avarice pr record <url> --run <id>: a github/pull-request reference <owner>/<repo>#<number> with the URL as scope, no network (src/cli/commands/pr.ts)"
  - "avarice comment --print --run <id>: a comment body built only from ledger rows, nothing written (src/cli/commands/comment.ts)"
  - "status shows manualEvidence in recorded order (appended optional key and one human-view line) (src/app/run-status.ts, src/cli/render/run-view.ts)"
  - "CommandModule readOnly and needsGsd may be functions of the arguments; refuseInsideRun is the run-only refusal (src/cli/args.ts, src/cli/main.ts, src/cli/identity.ts)"
affects: [04-28, 04-37, 04-38]

actuals:
  tokens: 18500
  tasks: 3
  commits: 5
plan_head_before: d4967ae32c95399258ba6dc7715d7ec8affdd2d5
plan_head_after: a9a539c5f7886ede1eade6a564cfc3a9ca661e17
commits: 5

tech-stack:
  added: []
  patterns:
    - "A command with a reading form and a writing form gives readOnly and needsGsd as functions of its arguments, so `context <term>` keeps its read-only, GSD-backed composition and `context add` opens the store for writing with no GSD"
    - "A manual input is written in the order artifact, step, reference, event, so a reference always has its artifact and its step and a pack never reads half of one"
    - "References the owner recorded by hand (manual-context/excerpt, github/pull-request) name no live source: a resume leaves them as recorded, with no warning and no write"
    - "Manual evidence is never a measurement: status inconclusive, independence external, revision `manual:sha256:<hex>`, so every gate and every revision comparison ignores it"

key-files:
  created:
    - src/app/manual-inputs.ts
    - src/cli/commands/evidence.ts
    - src/cli/commands/pr.ts
    - src/cli/commands/comment.ts
    - src/cli/manual-command.ts
    - test/integration/manual-equivalents.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-27-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-27-red-task2.json
  modified:
    - src/app/resume-refs.ts
    - src/app/run-stages/item.ts
    - src/app/run-status.ts
    - src/cli/args.ts
    - src/cli/commands/context.ts
    - src/cli/identity.ts
    - src/cli/main.ts
    - src/cli/render/run-view.ts
    - test/helpers/test-cli.ts

key-decisions:
  - "`context add` is the recording form only when --file, --source or --run is given; `context add user` with none of them is still a search for the term `add user`, so the existing form is unchanged"
  - "A manual excerpt is at most 16000 bytes (one pack is 4000 tokens at characters / 4, so a longer one could never enter a pack); a manual evidence file is at most 2 MiB; both must be non-empty, non-blank and strict UTF-8, because the artifact store redacts text only and a file it cannot decode would be stored unredacted"
  - "Manual evidence is attached to the run's latest attempt; a run with no attempt yet exits 3 (there is nothing to attach it to). The row is `inconclusive`, independence `external`, revision `manual:sha256:<hex of the file>`, clean false, and its name is `<kind>:<file name>`"
  - "A pull request URL must be http(s) with the path /<owner>/<repo>/pull/<number> (optional trailing slash); credentials are refused, the query and fragment are dropped, and the scope is `<scheme>://<host>/<owner>/<repo>/pull/<number>`; the reference ID is `<owner>/<repo>#<number>` as written, so the same owner/repo#number on two hosts is one reference"
  - "The excerpt is found again at pack time through one run step per source (`manual-context:<hash of the source>`) that holds the artifact digest, because the reference's revision is the digest of the file as given and the stored, redacted bytes hash differently"
  - "`comment` refuses without --print (exit 64): it has no way to post, so the flag only states that"
  - "`status` gains an appended optional `manualEvidence` key (frozen-shapes rule): present only when the owner recorded a row, so no existing snapshot changes"

patterns-established:
  - "Skeleton-free RED for a new command: the command is absent, so each case fails on its exit code or its missing row, never on an import"
  - "A test entry seam (AVARICE_TEST_ANCESTRY=none) for a command that fails closed when the process table cannot be read, so it can be proved under the network-denied wrapper"

requirements-completed: [FR-19, FR-18]

coverage:
  - id: D1
    description: "`context add` records a pasted excerpt as one manual-context reference (source as ID, digest of the file as revision, file name as scope) and a redacted manual-context artifact; the run's next pack holds it inside the untrusted fence with its citation, and the pack step lists it as untrusted without any text"
    requirement: FR-19
    verification:
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#tracer: `context add` records a cited excerpt that the run's next pack includes as untrusted data (FR-19, FR-18, T-04-76)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The same file with the same source twice is one reference and one artifact; a run's own process (AVARICE_RUN), a missing flag and an unknown run are refused without a write; `context <term>` for a term starting with add still searches; the stored excerpt holds no corpus secret"
    requirement: FR-19
    verification:
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`context add` of the same file with the same source twice records one reference (adjacency edge, FR-19)"
        status: pass
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`context add` is refused for a run's own processes and for bad input, and records nothing (T-04-74, FR-19)"
        status: pass
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`context add` stores the excerpt redacted (T-04-75)"
        status: pass
    human_judgment: false
  - id: D3
    description: "`evidence add` stores a CI log or review redacted and inserts one inconclusive, external evidence row (source manual, ref) that leaves earlier rows, gate results and the run state unchanged; an empty file and a kind other than ci, review, manual exit 64; a run with no attempt exits 3"
    requirement: FR-19
    verification:
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`evidence add` records a CI log or a review as manual evidence that never satisfies a gate (FR-19, T-04-74, T-04-75)"
        status: pass
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`evidence add` for a run that has no attempt yet exits 3 and records nothing (FR-19)"
        status: pass
    human_judgment: false
  - id: D4
    description: "`pr record` records a github pull-request reference with owner, repository and number verbatim and the URL as scope, offline under the network-denied wrapper; other paths, credentials, other schemes and non-URLs exit 64; a resume neither warns about nor blocks on it. `comment --print` prints a body from ledger rows (run, state, items, passed checks with revisions, open decisions) and writes nothing"
    requirement: FR-19
    verification:
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`pr record` records a pull request opened in the web UI, offline (FR-19, FR-18, Open Question 9)"
        status: pass
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`comment --print` prints a body built only from ledger rows and writes nothing (FR-19)"
        status: pass
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#every manual command is listed by `avarice --help` (FR-19)"
        status: pass
    human_judgment: false
  - id: D5
    description: "status lists a run's manual evidence in the order it was recorded, changes no other key, and the human view shows one line for it; the redaction suite still reports secret patterns found: 0 and the frozen JSON shapes are unchanged"
    requirement: FR-19
    verification:
      - kind: integration
        ref: "test/integration/manual-equivalents.test.ts#`status` lists the manual evidence of a run in the order it was recorded and leaves every other key as it was (FR-19)"
        status: pass
      - kind: integration
        ref: "test/integration/redaction-suite.test.ts#secret patterns found: 0"
        status: pass
      - kind: unit
        ref: "test/unit/json-shapes.test.ts"
        status: pass
    human_judgment: false
---

# Phase 4 Plan 27: Manual equivalents for every integration Summary

**`context add`, `evidence add`, `pr record` and `comment --print` give every integration an offline manual path: excerpts and logs are stored redacted with their provenance, an excerpt enters the next pack as cited untrusted data, a pull request URL becomes a verbatim reference, and none of it can satisfy a gate or be recorded by a run's own process.**

## Performance

- **Duration:** about 55 min
- **Started:** 2026-11-17T10:35Z
- **Completed:** 2026-11-17T11:35Z
- **Tasks:** 3
- **Files:** 17 (8 created, 9 modified)

## Accomplishments

- **Pasted documentation reaches the next pack as data.** `context add` stores the excerpt as a `manual-context` artifact (redacted by the artifact store before it is hashed), records one reference per source, and the item stage adds the run's excerpts after the index items within what is left of the 4000-token budget. Each line is cited by source, file name and the digest of the file, and the prompt fences the whole pack, so an excerpt that says "ignore the rules above" stays a prefixed data line.
- **CI logs and reviews are recorded, never trusted.** `evidence add` inserts an `inconclusive`, `external` row on a `manual:` revision, so no gate and no revision comparison can ever read it as a pass; a second add inserts a second row and leaves the first byte-identical. A run with no attempt yet has nothing to attach it to (exit 3).
- **Pull requests and comments work offline.** `pr record` keeps owner, repository and number as the host wrote them and refuses any other path, credentials and other schemes; `comment --print` builds its body only from ledger rows and opens the store read-only.
- **Status shows what was brought in.** An appended optional `manualEvidence` key lists the rows in the order recorded (the plan's "listed in status" truth had no code behind it, see Deviations).
- **A run's own process cannot record any of it.** The refusal (AVARICE_RUN, or the run's process tree, which fails closed when the process table cannot be read) runs in `usage()` before the profile resolves, so a refusal creates nothing; no terminal is required, so the owner can script a paste.

## Task Commits

1. **Task 1 (tracer): `context add` and the pack** - RED `a02ecd8` (`test`), GREEN `25103dd` (`feat`)
2. **Task 2: `evidence add`, `pr record`, `comment --print`** - RED `ddf0d69` (`test`), GREEN `87fee09` (`feat`)
3. **Task 3: status lists manual evidence in order, gates and redaction suite re-run** - `a9a539c` (`feat`)

## TDD record

- **RED (task 1):** `test/integration/manual-equivalents.test.ts` against the production CLI in a child process and a real killed-then-resumed run. The target (`exits 0, records one reference ...`) failed on `0 !== 1` (no manual-context row): `context add ...` was read as the index search for the term `add` (exit 0, writes nothing). `gsd check tdd-red-evidence` returned `RED_EVIDENCE_OK` (`04-27-red-task1.json`). Semantic assessment: the run started and was killed at the planned point, the resume completed, and the nine other new cases failed on their own planned assertions; no import, syntax or fixture fault.
- **RED (task 2):** the target (`exits 0, stores the log redacted as artifact kind manual-evidence ...`) failed because the CLI answered `unknown command 'evidence'` (and `pr`, `comment`); `RED_EVIDENCE_OK` (`04-27-red-task2.json`). The 12 task-1 cases still passed in the same file.
- **GREEN:** `25103dd` and `87fee09`; the file is 26 of 26 green with the status cases, 30 of 30 with them.
- **REFACTOR:** none. Task 3 is `type="auto"` (no `tdd`): its test and the status change are one commit.

## Verification

- `node --test test/integration/manual-equivalents.test.ts test/integration/redaction-suite.test.ts test/unit/json-shapes.test.ts`: 51 of 51 pass; `secret patterns found: 0 (58 stores scanned ...)`.
- `node --test test/integration/context.test.ts` (existing `context <term>` tests, unchanged): pass.
- `npm run typecheck` and `npm run check:boundaries`: clean.
- `npm run test:unit`: 2688 of 2688 pass.
- Related integration files run and green: run-resume-refs, context-handle-first, context-adapters, run-status, status-queries, run-resume, artifact-redaction, event-redaction, profile-isolation and run-sandbox-other-profiles (the plan 04-22 AC-6 suites), profile-propagation, profile-selection, exit-parity, offline.
- The full `npm test` (about 18 minutes) was not run here; the orchestrator runs it at the end of the wave.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `status` did not list manual evidence at all**
- **Found during:** Task 3
- **Issue:** The plan's truth "Manual evidence rows of a run are listed in status in the order they were recorded" and Task 3 (which names only the test file) assume status already lists them. `finalEvidence` in `src/app/run-status.ts` keeps only `kind: 'check'` rows, so a `ci`, `review` or `manual` row was invisible in `status` and `status --json`.
- **Fix:** an appended optional `manualEvidence` key on `RunStatus` (frozen-shapes rule: present only when a manual row exists) and one human-view line after the measured evidence. Existing keys, key order and snapshots are unchanged (`test/unit/json-shapes.test.ts` and the "every other key as it was" case).
- **Files modified:** src/app/run-status.ts, src/cli/render/run-view.ts
- **Verification:** `status` case in manual-equivalents.test.ts; json-shapes unit test; redaction suite
- **Commit:** a9a539c

**2. [Rule 3 - Blocking issue] The network-denied wrapper denies `ps`, so the process-tree refusal fails closed**
- **Found during:** Task 2
- **Issue:** `pr record` under `sandbox-exec` with the network denied exited 64 ("refused from inside a run's process tree"): the ancestry reader cannot run `ps` there, and an unreadable chain counts as inside a run by design.
- **Fix:** the production behaviour is unchanged (fail closed). The test entry gained a test-only seam, `AVARICE_TEST_ANCESTRY=none`, that passes `main()`'s existing `ancestry` override an empty chain; only the offline `pr record` case sets it. `bin/avarice.ts` never reads it.
- **Files modified:** test/helpers/test-cli.ts, test/integration/manual-equivalents.test.ts
- **Commit:** 87fee09

**3. [Rule 3 - Blocking issue] One command with a reading form and a writing form**
- **Found during:** Task 1
- **Issue:** `context` exports `readOnly = true` and `needsGsd = true` for the whole module, but `context add` writes the ledger and needs no GSD (a missing or incompatible GSD must not stop an offline paste).
- **Fix:** `CommandModule.readOnly` and `needsGsd` may now be functions of the parsed arguments; `main.ts` resolves them; every other module is unchanged.
- **Files modified:** src/cli/args.ts, src/cli/main.ts, src/cli/commands/context.ts
- **Commit:** 25103dd

**4. [Rule 1 - Bug in the plan's reference handling] A resume would have marked hand-recorded references `unavailable`**
- **Found during:** Task 1
- **Issue:** `refreshRunRefs` asks a source for every reference by provider; `manual-context` and `github` have none, so each resume would have warned "could not be refreshed (unavailable)" and rewritten their retrieval time.
- **Fix:** `LEDGER_ONLY_REFS` in manual-inputs.ts lists the two (provider, kind) pairs; the resume keeps them as recorded, with no call, no warning and no write.
- **Files modified:** src/app/resume-refs.ts
- **Commit:** 25103dd

**Total deviations:** 4 auto-fixed (1 missing functionality, 2 blocking, 1 bug). **Impact:** none on the plan's goal; the `status` key is an appended optional field, and the other three are internal seams.

## Decisions needing owner review

The plan left these unspecified and the implementation had to choose; each is policy rather than mechanics.

1. **Size and encoding limits.** An excerpt is at most 16000 bytes, evidence at most 2 MiB, both strict UTF-8, non-empty and not blank. A non-UTF-8 file is refused (exit 64) rather than stored, because the redacting store passes bytes it cannot decode through unredacted. Raise or lower the numbers in `MANUAL_CONTEXT_MAX_BYTES` and `MANUAL_EVIDENCE_MAX_BYTES`.
2. **`inconclusive` for manual evidence.** The row is neither passed nor failed because AVARICE measured nothing; it sits on revision `manual:sha256:<hex>` so no gate (G4 filters evidence by revision) and no `check`-kind reader can see it. FR-10 (Phase 5) decides how review and CI feedback enter a new attempt.
3. **No attempt, no evidence.** A run that has not started an attempt (killed before the first unit) refuses `evidence add` with exit 3 instead of creating an attempt for it.
4. **`recordedBy` is the OS user name, not a verified owner.** Per the plan's flagged assumption these commands need no terminal and do not call `ownsProfile` (which `decide` does), so another local user with access to the profile's files could record a row. The run refusal is the control (T-04-74); say if `ownsProfile` should also gate them.
5. **Pull request identity.** The reference ID is `<owner>/<repo>#<number>` without the host, as the plan specifies, so the same owner/repo#number on two different hosts replaces one reference with the other; a query and a fragment are dropped from the scope; http is accepted as well as https.
6. **The `add` subcommand needs a flag.** `avarice context add` alone, or with extra words and no flags, is still the search for those words (preserves every existing invocation). `avarice context add --file x` without `--source` is a usage error, not a search.

## Known Stubs

None.

## Threat Flags

None. The new surface (four commands that write the ledger and the artifact store from owner-supplied files) is the plan's own threat model (T-04-74, T-04-75, T-04-76); no network endpoint, auth path or schema change was added.

## Documentation surfaces (for plan 04-38)

- `docs/system/cli-reference.md`: four new commands. `context add --file <path> --source "<title> rev <n>" --run <runId>` (usage form selected by any of the three flags; exit 0 recorded or already recorded, 3 unknown run, 64 usage error or a file that is empty, blank, not UTF-8, over 16000 bytes or unreadable, 70 internal). `evidence add --kind ci|review|manual --file <path> [--ref <ref, at most 500 characters>] --run <runId>` (exit 0, 3 unknown run or no attempt yet, 64, 70; file at most 2 MiB). `pr record <url> --run <runId>` (exit 0, 3, 64, 70; no network). `comment --print --run <runId>` (exit 0, 3, 64 without `--print`, 70; read-only store). All four refuse inside a run (AVARICE_RUN or the run's process tree) with exit 64 before the profile resolves, and need no terminal. `status` and `status --json` can show `manualEvidence`; the `--help` command list gains `evidence`, `pr`, `comment`.
- `docs/system/data-model.md`: artifact kinds `manual-context` and `manual-evidence` (both in the redacted text kinds); task reference providers `manual-context` (kind `excerpt`, ID the owner's source text, revision `sha256:<hex of the file>`, scope the file name) and `github` (kind `pull-request`, ID `<owner>/<repo>#<number>`, scope the URL without query and fragment); evidence kinds `ci`, `review`, `manual` rows with environment `{source: manual, ref?, recordedBy, file, fileDigest, size}`, status `inconclusive`, independence `external`, revision `manual:sha256:<hex>`; run steps `manual-context:<16 hex>` (source, file, fileDigest, artifactDigest, size, recordedBy); events `manual.context_recorded`, `manual.pr_recorded`.
- `docs/system/indexes-and-context.md`: the item pack adds manual excerpts after the index items (first fit in reference order within the remaining 4000 tokens, a note for one that does not fit or cannot be read), cited `[manual-context] <source> (<file> at sha256:<hex>, fresh)` and untrusted; the pack step lists them with `untrusted: true` and no text; a resume leaves `manual-context` and `github` references as recorded.
- `docs/system/checks-and-evidence.md`: manual evidence is not a check, never satisfies a gate and is listed apart in status.
- `docs/system/integrations.md` and `docs/system/overview.md` (if they list the manual modes): the five manual equivalents of docs/enterprise-adaptation.md now exist except `avarice export --events`, which this plan did not build.
- `docs/system/coverage.md` and the two `README.md` tables: no new document; update any count of commands, artifact kinds or evidence kinds it records.
- `docs/system/findings.md` candidates: `docs/enterprise-adaptation.md:134-146` lists `avarice export --events --since <date>` as the audit-sink manual mode; no command by that name exists in COMMANDS (not in this plan's scope).

## Issues Encountered

None open. The worktree's tool policy allowed `git` and `node` only as single plain commands, so the multi-step edits were done with the file tools and short scripts.

## Next Phase Readiness

Ready for 04-28.

## Self-Check: PASSED

- Files found: src/app/manual-inputs.ts, src/cli/commands/evidence.ts, src/cli/commands/pr.ts, src/cli/commands/comment.ts, src/cli/manual-command.ts, test/integration/manual-equivalents.test.ts, 04-27-red-task1.json, 04-27-red-task2.json
- Commits found on HEAD: a02ecd8, 25103dd, ddf0d69, 87fee09, a9a539c
- `grep -n "'evidence'" src/cli/main.ts` prints the COMMANDS line, which also holds 'pr' and 'comment'
- Redaction suite: `secret patterns found: 0`
