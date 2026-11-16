Reviewed: docs/system/unknowns.md sha256 320063423e2ea6716176f9a2342d8803fa40aa7b0b663de7186905ad65db3a2d at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 1 WARNING and several OBS remain; no BLOCKER. Digest 320063423e2ea6716176f9a2342d8803fa40aa7b0b663de7186905ad65db3a2d

BLOCKED: 1 WARNING and several OBS remain; no BLOCKER. Digest 320063423e2ea6716176f9a2342d8803fa40aa7b0b663de7186905ad65db3a2d
HEAD reviewed: 6b82da29e8f2c8b5324bd4442546c7ececde29ce.

FINDINGS
1. WARNING (high). Section "From interactive-shell": "Test files (test/unit/shell.test.ts, shell-tty.test.ts, shell-supervisor.test.ts)". Only test/unit/shell.test.ts exists in test/unit; the other two are test/integration/shell-tty.test.ts and test/integration/shell-supervisor.test.ts. Fix: give the integration paths.
2. OBS (high). Delivery history in prose: "unchanged since the diff base" (line 67), "(brief item 6)" (line 95), "the previous document" / "the existing document" (lines 84, 101, 104). Fix: state the fact without referring to how the work was delivered.
3. OBS (high). First person in "From config-reference": "and I did not run it". Fix: "it was not run".
4. OBS (medium). Sentences over 35 words in running prose at lines 49, 50, 65, 88, 90, 101, 109, 115, 128 (36 to 52 words; my splitter counts "Checked:" clauses as part of the sentence). Fix: split at the colon or semicolon.
5. OBS (medium). "From runs", first entry: "a search ... for a transition into each of those states (no match)". src/app/run-status.ts:267 reads awaiting_review (a read, not a transition), so the claim holds but "no match" is loose. Fix: "no match that writes the state".

CHECKED, NOT FLAGGED
- Cited lines exist and match: src/app/check-validation.ts:90 (denyReadPaths passed, no allow-read), src/app/checks.ts:364 (npm_config_ignore_scripts), src/app/stages/activate.ts:98 (scope violations), src/cli/shell/shell.ts:153 (TERM dumb), :176 (setRawMode), :249 (key c/d), :290-306 (run() queue). Ranges item.ts 685-871 (871 lines) and checks.ts 325-390 (532 lines) are in bounds.
- Cited files exist: run-workspace.ts, run-service.ts, context.ts, style.ts, invocation-scope.ts, claude-host.ts, invocation.ts, evidence.ts, validate.ts, composition.ts, bin/avarice.ts, prepare.ts, finish.ts, item.ts, fault-run.ts, run-killpoints.test.ts, resume.ts, test/containment/LIVE-CASES.md and *.jsonl.
- "61 methods" of the Ledger interface: 61 method signatures counted from line 547 of src/ports/ledger.ts.
- The twelve cited SHAs in history and processes entries all resolve.
- No em or en dashes; the one double-hyphen is inside a code span. No absolute home paths, secrets, or embedded instructions. Every added entry states what was checked.
- Not flagged: terseness, SHAs as claim evidence, paths in an unknowns list.
- Not verified: the behavioral claims in entries (no live run), and the shell's exit codes.

Status after my run (porcelain): only the two pre-existing untracked files .planning/config.json and .planning/milestone.lock; nothing modified by me.

## Answers

Applied: findings 1 to 3 and OBS 5. OBS 4 (sentence length in the entries): the entries are notes of the form "what was not determined, and what was checked", written as one entry each; they were not split.
