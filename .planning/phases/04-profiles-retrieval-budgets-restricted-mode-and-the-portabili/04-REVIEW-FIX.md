---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
review: 04-REVIEW.md
plan: 04-52
recorded: 2026-11-22T23:19:55.176Z
---

# Phase 04: Code Review Fix Report

Source review: `04-REVIEW.md`. Triage: the owner's decision "Triage + fix security ones", applied by plan 04-52. A warning is fixed when it touches approvals, containment, redaction, profile isolation, credential handling or a fail-open path (spend guards included); the rest carry a recorded disposition. Fixes landed in plans 04-40 to 04-49, 04-51 and 04-55 after the planning base `792536d`. A fixed entry names commits that exist in this repository and the test that failed before the fix.

## Fixed Issues

### CR-01: Attended hook allows any privileged command longer than 65,536 characters, and the parser fails open past its nesting and wrapper limits (part A)

- **Plan:** 04-40
- **Commits:** `07c4cde`, `d7d1f06`, `a28082e`, `423006c`, `4df8903`
- **Test that failed before the fix:** "denies a Bash command of 70,000 characters with privileged:unparseable and names the limit" in `test/integration/hook-privileged.test.ts`; RED record `04-40-red-task1.json` (exit 1): the attended hook printed nothing for a 70,000-character push line.
- **Test that failed before the fix:** "says unparseable, naming the limit, for a push behind 17 wrapper words" in `test/unit/privileged-commands.test.ts`; RED record `04-40-red-task3.json` (exit 1): a push behind 17 wrapper words classified as none.
