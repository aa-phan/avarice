Reviewed: docs/system/onboarding.md sha256 a4c823f91f051345cd25d479024a83d0df0bf26aaea8ebffc0ec75533355eab8 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 0 BLOCKER, 1 WARNING, 1 OBS (over-35-word sentences remain)

BLOCKED: 0 BLOCKER, 1 WARNING, 1 OBS (over-35-word sentences remain)

Digest reviewed: a4c823f91f051345cd25d479024a83d0df0bf26aaea8ebffc0ec75533355eab8 (matches dispatch). HEAD 6b82da2.

FINDINGS
1. WARNING (high). Sentence cap (35 words, running prose). Sentences over 35 words (bold stripped, split on sentence-final periods):
   - line 7 (38, "The sibling documents own what this one leaves out: ...")
   - line 75 (46, "The existing `.planning/codebase/` map is classified as one of: ...")
   - line 140 (45, "The existing-map answer is always appended ... a headless session cannot answer.")
   - line 205 (46, "The integration test set kills at 17 points: ...")
   - line 218 (38, "If every required file is present, the launch row is marked reconciled, ...")
   - line 230 (44, "A resume costs budget: ...")
   Not flagged: line 195 (111 words), a field list, exempt as a reference list.
   Fix: split each at its colon, semicolon or "because" clause. Line 7 is the edited line (the runs.md clause added); the others pre-date this edit, but the cap binds.
2. OBS (medium). Line 3 "Status: drafted, not yet reviewed." must change to reviewed when this review passes.

VERIFIED (the edits)
- Line 45 paused claim: src/domain/outcome.ts:67 returns 'paused' only when facts.pauseSignal === true. The only classifyOutcome callers are src/app/run-stages/item.ts:222 and src/adapters/host-claude/claude-host.ts:222; the host call (222-238) passes no pauseSignal, so no onboarding stage produces it. src/app/stages/map.ts:107 still has the branch. The resume prelude is the only enterer (src/app/resume.ts:92). Claim correct.
- Lines 57 and 211 run pointers: runs.md exists, with "Supervisor and lease" (line 183; same rules, names onboarding.md as owner) and "Resume and reconcile" (line 288). Lease default 180 s and shared leaseTtlMs: src/app/onboarding-service.ts:22,42. No overreach.
- Line 7 link to runs.md resolves.
- Regression: diff against plan base is 7 insertions, 3 deletions: the status line, the line 7 clause, the paused bullet, the lease sentence, the resume pointer. Budget claims (full reservation charged as spent, no refund) match src/app/budget.ts header.

CHECKED, NOT FLAGGED
- No em/en dash or " -- "; no changelog, delivery history or plan IDs in prose; headings sentence case; modules named once in the opening; quirks section present; sibling links all exist.
- Unchanged sections were spot-checked only, outside the dispatch focus.

git status --porcelain (pre-existing untracked only; my run wrote nothing in the repo):
?? .planning/config.json
?? .planning/milestone.lock

## Answers

Applied: finding 1 (the six sentences are split; the field list at the project record paragraph is a reference list and stays). OBS 2: the status line is removed when this review is applied.
