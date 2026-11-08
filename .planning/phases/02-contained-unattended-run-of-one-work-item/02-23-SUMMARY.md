---
phase: 02-contained-unattended-run-of-one-work-item
plan: 23
subsystem: documentation
tags: [docs-system, documentation-pass, grounding, fresh-review, coverage, findings, unknowns]
status: complete

requires:
  - phase: 02-contained-unattended-run-of-one-work-item
    provides: "02-01 to 02-22: the built run slice, the shell, the live suite and the exit run that the pass documents"
provides:
  - "docs/system/runs.md, checks-and-evidence.md and interactive-shell.md: three new documents written from the code, each in both README tables and in coverage.md"
  - "cli-reference, config-reference, containment, data-model, integrations, overview, processes and history regrounded for the run slice; onboarding.md and README.md edited; three run flow diagrams (run-to-ready, run-resume-after-kill, run-discard-retry) with their diagram index rows"
  - "coverage.md recounted at 6b82da2 with the run lifecycle rows; findings.md and unknowns.md extended; 02-23-doc-worklist.md, 02-23-grounding/ packages and 02-23-reviews/ reports with answers"
affects: []

actuals:
  tokens: 133000
  tasks: 7
  commits: 4
plan_head_before: 72a86b16744dd24e1cd04457c9534eb478c92f93
plan_head_after: d40beb1b6753d045b4952edacedff1bff475db22
commits: 4

tech-stack:
  added: []
  patterns:
    - "One grounder per document and a fresh reviewer per document; the tracer document (runs.md) was grounded, landed and reviewed before the fan-out, and its review produced eleven amendments that every other grounder received"
    - "Every review report is bound to a committed digest in its first line; fixes are applied or answered under an Answers heading, and coverage.md marks a document reviewed only after that"

key-files:
  created:
    - docs/system/runs.md
    - docs/system/checks-and-evidence.md
    - docs/system/interactive-shell.md
    - docs/system/diagrams/run-to-ready.puml
    - docs/system/diagrams/run-resume-after-kill.puml
    - docs/system/diagrams/run-discard-retry.puml
    - .planning/phases/02-contained-unattended-run-of-one-work-item/02-23-doc-worklist.md
  modified:
    - docs/system/README.md
    - docs/system/overview.md
    - docs/system/cli-reference.md
    - docs/system/config-reference.md
    - docs/system/onboarding.md
    - docs/system/containment.md
    - docs/system/data-model.md
    - docs/system/integrations.md
    - docs/system/processes.md
    - docs/system/history.md
    - docs/system/coverage.md
    - docs/system/findings.md
    - docs/system/unknowns.md

key-decisions:
  - "runs.md was not re-grounded after its review: no BLOCKER, the draft was not wrong-shaped, so the executor applied the seven WARNINGs and the cheap OBS and answered the rest"
  - "The hook-rule denominator is a reproducible command now (33 distinct rule IDs); the old 5 allow and 21 deny count could not be reproduced and was replaced"
  - "The event-kind denominator is 28, not the 26 the plan-base worklist counted: the first pattern skipped names with an underscore"
  - "The fourteen reviewed documents other than runs.md were fixed from their reviewers' code evidence in one pass and not sent to a second review, because no fix changed what was reviewed (no whole owned surface was missing or wrong)"

metrics:
  duration: "one long session across seven tasks and three orchestrator dispatches"
  completed: 2026-11-06

requirements-completed: []

coverage:
  - id: D1
    description: "docs/system documents every new or changed command, flag, config key, table, event, integration and subsystem of the run slice against the code, with runs.md, checks-and-evidence.md and interactive-shell.md as new documents"
    requirement: "ROADMAP Phase 2 success criterion 8"
    verification:
      - kind: other
        ref: "Task 5 and Task 7 gates: dispatch landing, prose, link and diagram checks; coverage recount; node scripts/check-boundaries.ts; npx tsc -p .; node --test test/unit (1236 pass, 0 fail)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every new or changed document except coverage.md had a fresh technical-writer:prose-reviewer that did not write it, bound to the reviewed digest, with every BLOCKER and WARNING applied or answered, before coverage.md marks it reviewed"
    requirement: "ROADMAP Phase 2 success criterion 8"
    verification:
      - kind: other
        ref: "02-23-reviews/<stem>.md, 15 reports; Task 7 verify: no drafted line in docs/system, a report and a reviewed coverage row for every ground, minor and notes document"
        status: pass
    human_judgment: false
  - id: D3
    description: "The pass changed no code and no proposal document: every (02-23) commit and the diff from the plan base list only docs/system and the phase directory"
    requirement: "plan prohibitions"
    verification:
      - kind: other
        ref: "git log --name-only --grep='(02-23)' and git diff --name-only 72a86b1..HEAD against the allowlist; git status over src, bin, test, scripts, package.json and docs outside docs/system is empty"
        status: pass
    human_judgment: false
---

# Phase 2 Plan 23: The documentation pass Summary

docs/system now describes the unattended run, its checks and evidence, and the interactive shell, with three new documents, eight regrounded ones, five diagrams in the index and a recounted ledger, every changed document reviewed by a fresh reader.

## Performance

- Seven tasks. Tasks 1, 3, 5 and 7 ran in this executor; Tasks 2, 4 and 6 were orchestrator dispatches (one grounder, one reviewer plus ten grounders, fourteen reviewers).
- Commits: 6f825ce (worklist), 0632fd4 (tracer landing), 6b82da2 (landing of all packages), d40beb1 (review fixes, reviewed status, recount).

## Accomplishments

- **New documents.** runs.md (start and its ten refusals, the brief format, the contract, the supervisor and lease, the three stages, discard and the one retry, the hand-off, decisions, resume, status), checks-and-evidence.md (install, validation, baseline, required checks, inventory, evidence, gates G2 and G4) and interactive-shell.md.
- **Regrounded documents.** cli-reference (ten commands and the shell dispatch), config-reference (run environment, routine preset, conventions readers, run limits), containment (run purpose scope, read-before-edit, loop limits, the proxy, git safety, 33 hook rule IDs), data-model (migration 0002, 23 tables, 28 event kinds), integrations (run ports, proxy, registry, supervisor), overview, processes (three run flows with diagrams), history. onboarding.md and README.md were edited; indexes-and-context.md is unchanged and keeps its reviewed status.
- **Review results.** Fifteen reports: runs (no BLOCKER, 7 WARNING), readme 0/2/1, overview 0/3/2, cli-reference 1/4/3, config-reference 0/1/1, onboarding 0/1/1, containment 0/6/3, data-model pass, integrations 0/7/4, processes 0/3/4, history 0/4/2, checks-and-evidence 0/3/4, interactive-shell 0/5/6, findings 0/5/3, unknowns 0/1/4. The one BLOCKER was the `inbox` exit codes in cli-reference. The most common WARNINGs were sentence length, wrong or loose `file:line` citations in findings.md, and claims wider than the code (a moved HEAD described as not prevented, the host-error branch, the install-host exit codes).
- **Recounted denominators (at 6b82da2, no code changed after it).** CLI commands 10; `AVARICE_*` names 15 (9 read, 6 constants); other environment variables 10; tables 23 (21 with a writer, 2 without); event kinds 28; migrations 2; onboarding lifecycle 14 and 29; run lifecycle 11 and 37 (7 blocked reasons, 6 step statuses, 6 work item states); ports 11 plus the shared descriptor; external systems 13 (12 used); hook rules 33; source lines 26,150; test files 113; boundary lint 79 files.
- **Findings and unknowns.** findings.md gained a section per document of the run slice, the five proposal documents this branch edited before the documentation rule reached it (containment, contracts-and-state, extensions, ADR-006 and implementation-plan), the three load-sensitive tests, the proposal drift that still holds, and annotations on eight existing lines the code no longer bears out (none deleted). unknowns.md gained each document's undetermined points and a rewritten campaign-wide note.

## Task Commits

1. Task 1: 6f825ce `docs(02-23): worklist for the Phase 2 documentation pass`
2. Task 3: 0632fd4 `docs(02-23): tracer runs.md grounded and landed, awaiting review`
3. Task 5: 6b82da2 `docs(02-23): land the grounded Phase 2 documents, awaiting review`
4. Task 7: d40beb1 `docs(02-23): apply fresh-review fixes, mark reviewed, recount coverage`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan-base event-kind count was wrong**
- **Found during:** Task 5 (the data-model grounder's count)
- **Issue:** The worklist counted 26 event kinds; the pattern skipped names with an underscore.
- **Fix:** Recounted as 28 with `type: '[a-z_]+[.][a-z_.-]+'` and corrected the worklist and coverage.md.
- **Commit:** 6b82da2

**2. [Rule 1 - Bug] The hook-rule denominator could not be reproduced**
- **Found during:** Task 1
- **Issue:** coverage.md's 5 allow and 21 deny named no command that reproduces it.
- **Fix:** The containment grounder defined a command (33 distinct rule IDs); coverage.md records it.
- **Commit:** 6b82da2

**3. [Rule 1 - Bug] The history grounder's commands carried a corrupted word**
- **Found during:** Task 7 (history review)
- **Issue:** The grounder wrote `g''it` to avoid a tool restriction, so four quoted commands did not run.
- **Fix:** Replaced with `git` and pinned the counts to the end commit.
- **Commit:** d40beb1

### Other

- The plan's Task 7 allowed a second review for a document whose fixes need new grounding. None did; integrations.md had its install detail moved to checks-and-evidence.md and processes.md had three diagrams edited, and both were judged fixes to what was reviewed.
- Several landed documents still hold a few sentences over 35 words in reference lists or list items (the hook read rules, exit-code lines, commit lists in history.md). The reviewers treated lists as exempt; they were answered, not split.

## Issues Encountered

- The harness refuses compound `git` commands, computed `sed` arguments and a `git grep` pattern holding `env\[`; every verify chain was run as separate calls.
- Full `npm test` was not run. The unit suite (1236 tests) passes; the three known load-sensitive tests (`test/mutation/fail-closed.test.ts`, `test/integration/claude-host.test.ts` SIGTERM case, `test/fault/killpoints.test.ts`) are recorded in findings.md and were not exercised.

## Known Stubs

None. No document carries the drafted status line, and no document describes a stubbed behavior as built.

## Threat Flags

None. No file outside docs/system and the phase directory changed, and the credential and home-path gates found nothing in docs/system, the grounding packages or the review reports.

## Self-Check: PASSED

- docs/system/runs.md, checks-and-evidence.md, interactive-shell.md and the three diagram sources exist.
- Commits 6f825ce, 0632fd4, 6b82da2 and d40beb1 are ancestors of HEAD.
- Review reports exist for fourteen documents and runs.md, each with the Reviewed and Verdict lines.
