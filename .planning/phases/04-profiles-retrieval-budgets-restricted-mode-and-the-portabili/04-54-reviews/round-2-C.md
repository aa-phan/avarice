# Round 2 review, group C (fresh reviewer)

- Group: C (containment.md, data-model.md, integrations.md, unknowns.md), living system documentation
- Round: 2
- Reviewer: fresh. I did not open the 04-54-reviews/ directory.
- Date: 2026-11-22
- Code reviewed: HEAD 85eb6d7, worktree /Users/aphan/avarice/.claude/worktrees/phase-04
- sha256 as read (all four match the dispatch):
  - docs/system/containment.md 0eb71752a67f6de37fb3b5e0ff3eae1232a203840f145e508b2bc3587921b1c1
  - docs/system/data-model.md 2e4e3678060e285994cf0477a1d0ae5ca5b9552e5456ee5f05b1b0f8b07a74f3
  - docs/system/integrations.md bf0bb735a9f1b8bd75777329ee8aefaf230ca78be81483f66c4caa01fc8e9110
  - docs/system/unknowns.md 721de6213fe2e93ae5381b4c46ca116c5e720cb56fe839aa123fa642015a346a

Severity key: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, internal contradiction, or doctrine violation. NIT = polish.

## Verdict: FAIL. 1 BLOCKER, 6 WARNING, 3 NIT.

## Findings (most severe first)

### 1. BLOCKER: unknowns.md:33, wrong CLI command count
- **Problem:** The entry says "no cleanup command among the six CLI commands". The CLI has 20 commands. The conclusion (no cleanup command) still holds, but the stated count is wrong.
- **Evidence:** `COMMANDS` in src/cli/main.ts:20 lists 20 names. src/cli/commands/ holds 20 files. docs/system/coverage.md:11 also says 20.
- **Fix:** Write "among the twenty CLI commands", or drop the count: "no command in `COMMANDS` deletes data".

### 2. WARNING: containment.md:37, the "Privileged commands" row contradicts the run behaviour
- **Problem:** The row says "Prevents: the call is denied until the owner approves a request for each privileged command", for "a run and an attended session". In a run, approval never lifts the denial. Quirk line 604 of the same document says so ("a run never consumes an approval"). The row also names `privileged:unparseable` and `privileged:unapprovable` as if both lines used them. In a run those two cases are `shell-syntax` and `privileged:scm.api.write` (containment.md:269).
- **Evidence:**
  - src/hook/pre-tool-use.ts:429 ("An approval is never consumed in a run ... the run goes on without the effect").
  - src/domain/hook-decision.ts:815 returns `shell-syntax` for an unparseable line.
  - src/hook/pre-tool-use.ts:688 and :690 apply the two attended rules only.
- **Fix:** Split the effect by context. In an attended session the call is denied until the owner approves, then it passes once. In a run it is always denied and the request is recorded. Say that the two outright-deny rules are attended-only.

### 3. WARNING: containment.md:269, "They name no action" contradicts data-model.md:228 and the code
- **Problem:** The sentence says the two attended rules "name no action and make no approval request". The `privileged:unapprovable` event does carry an `action`, which data-model.md:228 correctly says ("the same data and the action"). Only the rule ID has no action suffix. The wording contradicts the other document.
- **Evidence:** src/hook/pre-tool-use.ts:642, `data: { ruleId: UNAPPROVABLE_RULE, action: command.action, scope, ... }`.
- **Fix:** Write "Their rule IDs carry no action suffix and neither makes an approval request; the `unapprovable` event records the command's action, and the `unparseable` event records none."

### 4. WARNING: containment.md:478, the check-command read denials omit other profiles' roots
- **Problem:** "Reads. Denied: the credential locations, the profile's data root and the default AVARICE parents." The code also denies every other profile's roots and both configuration homes. This is the area of focus (sandbox deny lists including other profiles' roots). The bullet is incomplete and contradicts containment.md:214 and :573, which say the supervisor's checks get the same denial.
- **Evidence:** src/app/checks.ts:139, `denyReadPaths: [...credentialPaths(home), canonical(deps.profile.dataRoot), ...defaultAvariceParents(home), ...deps.profile.otherRoots]`.
- **Fix:** Add "the data root and work root of every other profile found, and the two configuration homes (see 'The default AVARICE parents')".

### 5. WARNING: data-model.md:232, the writer of `action.started` is incomplete
- **Problem:** The Writer column says "application" only. The attended PreToolUse hook also writes `action.started`, inside the transaction that consumes the approval. containment.md:393 lists it under "Events the hook records".
- **Evidence:** src/hook/pre-tool-use.ts:727 (`startEvent: { type: 'action.started', ... source: 'approval' }` in `consumeLine`). The application writer is src/app/authorize.ts:118.
- **Fix:** Set the Writer column to "application, hook". Say that the hook writes it only in an attended session.

### 6. WARNING: integrations.md:74, "One more adapter-config row" contradicts the code and data-model.md
- **Problem:** The Ledger port paragraph says `install-host` writes "one more adapter-config row", `host-skill:avarice-run`. `install-host` writes two rows. The second is `host-hook:attended` with port `host-hook`. integrations.md:168 and data-model.md:147 both state the second row.
- **Evidence:** src/cli/commands/install-host.ts:28-29 and :99-103.
- **Fix:** Write "Two adapter-config rows are written by `install-host`: `host-skill:avarice-run` (port `host-skill`) and `host-hook:attended` (port `host-hook`). Neither port is in the ports directory."

### 7. WARNING: unknowns.md:43 and unknowns.md:79 contradict each other
- **Problem:** The "From containment" entry (line 43) says it checked "the recorded run files under test/containment". The "From containment (run slice)" entry (line 79) says "Evidence files (test/containment/*.jsonl, LIVE-CASES.md) were not read". Both sit in one document that says each entry records what was checked, so a reader cannot tell whether the live records were read.
- **Fix:** State one fact. Either reconcile the two entries, or mark the later one as concerning the run-slice pass only ("not re-read in the run-slice pass").

### 8. NIT: containment.md:414, "the next Read of a non-empty file is denied" is stated too broadly
- **Problem:** After 262144 bytes are spent, a Read whose `offset` lies past the last line measures 0 bytes and is allowed on the byte row.
- **Evidence:** src/hook/pre-tool-use.ts:255, `if (n === 0) return counted;` returns 0 when no requested line exists.
- **Fix:** Write "the next Read that returns at least one byte".

### 9. NIT: unknowns.md:106, incomplete condition
- **Problem:** The entry says `full` is true "when TERM is not dumb". The code also requires stdout to be a TTY.
- **Evidence:** src/cli/shell/shell.ts:153, `options.stdout.isTTY === true && options.env['TERM'] !== 'dumb'`.
- **Fix:** Add "and stdout is a terminal".

### 10. NIT: unknowns.md:58, garbled sentence
- **Problem:** "Which parts of `src/app/run-stages/item.ts` were not read: covered in part." is a heading-like fragment followed by a claim.
- **Fix:** "`src/app/run-stages/item.ts` is covered in part. Read: ... Not read: ..."

## Verified against code, no finding (coverage)

**containment.md**
- Rule counts: 40 distinct rule IDs, 6 on allow, 35 on deny, `subagent-type` on both. I re-ran the coverage command and got 40 IDs. Six hook-entry-decided rules; five retrieval rules.
- Privileged forms: the six actions in `PRIVILEGED_COMMAND_FORMS`, plus `unparseable` and `unapprovable`.
- Read charging:
  - Caps are 20 reads and 256 KiB. Default `limit` is 2000 lines. The scan cap is 64 MiB. `offset` and `limit` are ignored unless positive whole numbers.
  - Charge order is `toolCalls`, `fullReads`, `fullReadBytes`.
  - The two denial texts match `spentDecision`. A missing row exits 2. An unopenable regular file exits 2.
- Broad discovery:
  - The match-all regex agrees with the stated examples.
  - Brace groups count as unfiltered.
  - A named type filters.
  - The limit is 1 only when `brief.broadDiscovery` is true.
  - A start override cannot authorize it.
  - Retrieval rows: four rows, the nine profile caps, `searches` defaults to the tool-call limit.
- Restricted patch rules: 256 KiB for the plan and questions, 1 MiB patch cap, the artifact tolerance for modified and added paths only, the finding capped at 10 paths with a count, the 32 files and 512 KiB closure, and the three seeds.
- Restricted flags: six restricted flags and the ten refused flags.
- Other profiles' roots: the permission-refused config adds the profile directory plus the default data and work roots of its name. Another read failure stops the command. A corrupt config is skipped. The profiles directory fails closed.
- Other limits: 12 credential locations, 16 denied prefixes, 11 read-only commands, 10 find actions, 11+3+3 GSD verbs, 6 verified versions and the lowest patch 2.1.312.
- Numbers: 7 required help flags, loop limits 3 and 25, 20 MiB transcript, 10 s kill grace, 5 s hook timeout, 10 s guard-hook timeout, 8 MiB digest cap, 16384 command characters, 15 minute install timeout, 32 KiB prompt, 7 `config-set` values, 64-hop and 400-character process chain, proxy address ranges and status codes.

**data-model.md**
- 24 tables: 20 in migration 1, 3 in migration 2, 1 in migration 3.
- 10 triggers and the stated index counts.
- 50 event kinds: the set of kinds in the code matches the table.
- `startSeq` is optional and an end without it closes the earliest open start.
- The two variants of the `policy.denied` event: data fields match code.
- Budget rows: five plus four retrieval rows, and the status view hides the retrieval rows.
- Bindings lock file: holds a pid and a start time, mode 0600, 2 s wait.
- Limits: 4 s hook busy wait, 64 KiB config, 30 minute approval expiry, 1000-line history cap.

**integrations.md**
- Credential helper: 16 KiB stdout limit, 5 s timeout, `credential-helper-not-listed`, stderr never read.
- `install-host`:
  - Exit codes 3, 64 and 70.
  - 256 KiB marker-file limit for an existing skill file.
  - 1 MiB settings limit.
  - Refusal list for links, non-directories, invalid JSON, wrong hook structure and a mixed marker.
  - 5 s hook timeout, `onFailure: block`, and mode preservation.
  - The hook-script check happens before any write.

**unknowns.md**
- Counts verified: six verified versions, 84 ledger methods, 552-line shell, 27 run kill points, nine diagrams in docs/system/diagrams.
- Line cites checked: check-validation.ts:90, checks.ts:435 and activate.ts:98.
- Commit hashes and `test/containment` files exist.

**Mechanical sweep (all four documents)**
- No em dash, en dash or spaced `--` outside code spans and code fences.
- No sentence over 35 words after stripping bold markers and code fences, excluding table rows, and counting code-span words. The longest are 35 or fewer.
- Headings are sentence case.
- No delivery history, phase numbers, plan IDs or SHAs in the prose of containment.md, data-model.md or integrations.md. SHAs in unknowns.md appear only as claim evidence.
- Every relative link and anchor in the four documents resolves. I used a script (/tmp/anch.py) to check them.
- No banned constructions found. I swept for filler, inflated and cursed vocabulary, and antithesis forms.

**Deliberately not flagged**
- unknowns.md carries file paths in its entries. That is its function (it records what was checked), so I did not call it a violation of the "keep paths out of prose" rule.

## Run hygiene
- I modified no repository file. `git status --short` shows only .planning/config.json, .planning/milestone.lock, and an untracked .planning/phases/04-.../04-54-reviews/round-2-B.md that appeared during my run. That file is not mine, and I did not read the directory. My scratch scripts live in /tmp.
- The four documents' sha256 values matched before and after my run.
