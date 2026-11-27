---
phase: 01-contained-onboarding-of-one-repository
plan: 10
subsystem: validation
tags: [validation, secrets, path-references, containment, narrowing, project-record, artifact-store, tdd]
status: complete

requires:
  - phase: 01-contained-onboarding-of-one-repository
    provides: "01-05 stage loop, activate and validate stages, fake host; 01-09 mapping:plan, gsd:inspect and gsd:configure steps, effectiveMappingMode"
provides:
  - "validateMapArtifacts(facts, plan, limits): presence, stamp, scope-of-writes, path-references, secrets, size-and-structure, coverage, each stored as step `validate`"
  - "VALIDATION_LIMITS { danglingShare: 0.05, maxBytes: 262144 }, TEMPLATE_HEADINGS (STACK.md, ARCHITECTURE.md), writeSetsFor, AVARICE_WRITE_SET"
  - "GSD_SECRET_REGEX (scan_for_secrets verbatim), AVARICE_SECRET_PATTERNS, findSecrets (kind and line only), redactSecrets ([REDACTED:kind])"
  - "extractPathReferences, danglingShare; matchesGlob/matchesAny (src/domain/glob.ts)"
  - "containment.finding event for writes outside the write sets; secret hit blocks (decision) with no retry; rejection retried once then blocked with the failing check names"
  - "narrowProposals + PROFILE_POLICY: repository proposals only narrow; commands recorded inactive"
  - "Complete project record: gsd {version, runtime, adapter, config, capabilities}, contract {runId, version, digest}, existingState, instructionFiles, findings, policy paths, commands, promotion none"
  - "Artifact kinds map-document and map-snapshot, retention onboarding; LocalArtifactStore verifies an existing blob's digest before a put is a no-op"
affects: [01-11, 01-12, 01-14, 01-15, 01-19]

actuals:
  tokens: 33400
  tasks: 2
  commits: 4
plan_head_before: 802bc7bb419d70a19817f3ecb6e563e690e8f057
plan_head_after: e05c3d289ed89d4c244366207fbcce5de6134870

tech-stack:
  added: []
  patterns:
    - "Validation facts are gathered in the stage through ports (documents, staging.changes, staging.listTracked) and judged by a pure domain function; the verdict carries paths, pattern kinds and line numbers, never document text"
    - "The coverage label and scope are decided by validation and stored in step `validate`; activate reads them (loadAcceptedValidation), so the record cannot claim more than was judged"
    - "Narrowing happens before anything is stored; a rejected proposal value is a finding (clipped), never authority"

key-files:
  created:
    - src/domain/glob.ts
    - src/domain/secret-patterns.ts
    - src/domain/path-references.ts
    - src/domain/policy-narrowing.ts
    - test/unit/validation.test.ts
    - test/unit/record.test.ts
    - test/integration/completeness.test.ts
    - test/integration/validation-failures.test.ts
    - test/integration/no-competing-index.test.ts
  modified:
    - src/domain/validation.ts
    - src/domain/project-record.ts
    - src/app/stages/validate.ts
    - src/app/stages/activate.ts
    - src/app/stages/shared.ts
    - src/adapters/fs/artifact-store.ts
    - test/helpers/fake-agent-host.ts
    - test/helpers/fault-run.ts
    - test/unit/domain-contracts.test.ts
    - test/fault/killpoints.test.ts

key-decisions:
  - "A tracked file may be modified in staging only in .planning/config.json and inside the agent write set of an invocation that ran (so a Refresh can regenerate a committed .planning/codebase map); package.json or any other tracked file fails. Narrower than the plan text only in that one case the plan's own Refresh flow requires"
  - "Path references are extracted narrowly: fenced code and frontmatter skipped; backticked tokens with a slash or known extension; bare tokens only with a slash and a trailing slash or known extension; URLs, globs, MIME types, npm scopes, product names like Node.js ignored. A bare file name resolves against any tracked file's basename"
  - "Fast map record scope lists the four map files, a full map `.`, a skipped map is empty; the scope and completeness come from the validate step"
  - "commands from .avarice/config.json are recorded status inactive; a claim of any other status is rejected as widening; paths.generated and paths.artifacts behave like write (granted only if policy grants)"
  - "Artifact kinds renamed codebase-map -> map-document and snapshot-manifest -> map-snapshot, retention evidence -> onboarding, as the plan names them"
  - "The record's earlier rejected validation attempts become findings (source validation) so a remapped record carries its history"

patterns-established:
  - "Secret findings: pattern kind and line only, in the step result, event and note; matched text is never copied"
  - "Adding an allowed write location: extend writeSetsFor / AVARICE_WRITE_SET, not the stage"

requirements-completed: [ONB-2, ONB-7, ONB-9, ONB-12]

coverage:
  - id: D1
    description: "An artifact set is accepted only when presence, stamp, scope of writes, path references, secrets, and size-and-structure all pass; the seven checks are stored in order as step validate"
    requirement: ONB-7
    verification:
      - kind: unit
        ref: "test/unit/validation.test.ts#accepts a clean, stamped, in-scope, secret-free, well-formed full map with seven passing checks"
        status: pass
      - kind: integration
        ref: "test/integration/completeness.test.ts#stores every check of the accepted attempt as step validate, in order"
        status: pass
    human_judgment: false
  - id: D2
    description: "A staging diff outside the agent and AVARICE write sets, or changing a tracked file other than .planning/config.json, fails validation and emits containment.finding; a config.json change and an untracked .planning/graphs file pass"
    requirement: ONB-12
    verification:
      - kind: unit
        ref: "test/unit/validation.test.ts#scope of writes"
        status: pass
      - kind: integration
        ref: "test/integration/validation-failures.test.ts#scope of writes"
        status: pass
    human_judgment: false
  - id: D3
    description: "A map with more than 5% dangling path references ends validation_failed, remaps once, then blocked (decision); exactly 5% activates (S-36)"
    requirement: ONB-12
    verification:
      - kind: integration
        ref: "test/integration/validation-failures.test.ts#path references (S-36)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A secret in any map document (GitHub token, AWS key, private key header, JWT shape) blocks with a decision and no retry; no artifact row exists and the secret appears in no file under the data root"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/validation-failures.test.ts#secrets (T-01-21)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A fast map activates partial, mode fast, scope the four files, and status prints partial never complete; a full map is complete; a skipped map is none"
    requirement: ONB-7
    verification:
      - kind: integration
        ref: "test/integration/completeness.test.ts#completeness labels (ONB-7, S-33)"
        status: pass
    human_judgment: false
  - id: D6
    description: "A repository .avarice/config.json proposing wider paths.write is rejected and recorded as a finding, a protected addition is accepted, commands stay inactive, unknown keys rejected; an unreadable, non-JSON or oversize config is a finding and does not block"
    requirement: ONB-9
    verification:
      - kind: unit
        ref: "test/unit/record.test.ts#narrowProposals: a proposal can only narrow authority (ONB-9)"
        status: pass
      - kind: integration
        ref: "test/integration/no-competing-index.test.ts#repository proposals only narrow (ONB-9, T-01-22)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Record versions are insert-only: a second activation of the same project creates version 2 and sets superseded_at on version 1 whose body and digest are unchanged; an UPDATE of body_json or digest raises"
    requirement: ONB-9
    verification:
      - kind: integration
        ref: "test/integration/no-competing-index.test.ts#record versions are insert-only (ONB-9, T-01-24)"
        status: pass
    human_judgment: false
  - id: D8
    description: "No table column and no file under the data root outside artifacts/ holds map document text; documents and a path-to-digest manifest are stored as map-document and map-snapshot artifacts with retention onboarding"
    requirement: ONB-2
    verification:
      - kind: integration
        ref: "test/integration/no-competing-index.test.ts#no competing index (ONB-2, S-27)"
        status: pass
    human_judgment: false
  - id: D9
    description: "The artifact store leaves nothing under a digest path or beside it after an interrupted put, fsyncs the temp file and its directory, and replaces a same-size corrupted blob on a repeated put"
    requirement: ONB-2
    verification:
      - kind: unit
        ref: "test/unit/record.test.ts#LocalArtifactStore: durable, content-addressed, idempotent"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-11-02
---

# Phase 01 Plan 10: Full Map Validation and the Complete Project Record Summary

**A map reaches `planning_ready` only when it is stamped, inside the write sets, at most 5% dangling, secret-free and structurally sound; the activated record states exactly what was mapped (fast is `partial` with four files), carries GSD, contract, findings and narrowed policy paths, and AVARICE keeps only digests plus a content-addressed snapshot.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-11-02T22:10:30Z
- **Completed:** 2026-11-02T22:51Z
- **Tasks:** 2 of 2, both TDD (RED then GREEN each; no REFACTOR commit)
- **Files:** 9 created, 10 modified (21 changed in the plan's commits including 2 RED evidence records)

## Accomplishments

- Validation runs seven ordered checks over facts the stage gathers through ports; scope violations emit `containment.finding`, a secret blocks at once with a decision, any other failure is remapped once then blocked naming the failing checks.
- Secrets: GSD's `scan_for_secrets` regex verbatim plus AVARICE's redactor patterns; only pattern kind and line leave the validator, and a blocked onboarding leaves no artifact row and no secret anywhere under the data root.
- The record's coverage scope comes from validation (fast: four files, partial); `status` prints `partial` for fast.
- `narrowProposals` accepts protected additions and refuses anything that widens; the record now carries gsd settings and capabilities, contract reference, existing state, instruction files, findings (earlier rejected validations and rejected proposals) and commands as inactive.
- Artifacts are `map-document` and `map-snapshot` with retention `onboarding`; the store no longer trusts a same-size blob.

## Task Commits

1. **Task 1** (TDD): RED `9fa2524` test(01-10) (56 tests, 8 pass on arrival, 48 fail; `RED_EVIDENCE_OK`, record `01-10-red-evidence-task1.json`); GREEN `bace2c3` feat(01-10) (56 of 56; full suite 437)
2. **Task 2** (TDD): RED `3974cc5` test(01-10) (30 tests, 12 pass on arrival, 18 fail; `RED_EVIDENCE_OK`, record `01-10-red-evidence-task2.json`); GREEN `e05c3d2` feat(01-10) (full suite 467 of 467)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

RED then GREEN in order for both tasks, no REFACTOR. RED used stubs (secret-patterns, path-references, policy-narrowing, builder that ignored new inputs, validation still presence and stamp) so failures are assertions on planned behaviour. Tests green on arrival are guards for behaviour the skeleton already had (exact 5% activation, full map complete, retry-then-activate, S-27 scan, version 2 supersede, UPDATE trigger, interrupted put). Mutation checks, each restored from a copy: `<=` to `<` on the 5% limit, `block: false`, scope check disabled, size cap doubled, URL-userinfo and Authorization pattern narrowed, AWS pattern removed, fence skipping removed, glob `dir/**` loosened, narrowing check bypassed, command status check removed, policy grant forced true, protected union dropped, digest check dropped in the store, narrowing replaced by passthrough, containment event disabled: all killed (a first URL-userinfo mutant renamed only the kind and survived; replaced by a pattern mutant that was killed).

## Decisions Made

See `key-decisions`. Later plans: 01-14 adds intel and knowledge purposes by running `launch:intel` / `launch:knowledge` steps (their write sets then enter `writeSetsFor` automatically) and any new AVARICE-written directory goes in `AVARICE_WRITE_SET`. The record's `artifacts.snapshot` is the manifest digest (the plan's "snapshot" field).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tracked modifications inside the map write set must be allowed**
- **Found during:** Task 1 design (01-09's test "regenerates an existing committed map in staging")
- **Issue:** "modifies any tracked file other than .planning/config.json fails" would reject a Refresh of a committed `.planning/codebase/*.md`, a flow 01-09 supports.
- **Fix:** tracked files may change in `.planning/config.json` and inside an invoked agent write set; `package.json` and the AVARICE-only directories still fail.
- **Files modified:** src/domain/validation.ts
- **Committed in:** bace2c3

**2. [Rule 3 - Blocking] Existing fixtures and tests assumed the old validation**
- Fake host documents had no template headings, so every STACK.md/ARCHITECTURE.md would fail; the helper now writes the template H2s and gained rawFiles, omitHeadings and padBytes (9fa2524). `domain-contracts.test.ts` builds richer facts (9fa2524). `killpoints.test.ts` queried artifact kind `codebase-map` (now `map-document`) and `normalizeRecord` normalizes the contract digest, which embeds per-run IDs (e05c3d2).

**3. [Rule 2 - Missing critical] Artifact put trusted a blob's size**
- **Issue:** a same-size corrupted blob made put a no-op, leaving the snapshot unreadable. **Fix:** put verifies the digest of an existing blob and replaces it atomically otherwise. Tested.

**4. Smaller departures**
- One file not in the plan's list: `src/domain/glob.ts` (write-set matching, shared by validation).
- `activate.ts` and `shared.ts` were edited in Task 1 (record scope from validation; `loadAcceptedValidation`, document `bytes`/`oversize`), earlier than the plan's Task 2 file list.
- The plan lists `snapshot` as a new record field; the record already carries `artifacts.snapshot`, which is kept.

---

**Total deviations:** 3 auto-fixed (1 Rule 1, 1 Rule 2, 1 Rule 3 group) plus the smaller departures. **Impact:** all required for existing flows to keep working; no scope creep.

## Issues Encountered

- Several tool writes were rejected because a file had changed (my own scripted edits); re-reading resolved it.
- A real-use concern, not a failure: the 5% reference limit and the template-heading rule are strict for real mapper output; the extraction is deliberately narrow to limit false positives, and the first real host run (01-15, 01-19) will show whether the heading list needs relaxing.

## Authentication Gates

None.

## Known Stubs

None.

## Threat Flags

None new. T-01-21 (secrets block, nothing stored), T-01-22 (narrowing), T-01-23 (scope detection plus containment.finding), T-01-24 (insert-only versions, immutability trigger, supersede) mitigated and tested. T-01-SC: no installs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `npm test` (467), `npx tsc -p .` and `node scripts/check-boundaries.ts` (34 files) are green.
- 01-11 and 01-15 can rely on `validate` being strict about the staging diff; any file the real host writes outside `.planning/codebase/**` fails scope. Not yet exercised against a real model.
- All checks ran against temp roots and scratch repositories; the user's profile locations and real repositories were not touched.

## Self-Check: PASSED

- Created files present: src/domain/{glob,secret-patterns,path-references,policy-narrowing}.ts, test/unit/{validation,record}.test.ts, test/integration/{completeness,validation-failures,no-competing-index}.test.ts.
- Commits 9fa2524, bace2c3, 3974cc5, e05c3d2 are ancestors of HEAD; `git rev-list --count 802bc7b..HEAD` = 4.
- Acceptance criteria re-run: Task 1 tests 56 pass (needs 12); `grep -c sk_live_ src/domain/secret-patterns.ts` = 1; `grep -c containment.finding src/app/stages/validate.ts` = 2; `grep -c 0.05 src/domain/validation.ts` = 1. Task 2: three test files pass (42); `grep -c widens src/domain/policy-narrowing.ts` = 3; `grep -c superseded_at test/integration/no-competing-index.test.ts` = 5; `grep -c fsync src/adapters/fs/artifact-store.ts` = 6.
- Plan verification re-run: the five named test files green; boundaries ok; `tsc -p .` exit 0; `npm test` 467 of 467.

---
*Phase: 01-contained-onboarding-of-one-repository*
*Completed: 2026-11-02*
