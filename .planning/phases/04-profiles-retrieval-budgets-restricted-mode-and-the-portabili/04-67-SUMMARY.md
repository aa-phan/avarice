---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 67
subsystem: documentation
tags: [docs-system, privileged-approval, containment, classifier, gap-closure, review-group-a]

requires:
  - phase: 04
    provides: "plans 04-56 to 04-66: the approval display rule, the classifier's wider coverage, the whole-name restricted patch, the corrupt-config root denial, the brace-glob refusal reason, the pack item format"
provides:
  - "docs/system documents of review group A written from the code at HEAD (not yet prose-reviewed; plan 04-69 reviews them)"
  - "the per-surface hand-off list for plan 04-68 below"
affects: [04-68, 04-69]

actuals:
  tokens: 16500
  tasks: 2
  commits: 2
plan_head_before: 845cc14e02840ec9f09903f6bc1b84b4dadbeec1
plan_head_after: 90d33c3b4044681bd6e8a3f64e8772ba4f652925

tech-stack:
  added: []
  patterns:
    - "A docs/system document states the residual list of a control from the enforcement map and says where the document is more exact than the code table"

key-files:
  created: []
  modified:
    - docs/system/policy-and-approvals.md
    - docs/system/containment.md
    - docs/system/diagrams/approve-privileged-action.puml
    - docs/system/processes.md
    - docs/system/cli-reference.md
    - docs/system/data-model.md

key-decisions:
  - "The privileged-approval row in policy-and-approvals.md names the unshowable-value refusal as a command no approval can bind, although the code table's text for AVARICE's part names only the gh api body case; the document states the built behavior and the difference goes to findings.md (plan 04-69)"
  - "The bindings-lock staleness rule (04-59 surface 1 and 2) went into data-model.md, a group A document, although the plan's Task 2 text names only policy.denied there; the 04-59 SUMMARY assigned it to this plan or 04-68, and data-model.md is where the lock is described"

requirements-completed: [FR-12, FR-13, SEC-1, SEC-6, CON-4, CON-10, CON-12]

coverage:
  - id: D1
    description: "policy-and-approvals.md states the approval display rule, the unshowable-value refusal in a session, a run and the gate, the classifier's wrappers, launchers, string forms, here-strings, refused positions and the residual list as the enforcement map states it"
    requirement: "FR-12"
    verification:
      - kind: other
        ref: "grep of the task 1 verify command: privileged:unapprovable, brace, alias present; no finding, gap, plan or threat ID in the prose"
        status: pass
    human_judgment: true
    rationale: "Prose accuracy against the code needs the fresh prose review plan 04-69 assigns; no test asserts documentation text"
  - id: D2
    description: "containment.md describes the privileged row, rules, events and command-classification limit, the whole-name restricted patch, the whole-root denial of a corrupt config and the brace-glob refusal reason"
    requirement: "SEC-6"
    verification:
      - kind: other
        ref: "grep of the task 2 verify command: brace present in containment.md; no finding, gap, plan or threat ID in the prose"
        status: pass
    human_judgment: true
    rationale: "Prose accuracy against the code needs the fresh prose review plan 04-69 assigns"
  - id: D3
    description: "cli-reference.md shows approve printing the whole summary and the context item format field; data-model.md carries the policy.denied variants and the bindings lock rule; the approval diagram and the approve flow show the unshowable-value refusal"
    requirement: "CON-12"
    verification:
      - kind: other
        ref: "grep of the task 2 verify command: policy.denied in data-model.md; no finding, gap, plan or threat ID in the prose"
        status: pass
    human_judgment: true
    rationale: "Prose accuracy against the code needs the fresh prose review plan 04-69 assigns"

duration: 35min
completed: 2026-11-25
status: complete
---

# Phase 04 Plan 67: Review group A documentation Summary

**The approval gate, the classifier's coverage and residual list, containment's restricted patch, corrupt-config root denial and brace-glob reason, the approve and context commands and the policy.denied variants are written into docs/system from the code at HEAD.**

## Performance

- **Duration:** about 35 min
- **Completed:** 2026-11-25T08:54:03Z
- **Tasks:** 2
- **Files modified:** 6 (all under docs/system)

## Accomplishments

- policy-and-approvals.md: the classifier now lists the wrappers it follows (adds doas, taskset, arch, caffeinate, unbuffer, chronic, coproc), the launchers it reads apart (find -exec and kin, parallel, watch), the string forms (su -c, trap, here-strings into a shell), gh options before the subcommand and the single count of a here-document substitution. The refusal cases for an unreadable line now include a same-line git alias or config include and a brace expansion or glob in a command position. The residual list and the privileged-approval and profile-isolation rows follow the code.
- containment.md: the privileged row, the rule paragraph, the events paragraph and the command-classification limit describe the unshowable-value refusal and the new refusal cases. The restricted-run paragraph says an out-of-scope path of any name is left out literally and the in-scope edits stay. The root list says a corrupt config has its whole profile root denied, and the limits list says what stays open. Broad discovery gives the brace-glob refusal reason.
- The approval diagram and the approve flow in processes.md show the run denial with no request and the attended unapprovable case for an unshowable value, and the approve command shows the whole summary.
- cli-reference.md: the approve params line is the whole summary, and the context JSON item has the `format` field. data-model.md: policy.denied for an unshowable command, and the bindings lock holds the time it was written and is taken over under the three rules and the 60-second fallback.

## Task Commits

1. **Task 1: the privileged-command gate as built** - `424ab25` (docs). The commit also holds containment.md's Task 2 edits (restricted patch, root list, broad discovery), because they are in the same file and were written in one pass.
2. **Task 2: group A's other surfaces** - `90d33c3` (docs): cli-reference.md and data-model.md.

**Plan metadata:** the docs commit that follows this summary.

## Files Created/Modified

- `docs/system/policy-and-approvals.md` - classifier coverage, refusal cases, residual list, enforcement-map rows
- `docs/system/containment.md` - privileged row, rules, events, limits, restricted patch, root list, broad discovery
- `docs/system/diagrams/approve-privileged-action.puml` - run branch and attended branch for an unshowable value
- `docs/system/processes.md` - approve flow steps 2, 3 and 4
- `docs/system/cli-reference.md` - approve params line and description; context item `format`
- `docs/system/data-model.md` - bindings lock row of the config home; policy.denied row

## Decisions Made

See key-decisions. Nothing outside docs/system changed, and no proposal document was edited.

## Hand-off for plan 04-68 and 04-69

**Documents changed, with sections:**

| Document | Sections changed |
|---|---|
| policy-and-approvals.md | Parameters and digest (already by 04-56, checked against the code, unchanged by this plan); Privileged commands in the hook: What the classifier reads, Three outcomes, What the classifier cannot see; Enforcement map rows `privileged-approval` and `profile-isolation` and the note after the table |
| containment.md | Containment layers table (Privileged commands row); Restricted mode (what a restricted run does); The default AVARICE parents; the privileged rule-name paragraph; Events the hook records; Broad discovery; Limits of containment (Another profile's roots, Command classification) |
| diagrams/approve-privileged-action.puml | the run branch and the attended unapprovable branch |
| processes.md | Approve a privileged action, steps 2, 3 and 4 |
| cli-reference.md | approve (description and output paragraph); context JSON field table, `items` row |
| data-model.md | Profile roots table, config home row; the `policy.denied` event row |

**Group A documents left unchanged:** none of the six; every one changed. The group A documents the plan names that were checked and needed nothing more: none.

**Surfaces of plans 04-56 to 04-66 belonging to group A, and where each went:**

| Plan | Surface | Handled |
|---|---|---|
| 04-56 | whole summary, no ellipsis; unshowable conditions and caps; attended refusal; run mode; the gate | policy-and-approvals.md Parameters and digest, Privileged commands (already written by 04-56, verified against `approval.ts`, `authorize.ts` and `pre-tool-use.ts`); containment.md table row, rule paragraph, events; data-model.md `policy.denied`; processes.md and the diagram; cli-reference.md approve |
| 04-57 | gh options between group and subcommand; same-line alias or config include; one count per here-document substitution | policy-and-approvals.md What the classifier reads and Three outcomes |
| 04-58 | restricted patch leaves out any name, keeps in-scope edits | containment.md Restricted mode. **For 04-68:** runs.md (restricted runs, the patch paragraph) and the `RunWorkspace` port document's `excludePaths` option belong to group B and are not touched here |
| 04-59 | lock staleness; 60-second fallback; corrupt config whole root denied; race-test notes | data-model.md config home row (lock); containment.md default parents paragraph and Limits (root denial). The race-test notes need no document: no docs/system document describes that test |
| 04-60 | brace-glob refusal reason; pack item `format`; `format` cache miss | containment.md Broad discovery; cli-reference.md `items` row. **For 04-68:** cli-reference.md has no reuse report, so the `format` miss and its order (revocation, profile, access scope, format, revision) belong to indexes-and-context.md, Reuse and access, which lists only four conditions and says the item carries `profile` and `accessScope`. The stored pack for a run step carries `format` too; runs.md or data-model.md could name it if they describe the pack's item fields (data-model.md does not name `accessScope` today, so it was left alone) |
| 04-61 | harness exports, record kinds, briefFor text, spend rule | no group A document; goes to findings.md and the evaluation text (04-69, 04-68) |
| 04-62 | refused brace and glob positions; what counts as an expansion word; unchanged answers; glob residual; over-refusal | policy-and-approvals.md Three outcomes and What the classifier cannot see; containment.md table row and Limits |
| 04-63 | wrappers, launchers, string forms, here-strings; refusals added; residual list | policy-and-approvals.md What the classifier reads, Three outcomes, What the classifier cannot see, enforcement-map row; containment.md Limits |
| 04-64 | none (no documentation surfaces section) | no change |
| 04-65 | findings.md lines, README proposal table, evaluation figures | no group A document; 04-68 and 04-69 |
| 04-66 | no supported-Node statement changes; suite count to compare in coverage.md | no group A document; 04-68 and 04-69 |

**Findings for plan 04-69 (findings.md):**

- `src/domain/enforcement-map.ts:95` against `src/hook/pre-tool-use.ts:458` and `src/domain/approval.ts:100`: the `privileged-approval` row's AVARICE's part names only a `gh api` body read from a file or standard input as a command no approval can bind, while the hook also refuses a command whose bound values cannot be shown whole. policy-and-approvals.md states both; the owner decides whether the code table's text moves. The document's enforcement-map paragraph already points to findings.md for this.
- policy-and-approvals.md still says the `profile-isolation` code text is older (an existing finding at findings.md line 264); it now also covers a corrupt config's whole-root denial.
- The `restricted-mode` row of the enforcement map and `docs/system/runs.md` were not read for this plan.

**Not verified here:** the over-refusal cases the document states (an assignment word holding `?` or `*`, `find {src,test}`) come from the 04-62 and 04-63 SUMMARY text and the code comments in `src/domain/privileged-commands.ts`; they were not run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Documented the bindings-lock staleness rule in data-model.md**
- **Found during:** Task 2
- **Issue:** The 04-59 SUMMARY lists the lock rule as a surface for this plan, and data-model.md line 13 described the lock as holding the writer's process start time, which is no longer true (it holds the time the lock was written). The plan's Task 2 text named only `policy.denied` for data-model.md.
- **Fix:** Rewrote the config home row of the profile roots table from `profile-bindings.ts`.
- **Files modified:** docs/system/data-model.md
- **Commit:** `90d33c3`

**2. [Process] Task 1's commit holds containment.md's Task 2 edits**
- Both tasks edit containment.md; the file was committed once, with Task 1. Task 2's commit holds cli-reference.md and data-model.md.

**Total deviations:** 1 auto-fixed (1 missing critical), 1 process note.
**Impact on plan:** None on content. The task boundaries in the history differ slightly from the plan's.

## Issues Encountered

None. The harness refused git commands combined with other commands and a `grep` that named the word for a shell alias; the checks were run as separate calls and the plan's `grep` verify command was run in its parts. The `docs/` diff against `ed9e123` shows only docs/system/policy-and-approvals.md, docs/decisions/ADR-017-ac8-brief-coverage.md and docs/operations-and-testing.md (the last two from plan 04-65), as the plan's verification expects. The `git diff --quiet` acceptance check on the four proposal documents was run as a file listing instead: none of docs/containment.md, docs/requirements.md, docs/enterprise-adaptation.md or docs/repository-onboarding.md appears in the diff.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 04-68 writes group B and the worklist from the hand-off above; plan 04-69 updates findings.md, both README tables and coverage.md and has every changed document, group A included, reviewed by a fresh prose reviewer. Until then the six documents above are drafted, not reviewed.

## Self-Check: PASSED

- docs/system/policy-and-approvals.md, containment.md, processes.md, cli-reference.md, data-model.md and diagrams/approve-privileged-action.puml exist and carry the edits above.
- Commits `424ab25` and `90d33c3` are on the branch.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-25*
