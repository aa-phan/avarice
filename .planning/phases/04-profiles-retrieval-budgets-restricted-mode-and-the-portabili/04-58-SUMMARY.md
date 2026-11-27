---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 58
subsystem: restricted-mode
tags: [restricted, patch, git-pathspec, literal, gap-closure, G-04-2-GWR-04, CON-4]

requires:
  - phase: 04
    provides: "the restricted stage and its scope judgment (plans 04-23, 04-44), the CloneRunWorkspace patch()"
provides:
  - "patch() option `excludePaths`: clone-relative files left out of the patch literally, beside `exclude` (directories, strict check unchanged)"
  - "the restricted stage passes RESTRICTED_DIR as `exclude` and the out-of-scope paths as `excludePaths`, so an out-of-scope file of any name no longer drops the whole patch"
affects: [04-67, 04-68]

actuals:
  tokens: 2900
  tasks: 2
  commits: 2
plan_head_before: d56910cd70a863c78047e1abee99ed274e01c57d
plan_head_after: 24b2cf76c963432440afeeee8a2e7b4be9fa8f6a

tech-stack:
  added: []
  patterns:
    - "a file the host named is excluded with the `:(exclude,literal)` pathspec after `--`, never through the directory pattern and never through the global literal-pathspecs mode (which would turn the `:(exclude)` magic into a file name)"

key-files:
  created:
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-58-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-58-red-task2.json
  modified:
    - src/ports/run-workspace.ts
    - src/adapters/git/run-workspace.ts
    - src/app/run-stages/restricted.ts
    - test/integration/restricted-mode.test.ts
    - test/integration/run-workspace.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/deferred-items.md

key-decisions:
  - "excludePaths is a separate option, not a loosened `exclude`: the directory check stays strict, and a file entry is refused only when it is empty, absolute, holds NUL or has a `..` segment"
  - "The literal form is the per-pathspec `:(exclude,literal)` magic; the global literal-pathspecs mode is not used for this call"
  - "A patch that cannot be built for another reason still drops the whole patch with the existing problem text"

patterns-established:
  - "Names the untrusted host chooses reach git as one argv word after `--` behind `literal` magic, and what is validated is only what could name a place outside the clone"

requirements-completed: [CON-4]

coverage:
  - id: D1
    description: "A restricted run that edits an in-scope file and writes an out-of-scope `a b.txt` stores a patch with the in-scope hunk and no hunk for `a b.txt`, names `a b.txt` in the block text, and records no 'patch could not be built' problem"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/restricted-mode.test.ts#stores a patch with the in-scope hunk and no hunk for `a b.txt`, names the file in the block text and records no patch problem"
        status: pass
    human_judgment: false
  - id: D2
    description: "Out-of-scope names with a space, @, +, a non-ASCII letter, parentheses, brackets, a leading dash and a star are each excluded literally; excluding `*.md` or `[x].md` leaves the hunk of `keep.md` and `x.md` in the patch"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#leaves each of the odd file names out and keeps the in-scope hunk"
        status: pass
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#reads `*.md` as a file name and not as a glob: another .md file keeps its hunk"
        status: pass
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#reads a `[x].md` entry as a file name and not as a character class: `x.md` keeps its hunk"
        status: pass
    human_judgment: false
  - id: D3
    description: "patch() refuses an excludePaths entry that is empty, absolute, holds NUL or has a `..` segment with kind invalid (field excludePaths) and still refuses a bad `exclude` directory; with no excludePaths the output equals the plain git diff"
    requirement: "CON-4"
    verification:
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#refuses an entry that is empty, absolute, holds NUL or has a `..` segment with kind invalid, naming excludePaths, and still refuses a bad exclude directory"
        status: pass
      - kind: integration
        ref: "test/integration/run-workspace.test.ts#gives the same output with no excludePaths, an empty list, and the plain git diff of a modified tracked file"
        status: pass
    human_judgment: false

duration: 14min
completed: 2026-11-24
status: complete
---

# Phase 4 Plan 58: Restricted patch keeps in-scope edits Summary

**A restricted run's patch now leaves out-of-scope files out by literal pathspec (`:(exclude,literal)`), so one oddly named out-of-scope file (space, `@`, `+`, non-ASCII, brackets, leading `-`, `*`) no longer makes the whole patch refused and the owner lose the in-scope edits (GWR-04).**

## Performance

- **Duration:** 14 min
- **Completed:** 2026-11-24T21:06:31Z
- **Tasks:** 2
- **Files modified:** 6 source and test files, plus two RED records and the deferred-items list

## Accomplishments

- `patch()` takes an optional `excludePaths`. Each entry is checked (non-empty, relative, no NUL, no `..` segment) and appended as `:(exclude,literal)<path>` after the directory exclusions and after `--`. The `exclude` directory check is untouched.
- The restricted stage passes `exclude: [RESTRICTED_DIR]` and `excludePaths: outOfScope`. The block text and the `containment.finding` event still name the out-of-scope paths.
- Tracer test through the real CLI: the fake host edits `src/slug.ts` and writes `a b.txt`; the stored patch holds only the `src/slug.ts` hunk, the block text names `a b.txt`, and no patch problem is recorded.
- Adapter tests prove each odd name is excluded and that the unfiltered patch does hold every one of them, so the result is the exclusion and not an unreadable name. The star and bracket cases keep the hunk of a file a glob would have matched.

## Task Commits

1. **Task 1: Tracer, a restricted run keeps its in-scope patch beside an out-of-scope `a b.txt`** - `7842114` (fix)
2. **Task 2: Names that need the literal form, and the refused paths** - `24b2cf7` (test)

**Plan metadata:** the docs commit that follows this summary.

RED records: `04-58-red-task1.json` (the tracer failed with no `restricted-patch` artifact against the old code) and `04-58-red-task2.json` (4 of 6 new adapter cases failed against the adapter as of `d56910c`; the two control cases passed).

## Files Created/Modified

- `src/ports/run-workspace.ts` - `patch` options gain `excludePaths`; contract comment updated
- `src/adapters/git/run-workspace.ts` - `excludePaths` validation and the literal exclude pathspec
- `src/app/run-stages/restricted.ts` - out-of-scope paths passed as `excludePaths`
- `test/integration/restricted-mode.test.ts` - the `a b.txt` tracer
- `test/integration/run-workspace.test.ts` - odd names, literal star and bracket, refused paths, unchanged output

## Decisions Made

- Kept `exclude` strict and added `excludePaths` rather than loosening the directory validator, so a directory entry can still never carry magic.
- Used per-pathspec `literal` magic, not `GIT_LITERAL_PATHSPECS`, because the global mode would read the `:(exclude)` prefix as part of a file name.
- Task 2 needed no adapter change: the Task 1 implementation already satisfied every new case, confirmed by running the new cases against the pre-fix adapter for RED.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The verify command of Task 2 runs three test files in parallel. On this machine `restricted-onboarding.test.ts` ended with a file-level `ENOTEMPTY` in its own temp cleanup in 2 of 2 parallel runs, while all 73 tests pass with `--test-concurrency=1` and in every pair. The file and the failing path are not touched by this plan. Logged in `deferred-items.md` (open, target Phase 5).

## Documentation surfaces

For plans 04-67 and 04-68. Built behavior, from the code:

- An out-of-scope path of any name that git can hold is left out of the restricted patch and named in the block text and in the `containment.finding` event; the in-scope edits are kept. The patch no longer fails whole because of an out-of-scope file name. The name is excluded literally: `*`, `?`, `[`, `:` and a leading `-` are ordinary characters.
- `docs/system/runs.md` (restricted runs, the patch paragraph) and `docs/system/containment.md` (the restricted run paragraph) already describe the patch as leaving out-of-scope paths; neither states the file-name condition, and neither needs a correction. Add one sentence to each that any name is accepted. The "patch that cannot be built" wording stays true for the other causes (git failure, an invalid `excludePaths` entry).
- The `RunWorkspace` port document, where it lists `patch`, gains the `excludePaths` option: clone-relative files, excluded literally; invalid when an entry is empty, absolute, holds NUL or has a `..` segment.
- No `docs/system/` file was edited by this plan: the plan assigns the documents to 04-67 and 04-68, and the existing text was already correct for ordinary names. `coverage.md` and `findings.md` are unchanged.

## Known Stubs

None.

## Threat Flags

None. T-04-153 and T-04-154 are mitigated as planned (literal file exclusions, relative-only, no `..`, no NUL; literal-star test). No package installs.

## Next Phase Readiness

GWR-04 is closed. The documentation plans 04-67 and 04-68 have their surfaces listed above.

## Self-Check: PASSED

- Created files present: both RED records, this summary.
- Commits `7842114` and `24b2cf7` are ancestors of HEAD.
- Verification: `node --test --test-concurrency=1` over the three plan test files 73 of 73; `npm run typecheck` clean; `npm run check:boundaries` ok.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-24*
