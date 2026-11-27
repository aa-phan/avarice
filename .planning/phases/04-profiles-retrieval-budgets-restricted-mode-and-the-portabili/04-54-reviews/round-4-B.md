Round 4 (scoped), group B: PASS (0 BLOCKER, 0 WARNING, 0 NIT in scope)

Header
- Group: B. Round 4, scoped. Base f19ae4e..1987922. Reviewer: fresh. Date: 2026-11-23.
- I did not read 04-54-reviews/.
- sha256 as read (all three match the dispatch):
  - docs/system/cli-reference.md 303cabff2bc057d160cd559a987ead8c35ec5761a3759f8bd54766da3fca9162
  - docs/system/config-reference.md 509878292f4a9b1523a8a33f4436892a6bbb08da1111fd17c38b66b53a2aea09
  - docs/system/README.md 521922988975d2800b2cf1aa72cd8766779ecb77c749313840a81e90e8ce6761

Findings in scope: none.

What I checked, one changed line at a time:

1. cli-reference.md:105, exit 64 row. The added text is "an unknown approval request or approval ID or a profile whose data root another user owns (`approve`)". Both parts match the code.
   - src/cli/commands/approve.ts:51-55: `not_found` returns EXIT_USAGE (64) with "no such approval request" or "no such approval".
   - approve.ts:73-76: `!ownsProfile(dataRoot)` prints "only the user who owns the profile approves an action" and returns EXIT_USAGE.
   - The nearby unchanged text agrees: cli-reference.md lines 797 and 804-805 both say 64 for these cases.
   - The new wording is one run-on list item, not a sentence over the cap. It has no banned dashes and no delivery history.

2. cli-reference.md:569, the install-host 70 message. The new text is `failed: internal error: cannot install the avarice-run skill: <code>`. It matches the code.
   - src/adapters/host-claude/skill-install.ts:105 builds the cause `cannot install the ${skill.name} skill: <code>` as an `internal` error.
   - src/adapters/sqlite/db.ts:36 `describeError` renders `internal` as `internal error: <cause>`.
   - src/cli/commands/install-host.ts:73 wraps that as `failed: ${describeError(e)}`.
   - The result is `avarice install-host: failed: internal error: cannot install ...`. The doc quotes only the part after the command prefix, as the other bullets do.

3. config-reference.md:294, the new sentence "The three retrieval names must be integers, and the ceiling of `retrieval.fullReads` and `retrieval.fullReadBytes` is the profile's cap." It matches src/domain/run-contract.ts.
   - Lines 372-373 refuse a non-integer for all three retrieval names ("must be an integer").
   - Lines 343-347 set the ceiling for `fullReads` and `fullReadBytes` to `caps.*`, which are the profile caps passed in at line 665.
   - The ceiling for `searches` is `scaled.toolCalls`. The doc does not claim the profile cap for it, so it is accurate.
   - The new sentence does not contradict the neighbouring "an integer where marked". It is under 35 words.
   - The link `#the-retrieval-section` resolves to the heading at line 105, "### The `retrieval` section".

4. README.md:39, the proposal-counterpart sentence. The new text is "either has nothing built yet or is planning material, not a description of the system". It matches the table's last row.
   - The row for implementation-plan.md, reference-system-comparison.md and reference-system-deep-dive.md is "none: planning and comparison material, not a description of the system".
   - All three files exist in docs/.
   - The sentence is under 35 words and has no banned dashes or delivery history.

Mechanical sweep of the changed lines: no em dash, en dash or " -- "; no phase, plan or task IDs; no sentence over 35 words.

Observations outside scope: none worth listing. I did not review unchanged lines.

Read-only proof: `git status --short` shows only the two pre-existing untracked files, .planning/config.json and .planning/milestone.lock. My run touched nothing.

Verdict: PASS. Counts: BLOCKER 0, WARNING 0, NIT 0.
