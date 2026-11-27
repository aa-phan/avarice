# Round 3, group A: fresh-eyes review

- Group: A (policy and approvals, approve flow, doctor, profiles and credentials, findings)
- Round: 3
- Reviewer: fresh (did not read `04-54-reviews/`)
- Date: 2026-11-22
- Worktree: `/Users/aphan/avarice/.claude/worktrees/phase-04`
- Digest check: all six sha256 values matched the dispatch before review.

| Document | sha256 as read |
|---|---|
| `docs/system/policy-and-approvals.md` | e25d6f7d27c199eb62ee4bb2a8733619d9d47e2e3f3bb417b85170e1549a75ce |
| `docs/system/diagrams/approve-privileged-action.puml` | fc76193dd9c4b3a7996af32af1238980b41ed4bae36c1f7d9d6d878af4a26c2e |
| `docs/system/processes.md` | 06a8187d84e9bf73a63ad861a851bc46a869abb0d50cc352b6353de00e8f4bc5 |
| `docs/system/doctor.md` | 882147312a861e5bb0d7c23803d3daa67308978158ca21cfe9b45b4ca359292e |
| `docs/system/profiles-and-credentials.md` | 9d6c7021e6760dbc48a219a1453275936915f35161dab375e8e9f1617596dbc6 |
| `docs/system/findings.md` | 53f14a2a42c881e62d78302bc06b6f0fcda6d5e4bed26ae9343657528b52a993 |

Severity: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, or a doctrine violation. NIT = polish.

## Verdict: FAIL (1 BLOCKER, 6 WARNING, 3 NIT)

## Findings

### 1. BLOCKER: `policy-and-approvals.md:189` miscounts the commands that refuse inside a run

- **Problem:** The text says "The four commands that record something refuse inside a run and from a run's process tree, with exit 64 before the profile resolves, and they need no terminal." Only three do: `context add`, `evidence add` and `pr record`.
- **Why the fourth does not fit:** `comment --print` records nothing, and the doc's own line 197 says "It writes nothing". It has no refusal of its own and runs in a run.
- **Evidence:**
  - `src/cli/commands/context.ts:50-51`, `evidence.ts:26-27` and `pr.ts:24-25` call `refuseInsideRun`.
  - `src/cli/commands/comment.ts:14-37` does not. It declares `readOnly = true` and only prints.
  - The "four" in `src/cli/manual-command.ts:1` means the four commands that share the run-ID check, not the four that refuse.
- **Fix:** "The three commands that record something (`context add`, `evidence add`, `pr record`) refuse inside a run and from a run's process tree, with exit 64 before the profile resolves, and need no terminal. `comment --print` has no such refusal."

### 2. WARNING: `policy-and-approvals.md:44` describes a mismatched policy file as "broken" or "absent", but the built path refuses it

- **Problem:** The text says a file parsed for another source "counts as broken" at rank 1 and "counts as absent" at ranks 3 and 4, "which leaves the stricter built-in answer in force".
  - The only production path builds the sources through `policySources`. It returns an `invalid` error for any file not parsed for its own slot, and for an organization value that is not a parsed organization file.
  - `authorizeAction` returns that error (`if (!sources.ok) return sources`). Nothing is denied as `org.invalid-or-missing` and nothing is treated as absent.
  - The broken and absent treatment exists only in `evaluatePolicy` for a hand-built `PolicySources`.
- **Evidence:** `src/domain/policy.ts:233-262` (`invalidSources`), `policy.ts:156` (`usable`), `src/cli/composition.ts:189` (the builder is the only caller path), `src/app/authorize.ts:98-99`.
- **Fix:** Say that the sources builder refuses the whole evaluation when a file sits in the wrong slot, and that the broken or absent rule applies inside the evaluator only. Or drop the sentence.

### 3. WARNING: `policy-and-approvals.md:142` says "An end recorded without a start", which the code refuses

- **Problem:** The text says "An end recorded without a start closes the earliest open start of its action." `finishPrivilegedAction` returns a conflict when no open start exists.
- **What the code does:** The fallback applies to an end that names no start sequence, an event written before that field existed. It still needs an open start of that action.
- **Evidence:** `src/app/authorize.ts:177-190` (comment and `openSteps`), `authorize.ts:198-204` (conflict when no open start).
- **Fix:** "An end that names no start closes the earliest open start of its action; an end with no open start of that action is refused."

### 4. WARNING: `policy-and-approvals.md:173` puts test file paths in running prose

- **Problem:** The text names `test/integration/approvals.test.ts` and `test/integration/restricted-mode.test.ts`. The repository `CLAUDE.md` says `docs/system/` names modules once in the opening and keeps file paths out of the prose. The paths are correct and exist, but they are in the body.
- **Fix:** "although tracked integration suites for approvals and restricted mode exist". Leave the paths to `findings.md` line 262, which already carries them.

### 5. WARNING: `doctor.md:5` contradicts `doctor.md:9`

- **Problem:** Line 5 says doctor "reads and never writes, except for the one repair behind a flag". Line 9 says it resolves the profile, "which creates the profile's directories and configuration file when they are absent".
- **Evidence:** `src/cli/doctor-deps.ts:42` calls `resolveProfile`, and `src/adapters/fs/profile-paths.ts:123-134` runs `mkdirSync` (mode 0700) and `writeFileSync` (`wx`, mode 0600).
- **Fix:** In line 5, "It writes nothing to the store; the only other writes are the profile directories and configuration file that profile resolution creates when absent, and the repair behind a flag."

### 6. WARNING: `profiles-and-credentials.md:110` states the multi-line secret limit too broadly

- **Problem:** The text says "A multi-line secret, such as a private-key block spread over several raw lines, is matched per line." That holds for the transcript boundary, which redacts line by line. It is wrong for events and artifacts, which pass whole strings through the redactor.
- **Evidence:**
  - `src/domain/secret-patterns.ts:24` and `:54` define and apply `PEM_BLOCK`, a multi-line pattern.
  - The comment at `secret-patterns.ts:50-51` says "A private key block goes whole, body included".
- **Fix:** Scope the limit to the transcript boundary, where lines are redacted as they arrive. For events and artifacts, say a private-key block is redacted whole.

### 7. WARNING: `processes.md:174` lists the wrong drift anchors for the approve diagram

- **Problem:** The anchors are `src/hook/pre-tool-use.ts`, `src/app/authorize.ts`, `src/cli/commands/approve.ts` and `src/adapters/sqlite/ledger.ts`. The diagram does not depict the approval gate in `authorize.ts`. The gate's one caller is promotion, as `policy-and-approvals.md:79` says.
- **What is missing:** The diagram does depict the classifier (`src/domain/privileged-commands.ts`: the seven forms, the digest binding, the unapprovable and unparseable rules) and the shared consumption statements (`src/adapters/sqlite/approval-rows.ts`). A change to either would make the diagram stale, and neither is anchored.
- **Fix:** Replace `src/app/authorize.ts` with `src/domain/privileged-commands.ts` and `src/adapters/sqlite/approval-rows.ts`.

### 8. NIT: `profiles-and-credentials.md:51`, the `retention` row reads as three alternatives

- **Problem:** The "Holds" cell reads "`transcripts`, `summary` or `full`". The section holds one key, `transcripts`, whose value is `summary` or `full`.
- **Evidence:** `src/domain/redactor.ts:88-95`.
- **Fix:** "`transcripts`: `summary` or `full`".

### 9. NIT: `profiles-and-credentials.md:67`, "The sandbox of a run" omits onboarding

- **Problem:** The other-profile root denial also applies to onboarding invocations. `findings.md` line 101 and the containment document both say so.
- **Evidence:** `src/app/invocation.ts:130` and `:453` pass `profileRoots` for both.
- **Fix:** "The sandbox of a run and of an onboarding invocation denies reads of...".

### 10. NIT: `policy-and-approvals.md:124-127`, bold-lead list items

- **Problem:** The four outcomes are numbered items that each open with a bold lead. This is the "bold-lead bullets" pattern in `style.md`. The items are parallel and functional, so this is low priority.
- **Fix:** Optional. Drop the bold, or leave it.

## Observation (not a finding): delivery history in `findings.md`

The owner has not yet decided whether commit hashes and plan or ruling references belong in `findings.md`. They appear throughout the file, for example:

- commit hashes at lines 9, 11, 24, 45-47 and 289-293
- "plan 04-35" and "ruling 2/3/4" at lines 330-331
- a `.planning/phases/...` path at line 181

## Coverage: what I checked and did not flag

- **Digests:** all six matched.
- **Mechanical sweep on the five docs and the diagram:**
  - Dashes: none in prose. The only hit was `--` inside backticks at `findings.md:74`, which is code and exempt.
  - Sentence length: none over 35 words (maximum 35). Tables and fences were excluded, and the `findings.md` lines are a reference list, exempt.
  - Banned and cursed vocabulary, antithesis, production residue and headings: all clean. Headings are in sentence case.
  - Delivery history in prose: none outside `findings.md`.
  - Frontmatter: none.
  - Links and anchors: every link and anchor in the four docs resolves.
  - Diagram structure: `alt` and `end` are balanced at 7 each. No render tool is installed, and the doc says the diagrams are not rendered.
- **Limits and numbers confirmed against constants.** Each of these matched:
  - Approvals and policy: 30 minutes; 22 action names; 18 enforcement-map rows; 256 rules; 64 KiB; the 64, 32, 8, 31 and 128 limits; the 80 and 400 summary caps; `apr_` and `apv_` plus 26 characters; the policy-rule grammar.
  - Classifier and hook: 65,536 characters; nesting 8; 16 prefix words; backquotes more than two deep; the 14 wrappers; the seven forms; the parameter table; the run hook's 16,384; the attended hook's 5 seconds and session ID of up to 100 characters; the four attended outcomes.
  - Doctor: probe timeouts (1 second, online 8 seconds); the one-hour repair age; the seven and six help flags; the four admission labels; the eleven finding areas; the report key order; the exit codes; the `host-version-unreadable` and `host-version-unknown` rules.
  - Profiles and credentials: the profile grammar (1 to 31); the bindings limits (1,000; 64 KiB; the 2-second lock wait; mode 0600); the 64 globs of 256 characters; the 4,096 and 1,024 limits; six limits keys; nine retrieval keys; the 128-character credential name; the 5-second and 16 KiB provider limits; 160-character audit strings; the 8-character seed minimum; seven redaction kinds; twelve redacted artifact kinds; the 16-character hash suffix; the manual-input limits (16,000; 200; 2 MiB).
- **Behaviour traced to code:**
  - Policy and approvals: the gate order, the hook-versus-gate split, consumption (oldest granted; strictly later expiry; one transaction), `approve` exits and refusals, the no-replay rule and the run block reason.
  - Doctor: the extensions probe and attended-entry error finding, host admission and enforcement derivation, record incompatibility and the `start` refusal order.
  - Profiles and credentials: bindings lock takeover, the moved-root denial including the permission-refused case (EACCES and EPERM deny the whole profile; other failures exit 70 with the stated message; unlistable directories fail), profile selection exit codes, the config key set and refusals, the `cmd` and keychain providers, and the credential audit.
- **`findings.md`:**
  - **Existence and range (script):** I extracted 709 backticked `path:line` cites and checked each. All files exist and every line number is within the file length. 263 of 264 list items lead with a `file:line`; the one exception is the deliberate "`src (many files)`" note at line 105. `docs/system/containment.md:573` holds the "Another profile's roots" bullet.
  - **Content at the line (reading):** I read the cited line for about 100 cites. That covered the whole policy-and-approvals, profiles, doctor and portability section (lines 257-285), 45 randomly sampled "(now at)" cites, and about 30 others I picked from lines 342-351 and nearby. All said what the finding claims.
  - **Heuristic pass:** it flagged 96 cites where the finding's backticked terms did not appear within 30 lines of the cited line. I read the cited lines for about 20 of them (for example the `main.ts:115`/`:166`/`:171` trio, `start.ts:151`/`:154`, `args.ts:48`, `db.ts:112`, `notify-policy.ts:21`, `run-preflight.ts:73`) and none was wrong. The remaining flags are mostly absence claims or claims about behaviour, not about the token, and I did not read them all.
  - **No fault found** in the lines I read; I did not read every one.
- **Left alone on purpose:**
  - The policy doc deliberately contradicts the enforcement map's `profile-isolation` text and points to `findings.md` line 264. That matches `findings.md`.
  - The diagram-index drift-anchor column puts file paths in a table, which I treated as a reference table.
  - The "Of the three rows that name host limitations" count is correct (two rows carry the field; `tool-call-decisions` names both limitations in its text).

## Run hygiene

I modified no file. `git status --short` after the run shows only `.planning/config.json` and `.planning/milestone.lock`, both untracked before I started. It also shows `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-3-B.md`, untracked and written by a different reviewer, not by me.
