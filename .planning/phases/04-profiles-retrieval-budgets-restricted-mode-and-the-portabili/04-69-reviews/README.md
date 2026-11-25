# Plan 04-69 documentation review records

Status: rounds 1 and 2 ran and both groups failed each time; the findings are fixed (see the review table) and round 3, the last allowed, is pending. The executor of plan 04-69 cannot start a fresh `technical-writer:prose-reviewer` (no Agent tool, and the `technical-writer:prose-review` skill only instructs the caller to dispatch reviewer agents), so each round is a checkpoint to the orchestrator. No document is marked `reviewed` in `docs/system/coverage.md`; the documents below are `changed after review` there.

Code under review: `3a6c10c` (the last commit that touched `src`, `scripts`, `bin` or `test`; the last `src` commit is `2bd1e03`). Documents under review: the changes of plans 04-56 to 04-68 to `docs/system/`, as `git diff 96a0718..HEAD -- docs/system` shows for each file. The version to review in round 1 is the one with the round 1 digest below (HEAD `b07b088`). The version to review in round 2 is the one with the round 2 digest (the documents as at commit `21ae2eb`). The version to review in round 3 is the one with the round 3 digest (the documents as at commit `d38f5ea`; the commit that records the digests only changes this file).

`findings.md` is a log and is exempt from prose review by the owner's decision of 2026-11-23 (`04-54-reviews/README.md`, decision 2); that exemption is kept. Its changed lines are checked against their `file:line` by the plan's acceptance criteria, not by a prose round.

## Review groups

Groups follow `04-68-doc-worklist.md`. `README.md` changed in Task 1 of this plan (one counterparts row) and joins group B, so that its status is backed by a review.

| Group | Document | sha256 reviewed in round 1 | sha256 to review in round 2 | sha256 to review in round 3 | Reviewer checks against the code |
|---|---|---|---|---|---|
| A | `policy-and-approvals.md` | `aee16bfa541f30941072cdd159c8ab285c1dd0e37a13210c612cc3612a2eeeb3` | `2919db2ef1e41ae901dce90f54254e476e125dbe641ceeea6d6112fe8c26b3e0` (changed) | `ed2bc30336e554da773ddfedc703be5f1a11b20cebe1c20222c9b490d13bfa7b` (changed) | the classifier's wrappers, launchers, string forms and residual list; the refusal cases; the unshowable-value conditions and caps (`src/domain/privileged-commands.ts`, `src/domain/approval.ts`, `src/hook/pre-tool-use.ts`, `src/domain/hook-decision.ts`, `src/domain/enforcement-map.ts`) |
| A | `containment.md` | `f482d11fff951cec5e5109c9854f3daefb564e2265d231bbfff7d463b8834caa` | `0bdf47a8b35b064e614ad8fe2bc90d336c260a591e83d0a4a069c0e2234b6d16` (changed) | `0bdf47a8b35b064e614ad8fe2bc90d336c260a591e83d0a4a069c0e2234b6d16` (unchanged) | the restricted patch, the corrupt-config whole-root denial, the brace-glob reason, the events the hook records (`src/adapters/fs/profile-registry.ts`, `src/domain/privileged-commands.ts`, `src/hook/pre-tool-use.ts`) |
| A | `diagrams/approve-privileged-action.puml` | `ef09bc83cf5a77b3df4f3826ffb0bcacda6a6767b56ee034011082db19f88a15` | `ef09bc83cf5a77b3df4f3826ffb0bcacda6a6767b56ee034011082db19f88a15` (unchanged) | `0f5cfa1268c1d34cce59eaef66dec72e6d3b93deab3aa00ddb29a46a61e4524e` (changed) | read with `processes.md` |
| A | `processes.md` (approve flow, steps 2 to 4) | `d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51` | `d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51` (unchanged) | `d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51` (unchanged) | the approve steps against the hook and the `approve` command |
| A | `cli-reference.md` (approve, context `items` row) | `a9a8093a44d1f9016ec1faba98e0342edfb878be677b702e462399a084a1f451` | `30cd0bba18f5b7f305739bfa1f0378e813e1011679de2096e58a68a7902d66fc` (changed) | `30cd0bba18f5b7f305739bfa1f0378e813e1011679de2096e58a68a7902d66fc` (unchanged) | `src/cli/commands/approve.ts`, `src/cli/commands/context.ts`, the item `format` field |
| A | `data-model.md` (config home row, `policy.denied` row) | `25c4fcf61c9cf74cad6a01dd263333b7bddac54fc2316e4727b03b74e4ad7daf` | `295bccd9f773b3eed6776aa42425f3da4623386395f3ad60a1c1fb6a69393d14` (changed) | `f1badee031dc5cf7bee8d7db7468c53d5da798fd835df7996d775b686b663cbc` (changed) | the event data of `policy.denied` and the bindings lock rules; must say the same as `profiles-and-credentials.md` |
| B | `runs.md` (restricted runs, run end and patch) | `3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879` | `3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879` (unchanged) | `3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879` (unchanged) | the patch's exclusion lists (`excludePaths`), in-scope edits kept |
| B | `profiles-and-credentials.md` | `430857d04a34524798acc573fe9df322dc6e3ed62cafc00651842ecb38e6321d` | `94bb704271049420affa5d9d23ed4f83649f604a9770c94e259f138bcf01cbee` (changed) | `d1dfa303f68a07902d39545da1ec178a23db6bf710ff09670db6743b1165f368` (changed) | the lock's four takeover cases against `lockIsStale`, the 2-second margin and the 60-second fallback (`src/adapters/fs/profile-bindings.ts`); the registry's whole-root denial (`src/adapters/fs/profile-registry.ts`) |
| B | `integrations.md` (`ps` row, Run workspace Patch, failure table) | `eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858` | `eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858` (unchanged) | `eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858` (unchanged) | the lock holder's start read through `ps`; the run workspace `excludePaths` |
| B | `indexes-and-context.md` (Reuse and access) | `56d118c0b317c4416ab4f803dbc3e722400839ef27af5826b57304b99c14ae31` | `56d118c0b317c4416ab4f803dbc3e722400839ef27af5826b57304b99c14ae31` (unchanged) | `7ccb4f4f4a71821c081f5d79cff57ebaa2cc00af3f46cc3891cd67e432b6d886` (changed) | the order of the five cache misses, the item `format`, when it is raised (`src/app/run-stages/item.ts`, `src/app/context.ts`) |
| B | `README.md` (ADR-017 counterparts row) | `e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53` | `e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53` (unchanged) | `e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53` (unchanged) | the row against `docs/decisions/ADR-017-ac8-brief-coverage.md` and `findings.md` |

Each reviewer should read every sentence that states a limit (2 seconds, 60 seconds, 1 second for `ps`, 1 MiB, 440 characters, 80 characters, 400 characters, 512 characters, 16 prefix words) against the constant in the code.

Round budget: at most three rounds per group, each by a fresh reviewer that has not seen an earlier round. Each report is stored verbatim as `round-<n>-<group>.md`. A group passes when its last round records no BLOCKER and no WARNING. A document is marked `reviewed` in `coverage.md` only after its group passed, naming the round file. An edit after a passing round voids the verdict.

## Review rounds

| Round | Group | Report | Verdict | Found and done |
|---|---|---|---|---|---|
| 1 | A | `round-1-A.md` | FAIL: 1 BLOCKER, 1 WARNING, 4 NITs | See the dispositions below |
| 1 | B | `round-1-B.md` | FAIL: 1 WARNING, 3 OBS | See the dispositions below |
| 2 | A | `round-2-A.md` | FAIL: 1 WARNING, 4 OBS | See the dispositions of round 2 |
| 2 | B | `round-2-B.md` | FAIL: 1 WARNING, 2 OBS, 1 out-of-scope note | See the dispositions of round 2 |
| 3 | A | `round-3-A.md` (pending) | not run | |
| 3 | B | `round-3-B.md` (pending) | not run | |

### Dispositions of round 1

Each fix was checked against the code at HEAD, not against a proposal. Commit `21ae2eb` holds all of them.

| Finding | Severity | Disposition |
|---|---|---|
| A-F1: `cli-reference.md` says a corrupt profile configuration is skipped | BLOCKER | Fixed. The sentence now says a configuration that is corrupt, or that the system refuses to open, does not stop the command and has the whole root of its profile denied. Checked against the registry, which handles a refused read and an `invalid` read in one branch that adds the whole root. The corrupt-configuration kinds in `containment.md` now also list a file that is not regular, as the registry's read does. |
| A-F2: changed sentences over the 35-word cap | WARNING | Fixed. All listed sentences in `policy-and-approvals.md`, `containment.md` and `cli-reference.md` were split, and the sentences those splits produced were counted again. A script over every added line of all ten documents since `96a0718` (table rows excluded) finds no sentence over 35 words. |
| A-F3: alias reason says "the owner can run the command it stands for"; `trap` rule omits `-l` | NIT | Fixed. The reason is now described as asking for the command it stands for to be run, as the code text does. The `trap` rule now says it runs nothing when an option such as `-p` or `-l` comes first, as `trapString` returns nothing for any option-led first operand. |
| A-F4: map row omits the unlisted npm option that the residual list names | NIT | Fixed. The `privileged-approval` row now lists it, the sentence under the table says the code table's text names neither this nor the unshowable-value case, and the existing `findings.md` line for that row now records the npm option too. |
| A-F5: lock rule omits the unparseable lock time | NIT | Fixed in `data-model.md` and `profiles-and-credentials.md` (and its Quirks bullet), with the wording of B-OBS2. |
| A-F6: "the code table's own text is older" narrates history | NIT | Fixed. The sentence says the code table's text differs and points to `findings.md`. |
| B-1: three sentences over 35 words in `profiles-and-credentials.md` | WARNING | Fixed. The list of left-out entries, the corrupt and refused cases, and the "what stays open" sentence were split, and each new sentence is at most 35 words. |
| B-OBS2: "a holder that cannot be read" is ambiguous; unparseable time not named | OBS | Fixed in both documents. The second takeover case reads "a lock whose text does not name a process and a time". The 60-second case now also covers a lock time that is not a date, as `lockIsStale` does. |
| B-OBS3: label matching of the multi-item prompt is looser in the code | OBS | Not fixed. The sentence is correct for the plain form and does not overstate it; it is outside the restricted-run scope of this plan. |
| B-OBS4: the first cache miss is narrower in the text than in the code | OBS | Not fixed. The reviewer confirms the built behavior matches the text (no entry sets `answer`), so the text is correct for what runs. |

Group B's round 1 verdict recorded no finding against `runs.md`, `integrations.md`, `indexes-and-context.md` or `README.md`, and group A's none against the diagram or `processes.md`. These six are unchanged since round 1. A round 2 reviewer may skip them if the orchestrator accepts the round 1 verdict for unchanged documents, and must read the changed ones in full.

### Dispositions of round 2

Each fix was checked against the code at HEAD, not against a proposal. Commit `d38f5ea` holds all of them.

| Finding | Severity | Disposition |
|---|---|---|
| A-W1: the bindings lock rule is stated in full in `data-model.md` and `profiles-and-credentials.md`, and `data-model.md` omits the lock that names the process looking at it | WARNING | Fixed by keeping the rule in one home. The `data-model.md` Config home cell now says what the lock file holds and links to `profiles-and-credentials.md#selecting-a-profile`, which carries the four takeover cases (including the lock naming the live writer itself, `processAlive` in `profile-bindings.ts`). The Quirks bullet of `profiles-and-credentials.md`, the third version of the rule, is now a pointer to that section. The reviewer's "data-model.md:120" is the Quirks bullet of `profiles-and-credentials.md` at line 120; line 120 of `data-model.md` holds no lock text. |
| A-OBS1: the profile-isolation row says "only the default roots" | OBS | Fixed. The row says that profile's directory and the default roots of its name are denied, as `wholeRootOf` returns. |
| A-OBS2: "first such command" reads as the first unshowable command | OBS | Fixed in the diagram (the branch condition is about the first privileged command's values, and the action says "that command") and in `policy-and-approvals.md` ("A line whose first privileged command has bound values that cannot be shown..."). Checked against `classified.commands[0]` in `hook-decision.ts`. |
| A-OBS3: the code table's wrapper list omits `builtin`, not in `findings.md` | OBS | Fixed in `findings.md` only. `builtin` is in `WRAPPERS` at `privileged-commands.ts:557` (the reviewer cited line 564, which is `stdbuf`) and absent from the text at `enforcement-map.ts:97`. |
| A-OBS4: pronoun and split wrapper list in `policy-and-approvals.md` | OBS | Partly fixed. The pronoun now reads "The classifier also ignores...". The two wrapper sentences are not merged: the merged list is 36 words, over the 35-word cap. |
| B-W1: `indexes-and-context.md` states the superseded 4-of-6 success counts | WARNING | Fixed. The paragraph now says the knowledge pass was ahead of the code-only arm on successes, 3 of 6 against 2 of 6, treats a run that skipped part of its brief as partial, keeps the 6.2% and seven-times figures, and cites ADR-017 beside ADR-015. Checked against ADR-017 decisions 5 and 7 (arm B 2, arm C 3; tokens 94.4% and 88.5% of A, so C used 6.2% fewer than B). |
| B-OBS2: "the selected profile's own configuration" holds only in the configuration home in use | OBS | Fixed with the reviewer's wording. Checked against `profile-registry.ts:78`. |
| B-OBS3: the retry report lists only items of the earlier pack | OBS | Fixed in both sentences of the paragraph ("Everything in the earlier pack that is not reused is read again"; "lists each item of the earlier pack that it read again"). |
| B out-of-scope note: ADR-017 says "Date 2026-11-23" and, in decision 2, approval on 2026-11-25 | Note | Not edited: an accepted ADR is never rewritten. Recorded as an open item for the owner in the plan summary. |

The sweep of every line added to `docs/system/` since `96a0718` (table rows excluded) finds no banned dash and no sentence over 35 words in the ten reviewed documents. Three over-cap items remain in `coverage.md`, a ledger outside the review groups. `findings.md` is exempt from prose review (see above).

