VERDICT: FAIL (BLOCKER 0, WARNING 1, NIT 0 in scope)

# Round 4 review, group C (scoped)

- Group: C (containment.md, data-model.md, integrations.md, unknowns.md)
- Round: 4, scoped to the changes between f19ae4e and 1987922 (`git diff f19ae4e 1987922 -- <file>`)
- Reviewer: fresh. I did not read the 04-54-reviews/ directory.
- Date: 2026-11-23
- sha256 as read. All four match the dispatch.
  - containment.md: 010447d31d61a8992c5efc567dfc6ccce3e29ad68ab6f66f9d89878c492563d5
  - data-model.md: f87e46b49143407a046201da55e7a94e0d0ec185942b2af4e34e3270c5430a41
  - integrations.md: b915faaaea0aadc935962f4234fd4020854079fae9e295372def19fe0c099d99
  - unknowns.md: d562ab25f8ccc9c6995e6cf63b07fa32c34c736098f6ecc8be0920a447b7ae59
- Severity: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, contradiction, or doctrine violation. NIT = polish.

## Findings in scope

### W1. WARNING (confidence high): contradiction between two changed "From containment" entries in unknowns.md

- Location: `docs/system/unknowns.md`, section "From containment", bullets 1, 5 and 6.
- Bullet 1 says: "The recorded run files under test/containment were not re-read, except the one `p4-restricted-run` record named below."
- Bullet 5 says: "The evidence files (`test/containment/*.jsonl`, `LIVE-CASES.md`) were not read, apart from the `p4-restricted-run` record below, so the documents claim no other recorded live result."
- Bullet 6 then cites a second record that is not the `p4-restricted-run` record: "The neighboring `p4-restricted-onboarding` case did not pass (`test/containment/LIVE-CASES.md:574`)."
- Evidence:
  - `LIVE-CASES.md:574` is the `p4-restricted-onboarding` row, verdict "FAIL, FAIL (stopped, D-04)".
  - `live-run-phase4.jsonl` lines 25-27 are FAIL records for that case, and line 32 is a later PASS record (state `active`, completeness `partia[l]`).
  - So the entries record reading more than the one record. The claim "claim no other recorded live result" is also overstated: the entry itself reports a second result. It also leaves out the later PASS at jsonl line 32. The line-32 point is a gap in what the entry reports, and I judge it separately from the contradiction.
- Fix:
  - Reword bullets 1 and 5 to name what was read: the `p4-restricted-run` record (`live-run-phase4.jsonl:24`, `LIVE-CASES.md:573`) and the `p4-restricted-onboarding` row (`LIVE-CASES.md:574`). They should say nothing else under `test/containment` was read.
  - Either drop the sentence "did not pass" or complete it with "later records at `live-run-phase4.jsonl:25-27` (FAIL) and `:32` (PASS)". The second option is better, since the entry otherwise reads as final.
  - Merge bullets 1 and 5, which now overlap.

## Verified in scope, no finding

containment.md
- Line 267 (`privileged:unparseable` maps to `shell-syntax`; `privileged:unapprovable` maps to `privileged:scm.api.write` when it is the first privileged command of the line):
  - `src/domain/hook-decision.ts:815-818` returns `shell-syntax` for an unparseable line.
  - The same lines deny with `privileged:` plus `classified.commands[0].action`.
  - `src/domain/privileged-commands.ts:792` builds the unapprovable command with action `scm.api.write`.
- Step 2 of the shell list ("Next, before the preamble is read..."):
  - `hook-decision.ts:810-819` runs the classification before the preamble check at lines 823-828.
  - The 16,384 limit matches `MAX_COMMAND_CHARS` at line 139.
  - The sentence is 34 words.
- Cap sentences (`At the built-in caps the 20th Read...`): they were moved out of the list into a paragraph. The numbers match `src/domain/retrieval-rules.ts:77-78` (20 reads; 256 KiB = 262144 bytes).
- The reservation text on the cost cap:
  - `src/app/budget.ts:157` sets the cap to `min(perInvocationUsd, remaining(costUsd))`.
  - Only the `invocations` row is reserved (`budget.ts:160`).
  - A killed run is charged `max(reported, cap)` (`budget.ts:236`).
  - An orphan is charged the cap it was granted (`budget.ts:112-125`).
  - The sentence is 30 words.
- The deny list for checks (`the two configuration homes (see "Limits of containment")`):
  - `src/app/checks.ts:139` includes `deps.profile.otherRoots`.
  - `src/cli/composition.ts:312-314` fills it with the other profiles' roots plus `realpathNearest(configHome)`, and the comment names the config homes of this profile and the default.
  - The cross-reference resolves: "Limits of containment" is the heading at line 568, and the bullet at 574 covers configuration homes.

data-model.md
- `action.started` now lists the approval ID when the source is `approval`: `src/adapters/sqlite/approval-rows.ts:30` says "`approvalId` is added to its data", and the consume returns the approval ID with the start event.
- The reservation bullet (one `invocations` unit, a cost cap that is not a row amount) matches `budget.ts:157-163`.

integrations.md
- The context-source row ("all four are built only when the GSD adapter exists") matches `src/cli/composition.ts:534-545`: the whole block, including the planning and git-files sources, is inside `if (gsd !== undefined)`.
- It agrees with the unchanged line 364 ("no GSD adapter, no context sources").

unknowns.md
- Cited test and evidence references: `live-run-phase4.jsonl:24` is `p4-restricted-run` with verdict PASS, claudeVersion 2.1.326, state `blocked_on_decision`, `writesOutsideClone: []`. `LIVE-CASES.md:573` and `:574` are the `p4-restricted-run` and `p4-restricted-onboarding` rows. The test name exists in `live-run-phase4.test.ts:107`. 2.1.326 is in `VERIFIED_HOST_VERSIONS` (`src/domain/host-admission.ts:8`).
- Commit hashes: every cited hash resolves (`f759ec8`, `58fd5e9`, `92bdf9c`, `52fe97c`, `3fb6ae4`, `059cd3d`, `7fe273c`, `95b494e`, `e1740a6`, `4c4cd49`, `f742b3e`).
  - `f759ec8` and `58fd5e9` both touch `02-22-evidence-exit.json`; that file exists under the 02 phase directory.
  - `92bdf9c` and `52fe97c` both change `scripts/exit-run-phase2*`, so "changed the exit-run scripts" is true.
- Numbers and ranges:
  - `src/app/checks.ts` lines 363-440 hold the install types and the start of `installDependencies`, which begins at line 407.
  - `src/cli/shell/shell.ts` is 552 lines.
  - The 2000 search window matches `MAX_SEARCH_SCAN` at `src/hook/pre-tool-use.ts:39`.
- The merges of "(run slice)" sections into the main ones (cli-reference, config-reference, integrations, containment, data-model, history) lose no entry. The rewording of "Campaign-wide" to "All documents" and the removal of "run slice" and "earlier text of this tree" are clean.

Doctrine sweep over all changed lines of the four files:
- No em dash, en dash or ` -- `.
- No sentence over 35 words. The longest are 34-35 and sit in moved or unchanged text.
- No delivery history in prose. The phase, plan and threat IDs I saw are in the code comments, not in the document text.
- Headings are in sentence case.
- Links and anchors resolve, including `policy-and-approvals.md#privileged-commands-in-the-hook`.

## Observations outside scope (unchanged lines; not counted)

- `docs/system/containment.md:274`, the sentence beginning "The attended hook has two more rules of the same prefix." is accurate. The mix of "rule" and "event" there is dense, but it did not change.
- `docs/system/containment.md` line 214 describes the configuration homes as part of the other-roots set and line 574 repeats it. The deny-list line in "Commands AVARICE runs for checks" (479) now points to the second. The statement appears three times; consider one home.
- Orphan wording ("each orphan charged the cost reservation it was granted") holds only while the cost budget is unchanged between grant and conversion. The code comment at `budget.ts:117-118` states that assumption; the document does not.

## Scope and cleanliness

- Run state: read-only. My only write was a scratch diff at `/tmp/r4c.diff`, outside the repo.
- `git status --short` shows the two untracked `.planning` files from the start, plus an untracked `.planning/phases/04-.../04-54-reviews/round-4-B.md`. That file was created by another reviewer, not by me.

## Counts

- BLOCKER: 0
- WARNING: 1
- NIT: 0
- Verdict: FAIL (one WARNING in scope). The fix is local to the three bullets in "From containment" in `docs/system/unknowns.md`.
