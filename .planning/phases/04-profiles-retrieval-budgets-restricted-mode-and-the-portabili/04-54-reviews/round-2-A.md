# Round 2, group A review (stored as round-2-A.md)

- Group: A (policy-and-approvals, approve-privileged-action diagram, processes approve flow, doctor, profiles-and-credentials, findings)
- Round: 2
- Reviewer: fresh (the 04-54-reviews/ directory was not read)
- Date: 2026-11-22
- Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04 (HEAD 85eb6d7)
- sha256 as read. All six match the dispatch values.
  - docs/system/policy-and-approvals.md: 99745d09d9801c65b63dffb272530fbaf94a4090207a1f0eeeaa1e1dde5f1e9c
  - docs/system/diagrams/approve-privileged-action.puml: fc76193dd9c4b3a7996af32af1238980b41ed4bae36c1f7d9d6d878af4a26c2e
  - docs/system/processes.md: 843ed5883593ec2f7ee69a7ef76037d4969885c67725fa2164feb535f3ab3d13
  - docs/system/doctor.md: e620abbd713d92102b85368b81c6aa70fd810d2482efc73be1e448d75a052fd6
  - docs/system/profiles-and-credentials.md: acd4e692f4b1582329d0c0c7b4a1f2498108bbc2474285d46518442064b37b43
  - docs/system/findings.md: 3b558b899e11845fe6e8fdf4f886edbf9f3152fedf529f2246a0cf1726bc67f5

Severity as used here: BLOCKER is a factual error against the code. WARNING is a misleading or unsupported claim, or a doctrine violation. NIT is polish.

## Verdict: FAIL (1 BLOCKER, 3 WARNING, 4 NIT)

## Findings

### 1. BLOCKER: findings.md:200 and :201 state two defects that the code at HEAD contradicts
- Quote at line 200: "`src/adapters/sqlite/migrations/0001-initial.ts:17`: task_refs has no writer or reader; ..."
- Quote at line 201: "`src/adapters/sqlite/migrations/0001-initial.ts:76`: approvals has no writer or reader".
- Both are present tense, with no "no longer holds" qualifier.
- Evidence for `approvals`:
  - `src/adapters/sqlite/ledger.ts:674` `grantApproval` inserts the rows.
  - `src/adapters/sqlite/ledger.ts:737` `consumeApprovalAndStart` reads and updates them.
  - `src/adapters/sqlite/approval-rows.ts:37-47` `consumeApprovalRow` selects and updates them.
- Evidence for `task_refs`:
  - `src/adapters/sqlite/ledger.ts:768` `recordTaskRefs` writes the table.
  - `src/adapters/sqlite/ledger.ts:782` `listTaskRefs` reads it.
  - `src/app/manual-inputs.ts:182` calls the writer.
  - `src/app/resume-refs.ts:97` calls the reader.
- `docs/system/data-model.md:5` says "the built code writes every one" of the 24 tables, so the two files also disagree with each other.
- Line 63 of findings.md is correctly scoped to a commit ("at 72a86b1"). Lines 200 and 201 are not.
- Fix: rewrite both as "No longer holds: ..." with the writer and reader cites above, or delete them.

### 2. WARNING: findings.md has 19 lines whose current or "(now at ...)" cite does not say what the line claims
For each line the cited line is the first item, and the line that holds the observation at HEAD follows.

| findings.md line | Cited | Holds the observation at HEAD |
|---|---|---|
| 61 | ledger.ts:531 (runs insert) | ledger.ts:552-558 (`recordStepResult` upsert) |
| 62 | ledger.ts:763 (`toApprovalRequest` return) | ledger.ts:957 (`INSERT OR IGNORE INTO artifacts`) |
| 199 | ledger.ts:1207 (return of amend) | ledger.ts:1224 (and 1448), the evidence insert with `ext_ref` |
| 82, 207 | claude-host.ts:157 (blank line) | claude-host.ts:193 (`invDir = join(dataRoot, run ? 'run' : 'onboard', ...)`) |
| 134 | item.ts:1891 (archive comment) | item.ts:1924 (`strays`) |
| 153 | checks.ts:171 and :174 | comment at checks.ts:173-174; the digest is `checkSpecDigest` at conventions.ts:288 |
| 155 | checks.ts:243 and :234 | `truncated` flag at checks.ts:249; redaction in `recordCheck` after 256 |
| 158 | checks.ts:250 (`});`) | checks.ts:269 (`preExisting`) |
| 159 | item.ts:1067 (classify step) | item.ts:1101 (`c.kind !== 'progressed'` goes to `routeOutcome`) |
| 166 | install-host.ts:25 and :35 | usage check at install-host.ts:34-35; `process.env['CLAUDE_CONFIG_DIR']` at :46 |
| 167 | run-status.ts:215 (a comment about tracker references) | run-status.ts:261-271 (`interruptedOf`) |
| 187 | invocation-scope.ts:505 (blank line) | invocation-scope.ts:524-530 (protected globs, `globRoot`) |
| 188 | invocation.ts:151 (`onboarding.onboardingId`) | invocation.ts:473 (`onboardingId: run.runId`) |
| 216 | run-source.ts:55 | run-source.ts:18 (`MAX_CANDIDATES = 500`) and :61 (`rev-list --max-count`) |
| 224 | composition.ts:173 (`repositories` map of `policyLoader`) | composition.ts:355-381 (read-only open and fallback) |
| 234 | item.ts:594 (in `resumeBlock`), bare `item.ts:608` and `:634` | about item.ts:626-631 (snapshot step null), :642 (`workspace.head`), :666-670 (breach block) |
| 235 | item.ts:1156 and bare `item.ts:1191` | item.ts:1190 (`hostRefused`) and :1225 (enforcement on unavailable or denied) |
| 316 | item.ts:1541 | about item.ts:1575 (`deletion-scope` goes to `permission`) |

- Line 316 also cites item.ts:1441 for "inventory measured only for a unit that passes every other G2 rule". I could not confirm that one.
- In every line the observation itself still holds. The cites are wrong.
- The header at findings.md:3 says "the code at HEAD is the authority", but a "(now at X)" that points at the wrong line is a false statement.
- Coverage: 507 existence checks, run by script over every cite not followed by "(now at". Four short-name cites (install-host.ts:25, item.ts:608, :634, :1191) did not resolve and were checked by hand, which gives the fails above. About 190 cites were also read against their lines (all group-A sections, plus ledger.ts, item.ts, hook-decision.ts, claude-host.ts, checks.ts, run-contract.ts, and the rest of the "now at" set).
- Confidence: high for the 19 rows above. I did not verify every cite in the file.
- Fix: re-derive each cite at HEAD, or drop the "now at" and say "moved". Add a drift anchor if the owner wants these kept current.

### 3. WARNING: findings.md has sentences over the 35-word cap in running prose
- Seven are 45 words or longer, including:
  - line 25 (45 words)
  - line 327 (59 words, the "The restricted host confines..." sentence)
  - lines 330 and 331 (63 words each)
  - line 332 (43 words)
  - line 342 (49 words)
  - line 348 (46 words)
- About 25 more are 36-42 words, on lines 46, 47, 76, 101, 140, 146, 249, 269, 271, 285, 329, 332, 333, 334, 335, 338, 344, 346 and 350.
- The sentences sit in bullet items, so a reviewer could read the reference-list carve-out as covering them. Lines 327-335 are prose, not list entries.
- Confidence: medium on applicability, high on the counts.
- Fix: split at the semicolons and "because" clauses. Lines 327, 330 and 331 are the first to fix.
- The other four documents have no sentence over 35 words, checked outside tables and fences.

### 4. WARNING: doctor.md:88 states the unknown-version limit too narrowly
- Quote: "A version whose first number is too large to compare is reported as `host-version-unknown`."
- Evidence: `src/domain/host-admission.ts:46-52` and `:69-71`. `parse` returns undefined when any of the three parts fails `Number.isSafeInteger`, and `admitHostVersion` then returns `host-version-unknown`. The launch preflight does the same at `launch-preflight.ts:166`.
- Fix: write "A version with any of its three numbers too large to compare".

### 5. NIT: policy-and-approvals.md:163 restates a limit that the code table does not hold
- The profile-isolation row says "a profile moved by environment variable is covered only when its configuration is found".
- `src/domain/enforcement-map.ts:113` says such a profile "is not covered by the sandbox denial".
- The behavior the doc gives is the built one (`profile-registry.ts:83`), and findings.md:264 records the gap.
- The doc presents the row as the code table's content (line 150) and does not say it differs.
- Fix: add "(the code table's own text is older; see findings)", or say the row states built behavior.

### 6. NIT: policy-and-approvals.md:173 uses "exercise" and gives no source
- Quote: "although the suites that exercise them are tracked".
- Style: house style prefers "test" over "exercise".
- Support: the claim is backed only by findings.md:262, which cites `test/integration/approvals.test.ts` and `restricted-mode.test.ts` (both exist).
- Fix: "although tracked suites test them (`test/integration/approvals.test.ts`, `restricted-mode.test.ts`)", or drop the clause.

### 7. NIT: profiles-and-credentials.md:11 counts a fourth class-dependent difference that depends on the name
- Quote: "The class changes four things. ... The credential providers differ by name: `personal-extended` alone may use a vendor CLI".
- Evidence: `src/domain/credential-ref.ts:50-53`. `personal-local` and `personal-extended` are both class `personal` and have different provider lists.
- Fix: "The class changes three things; separately, the credential providers differ by name: ...".

### 8. NIT: profiles-and-credentials.md:69 omits the profile directory from the denied set
- Quote: "so only the default roots of that profile are denied".
- Evidence: `src/adapters/fs/profile-registry.ts:55-57`. `wholeRootOf` also denies the profile directory under the configuration home where it was found, as the doc says correctly at line 67.
- Fix: "only that profile's directory and its default roots are denied".

## Observation (not counted)
- Delivery history in findings.md. The file carries commit hashes ("72a86b1", "9268945", "d73b51f", ...), plan references ("plan 04-35", "owner ruling 2") and phase paths. Per your note I record this as an observation only, for the owner question.

## Checked and not flagged

### Limits and numbers against code constants (no discrepancy except finding 4)
- `privileged-commands.ts`:
  - 65,536 characters, nesting 8, 16 prefix words, the backquote nesting limit of two, and the five unparseable cases.
  - The 14 wrappers, shells, `eval`, the npm abbreviation rule, the `gh api` POST rule, the seven forms, the parameter-name table, and the unapprovable `gh api` forms.
- `hook-decision.ts:139`: 16,384 characters for a run.
- `pre-tool-use.ts:604`: session ID of 1-100 characters.
- `attended-hook-install.ts:41, 56`: 5-second timeout, `onFailure: block`, matcher `Bash`.
- `approval.ts`: 30 minutes, 80 and 400 characters, ellipsis, key and digest rules.
- Approval IDs are `apr_`/`apv_` plus a 26-character ULID (`ids.ts`).
- `consumeApprovalRow`: oldest granted first, strict expiry.
- `grantApproval`: second grant gives exit 3. Revoke of a revoked or consumed approval gives exit 3.
- `approve.ts`: exit codes 0, 3, 64 and 70, and the refusals before the profile is resolved.
- Migration 0004 triggers.
- `action-class.ts`: 22 names (3, 4 and 15), and the claim of which names have a call site.
- `policy.ts`: 256 rules, 64 KiB, the id, action and `approvalSource` patterns, 1-8 `when` keys, name pattern, 128-character values, reserved prefixes, evaluation order, ranks, personal and enterprise behavior.
- `policy-sources.ts` and `composition.ts:146-190`: organization file handling, repository policy handling, and the read-once rule.
- `enforcement-map.ts`: 18 rows, the four enforcers, proofs, the host-limitation rows (three name them, two are not-claimed).
- Profiles:
  - Profile name grammar (1-31 characters), the 14 config keys, 4,096-character roots, and the `limits` (six), `retrieval` (nine) and `adapters` rules.
  - Root rules, bindings (1,000 bindings, 64 KiB, 0600, 2-second lock wait, takeover and atomic write), enterprise patterns (64 globs, 256 characters), and the profile-gate exits 3 and 70.
  - Moved-root denial, including the permission-refused case and "cannot read the other profiles of this machine" (`composition.ts:313`).
  - Credential names (1-128 characters, not all dots), the helper path rules, the 5-second and 16 KiB cmd and keychain limits, exit 44, 160-character audit strings, the 8-character seed minimum, seven redaction kinds.
- Doctor:
  - 1-second probes and the 8-second online check, flags and exit codes, the one-hour repair threshold (`>=`), eleven finding areas, report key order.
  - The extensions probe and attended-entry findings (`isRegularFile`, symlink followed), admission labels, seven and six flags, enforcement levels, the attended label, record incompatibility.

### Other checks
- Flows against the code:
  - The processes.md approve flow and the .puml were checked against `pre-tool-use.ts` (run and attended branches, `consumeLine` all-or-none, the pending-request SQL) and `approve.ts`.
  - They agree with each other and with the code, including the repeated-command request naming and the retry outcomes.
- Mechanical sweeps:
  - The three banned dash forms. The one ` -- ` hit, in findings.md:74, is inside a code span.
  - Banned constructions, apart from the NIT in finding 6.
  - Heading case, and the absence of question headings.
  - Frontmatter: none.
  - File paths, function names and delivery history outside each document's opening: none in the four prose documents.
- Links and anchors: all internal links and anchors in the five markdown files resolve, checked by script.
- Cross-references: autonomy-and-decisions.md:53 does state the owner-check rule that policy-and-approvals.md:60 cites.
- Not reviewed: the rest of processes.md (the other eight flows) is outside this assignment. It has one filler phrase ("final in practice", line 151), left unflagged.

## Read-only sweep
- `git status --short` shows only untracked entries: `.planning/config.json`, `.planning/milestone.lock`, and `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-54-reviews/round-2-B.md`.
- No tracked file is modified, and I wrote nothing in the repository. The first two were in the starting snapshot. `round-2-B.md` appeared during my run, so presumably it comes from a parallel reviewer.
- My scratch scripts are in /tmp.
- The sha256 values were re-run at the end of the run and are unchanged.
