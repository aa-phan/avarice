**Group A, round 2: FAIL.** One WARNING (the bindings lock rule is not described identically in two documents) and four OBS. No BLOCKER.

Severity key: BLOCKER is a hard-rule violation or a claim the code contradicts. WARNING is likely rework and blocks this gate. OBS is worth noting and does not block.

## Header: digests verified (all six match)

| Document | sha256 |
|---|---|
| docs/system/policy-and-approvals.md | 2919db2ef1e41ae901dce90f54254e476e125dbe641ceeea6d6112fe8c26b3e0 |
| docs/system/containment.md | 0bdf47a8b35b064e614ad8fe2bc90d336c260a591e83d0a4a069c0e2234b6d16 |
| docs/system/cli-reference.md | 30cd0bba18f5b7f305739bfa1f0378e813e1011679de2096e58a68a7902d66fc |
| docs/system/data-model.md | 295bccd9f773b3eed6776aa42425f3da4623386395f3ad60a1c1fb6a69393d14 |
| docs/system/diagrams/approve-privileged-action.puml | ef09bc83cf5a77b3df4f3826ffb0bcacda6a6767b56ee034011082db19f88a15 |
| docs/system/processes.md | d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51 |

Reviewed at HEAD b72a3bc, diff base 96a0718. I also read docs/system/profiles-and-credentials.md (bindings lock, moved-root denial) as the comparison document.

## Findings

### WARNING-1 (confidence high): the bindings lock rule is not identical in data-model.md and profiles-and-credentials.md, and one fact has two full homes

- **Locations:** docs/system/data-model.md:13 (Config home row), docs/system/profiles-and-credentials.md:26. data-model.md:120 states a third, shorter version.
- **What is wrong:** profiles-and-credentials.md names four takeover cases. The first is "a holder whose process no longer exists, and a lock that names the process looking at it counts here". data-model.md lists four cases too, but its first case reads only "The holder's process no longer exists". The code also takes over a lock that names the live writing process itself, so data-model.md under-states the rule. The five other facts match: the 2-second wait, the 2-second margin for a reused ID, a lock whose text names no process and time and whose file is older than the 2-second wait, the 60-second case without `ps` or with a non-date time, and the unavailable failure after the wait. The whole rule sits in two places, so any later change will drift one of them.
- **Code evidence:**
  - src/adapters/fs/profile-bindings.ts:151-153: `processAlive` returns false for `process.pid`, with the comment that a lock naming this process is a leftover.
  - src/adapters/fs/profile-bindings.ts:187-195: `lockIsStale` implements the other cases.
  - src/adapters/fs/profile-bindings.ts:176 (`START_MARGIN_MS`, 2000) and :185 (`BINDINGS_STALE_AGE_MS`, 60_000) match the numbers in both documents.
  - src/adapters/fs/profile-bindings.ts:300-303: the 2-second wait and the unavailable failure.
- **Fix:** keep the rule only in profiles-and-credentials.md, the more complete home. Reduce the data-model.md Config home cell to what the file holds (the file `bindings.json`, plus `bindings.json.lock` holding the writer's process ID and the time the lock was written), followed by a link to profiles-and-credentials.md#bindings. Cut the takeover paragraph from the cell and shorten the bullet at data-model.md:120 to a pointer. If you keep both texts, add the self-ID case to data-model.md so they agree.

### OBS-1 (confidence medium): the profile-isolation row understates what is denied for a corrupt configuration

- **Location:** docs/system/policy-and-approvals.md:196, "so only the default roots of its name are denied".
- **What is wrong:** the code also denies the profile directory under the configuration home where the profile was found. containment.md, profiles-and-credentials.md and cli-reference.md all say "profile directory plus the default data root and work root". The word "only" in the row contradicts them.
- **Code evidence:** src/adapters/fs/profile-registry.ts:52-54 (`wholeRootOf` returns `join(home,'profiles',profile)` plus the two default roots).
- **Fix:** write "only that profile's directory and the default roots of its name are denied".

### OBS-2 (confidence medium): "first such command" can be read as "first unshowable command"

- **Locations:** docs/system/diagrams/approve-privileged-action.puml:19-20; docs/system/policy-and-approvals.md:149.
- **What is wrong:** in a run the hook judges only the first privileged command of the line. If the first command can be shown whole and a later one cannot, the run records a request for the first and never checks the second. The diagram's branch condition, "a privileged command whose values cannot be shown whole", matches that line but the branch action does not. containment.md already says "A run denies and records the first privileged command of the line only".
- **Code evidence:** src/domain/hook-decision.ts:822-824 (`classified.commands[0]`); src/hook/pre-tool-use.ts:456-462.
- **Fix:** word the diagram condition as "the line's first privileged command has values that cannot be shown whole, in a run", and make policy-and-approvals.md:149 say "the first privileged command of the line".

### OBS-3 (confidence medium): the code table's wrapper list omits `builtin`, and the divergence is not in findings.md

- **Location:** docs/system/policy-and-approvals.md:206. It says the code table "names neither" of two things, and records those differences in findings.md.
- **What is wrong:** the statement is accurate, but the code table also omits the `builtin` wrapper that the classifier skips and the document lists at line 105. findings.md:286 records the refusal and npm-option differences only.
- **Code evidence:** src/domain/enforcement-map.ts:97 (no `builtin` in the list) against src/domain/privileged-commands.ts:564 (`builtin` in `WRAPPERS`).
- **Fix:** add "and the `builtin` wrapper" to the findings.md:286 line. This is a one-line addition and should not change this document.

### OBS-4 (confidence low): pronoun and list split at policy-and-approvals.md:105

- **What is wrong:** the passage reads "The wrappers are ... The wrappers also include ...". The next sentence, "It ignores the program's directory...", follows a `taskset -p` clause, so "It" has no clear antecedent (the classifier).
- **Fix:** merge the two wrapper sentences, and write "The classifier also ignores the program's directory and letter case and reads past git's global options."

## Checked and not flagged

**Limits and numbers, all against the constants:**
- 80, 400 and 512 characters, the 917-character stored summary and the 1,024-character event string (src/domain/approval.ts:15-17, src/adapters/sqlite/events.ts:14). 400 + 1 + `cwd=` + 512 = 917.
- The six unshowable causes in the policy-and-approvals.md bullet list match `unshowableReason`. This includes joining the entries other than `cwd` with single spaces, running the secret patterns over the joined entries with `cwd` included, and naming the key and length but never the value.
- 65,536 characters, nesting deeper than 8, more than 16 prefix words, backquotes nested more than 2 deep, and the 16,384-character run limit applied before the classifier (src/domain/hook-decision.ts:140, 816).
- The seven forms, the 2-second and 60-second lock numbers, and the 256-rule, 64 KiB, 1 to 8 `when` keys, 128-character value and `approvalSource` grammar (src/domain/policy.ts:60-68).

**Classifier lists:**
- The wrapper list and its operands: `env`, `command`, `exec`, `nohup`, `builtin`, `time`, `nice`, `sudo`, `doas`, `timeout`, `xargs`, `setsid`, `stdbuf`, `ionice`, `flock`, `taskset`, `arch`, `caffeinate`, `unbuffer`, `chronic`, and `coproc` as a reserved word.
- `command -v`/`-V`, `taskset -p`, the `trap` rules, `su -c`/`--command`/`-lc`, `find` exec forms and their end words, `parallel`/`watch`, and here-strings.
- The git alias and config-include forms, including `GIT_CONFIG_PARAMETERS` handed over through an outer shell string.
- The brace and glob positions: the "refused anywhere in a privileged command" rule for braces only, globs bound as written after the subcommand, and the over-refusal cases.
- The residual list, including the npm unlisted-option residual, which is backed by the comment at src/domain/privileged-commands.ts:851-852.
- The here-document claim that a `$(git push)` in an unquoted body counts once (the shared substitution record).

**Refusal behavior:**
- The unshowable-value refusal across the attended hook (`privileged:unapprovable`, denied before consume, one `policy.denied` per command), the run hook (rule of the action, one `policy.denied` with digest and key-only reason, no request, no summary) and the gate (`privileged:unapprovable`, contract and existing approval still allow).
- The reason texts: "cannot be approved, so no approval was asked for: ..." and the own-terminal clause.
- The `approve` output, the exit-64 additions and the `grants:` wording.

**Other profiles' configuration:**
- A corrupt or permission-refused configuration denies the whole root and the command goes on. Any other read failure, an unlistable profiles directory, or an unreadable profile-directory type stops the command with exit 70.
- A relative root is left out. A non-profile entry, a link or a file is skipped.
- Onboarding and run both get the other profiles' roots and the two configuration homes. Only the run scope also gets the default parents.
- The "four things stay open" count matches.
- cli-reference.md, containment.md and profiles-and-credentials.md agree with one another and with src/adapters/fs/profile-registry.ts.

**Other changed sections:**
- `policy.denied` and `action.started` event data (`approvalId` is added in src/adapters/sqlite/approval-rows.ts:54).
- Restricted-run scope tolerance for artifact paths (modified and added only) and literal path exclusion.
- The 32 KiB run prompt, with the pack cut to fit and an oversize brief refused.
- Broad-discovery brace-glob wording and the whole-file read measurement.
- The `codeNode` and `format` item fields.
- The policy slot-builder claim (`policySources` refuses a misplaced file with `invalid`; the evaluator's broken and absent handling applies only to hand-built sources).
- The interrupted-action end rules, and the `comment --print` and three-recording-commands claim.

**Mechanical sweep:**
- No em dash, en dash or ` -- ` appears in any added line.
- No prose sentence over 35 words. Over-cap items were table rows only, which are exempt.
- No phase, plan or threat IDs, and no file paths in the changed prose. The only `src/...` hit is the `src/{a,b}` example.
- Headings are unchanged and in sentence case.
- Cited anchors exist: `#roots-and-isolation`, `#retrieval-budgets`, `#records-written-by-a-successful-start`, `#approvals`, `#privileged-commands-in-the-hook`.

**Not verified:**
- The budget-reservation wording at data-model.md:264 and containment.md:433. The cost-cap sentences are outside the named code list and I did not trace them.
- The unchanged "request already approved" ordering in the diagram. In the code that conflict surfaces after the question, not before it.

**Run hygiene:**
- I modified no tracked file. My only writes were scratch files under /tmp.
- `git status --short` at the end shows `.planning/state.json` modified, `.planning/config.json` and `.planning/milestone.lock` untracked (all three in the starting snapshot), and one untracked `.planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-69-reviews/round-2-B.md`. That file is not mine. It is not in the starting snapshot, so a parallel reviewer or the caller created it.
- No instruction embedded in any reviewed document tried to steer the review.

## Verdict for group A: FAIL

The bindings lock rule differs between data-model.md and profiles-and-credentials.md (WARNING-1). There is no BLOCKER. The four OBS items do not block.
