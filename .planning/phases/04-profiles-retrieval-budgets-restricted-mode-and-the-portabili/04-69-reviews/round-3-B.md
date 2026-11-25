VERDICT (group B, round 3): FAIL. There are 2 WARNINGs and no BLOCKERs. Both WARNINGs are in indexes-and-context.md. The other four documents have no finding above NIT.

Severity terms used here:
- BLOCKER: a hard-rule violation, or a claim the code contradicts.
- WARNING: a loosely supported claim or a broken reference. It blocks under this gate.
- NIT: polish.

## Header: documents and verified digests (all five match the dispatch)

| Document | sha256 |
|---|---|
| docs/system/profiles-and-credentials.md | d1dfa303f68a07902d39545da1ec178a23db6bf710ff09670db6743b1165f368 |
| docs/system/runs.md | 3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879 |
| docs/system/integrations.md | eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858 |
| docs/system/indexes-and-context.md | 7ccb4f4f4a71821c081f5d79cff57ebaa2cc00af3f46cc3891cd67e432b6d886 |
| docs/system/README.md | e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53 |

I reviewed `git diff 96a0718..HEAD` for each file, in context, against HEAD of the worktree `/Users/aphan/avarice/.claude/worktrees/phase-04`.

## Findings

### 1. WARNING (confidence high): dangling cross-reference after a heading rename
- Location: docs/system/indexes-and-context.md:138. The quote is: "The `knowledge` object of the record gains a `corpusCap` object when the cap left something out (see "What the record states")".
- Problem: the sections "What the record states" were renamed to "Code graph record fields" (line 72) and "Knowledge record fields" (line 212). No heading named "What the record states" exists any more. A grep of docs/system finds the old title only at this line.
- Evidence: heading list of the file. The `corpusCap` field is described under "Knowledge record fields" (line 212).
- Fix: change the reference to `(see [Knowledge record fields](#knowledge-record-fields))`.

### 2. WARNING (confidence high): a sentence on pack-item cache misses contradicts what the code does
- Location: docs/system/indexes-and-context.md:285. The quote is: "Everything in the earlier pack that is not reused is read again. A retry's report says how many items were reused, and lists each item of the earlier pack that it read again with its source, its ID and the reason from the list above."
- Problem 1: the first sentence is false.
  - The code lists only an earlier-pack item that the new pack picks again and that misses (src/app/context.ts:461-470), or one whose handle is revoked (src/app/context.ts:431).
  - An earlier-pack item that the retry does not pick again, because of ranking, the snippet cap or a share limit, is neither read again nor listed.
- Problem 2: a revoked item (`access_revoked`) is dropped before any read (src/app/context.ts:427-433). The report lists it, but it is not "read again". This conflicts with "lists each item ... that it read again", which also contradicts list item 1 of the same section.
- What matches the code:
  - The order of the five misses and "first that applies is the reason" match `cacheMiss` (src/domain/cache-scope.ts:51-58).
  - Item format 1 matches `PACK_ITEM_FORMAT`.
  - The stamping order (profile, accessScope, format) matches `packItem` (src/app/context.ts:229-246).
- Fix: replace the two sentences with "An item of the earlier pack that the retry picks again and cannot reuse is read again, and the report lists it with its source, its ID and the reason from the list above. An item whose access was revoked is not read, and the report lists it with the reason `access_revoked`. An earlier item that the retry does not pick is not listed."

### 3. NIT (confidence medium): knowledge-pass success lead is stated without its one-run basis
- Location: docs/system/indexes-and-context.md:140. The quote is: "found it ahead of the code-only arm on successes, 3 of 6 against 2 of 6."
- The figures are correct against ADR-017 (arm B 2 successes, arm C 3). The adjoining clause says ADR-015 calls "the sample small and the token edge thin", but the success lead is one run. ADR-017 says "the ranking of B and C is one run. The knowledge-pass outcome now depends on that one run."
- Fix: add "a lead of one run" after "2 of 6", or route the reader to ADR-017 for that caveat.

### 4. NIT (confidence medium): the 60-second figure has two homes
- Location: docs/system/integrations.md:387, a failure-table row stating "counts as stale only when its file is older than 60 seconds".
- The rule lives in profiles-and-credentials.md:26. The ps row at integrations.md:23 already routes there by link.
- Fix: shorten the row to "the bindings lock falls back to the age of its file (see ...#selecting-a-profile)" and drop the number. This is optional, because failure rows are a legitimate place to route.

### 5. NIT (confidence low): "writes nothing to the clone"
- Location: docs/system/integrations.md:271 (Patch). The quote is: "It writes nothing to the clone and leaves the clone's index alone."
- Evidence: `treeOfWorkingContent` (src/adapters/git/run-workspace.ts:735-757) uses a temporary index outside the clone's own index. `git add -A` and `write-tree` still add objects to the clone's object store.
- The port comment says the same (src/ports/run-workspace.ts:167). The user-visible claim (working tree and index untouched) is true.
- Fix: say "changes no file of the working tree and leaves the clone's index alone".

## What I verified and deliberately did not flag

### Bindings lock rule (profiles-and-credentials.md:26 and :120)
- The wait is 2 s (`BINDINGS_LOCK_WAIT_MS` 2000, src/adapters/fs/profile-bindings.ts:147).
- All four takeover cases match `lockIsStale` (profile-bindings.ts:202-209):
  - The holder is gone. A lock naming the current process counts as gone (`processAlive`, :166).
  - The lock text is unreadable and the file is older than 2 s.
  - A live process holds the ID but started more than 2 s after the lock was written (`START_MARGIN_MS` 2000; `etime` read through `ps`, :222-238).
  - The start cannot be judged (`ps` absent, failing or unparseable, or the lock time not a date) and the file is older than 60 s (`BINDINGS_STALE_AGE_MS`).
- The hung-holder residual and the third-writer gap match the code comments (:184, :270-272).
- The `ps` details in the integrations.md:23 row match the code: `ps -o etime= -p <pid>`, 1000 ms timeout, env `PATH` and `LC_ALL` only.
- One home: profiles-and-credentials.md "Selecting a profile". data-model.md:13, the Quirks bullet at :120 and integrations.md:23 link to it, and `#selecting-a-profile` resolves.
- findings.md:288-289 record the residuals.

### Other profiles' configurations (profiles-and-credentials.md moved-root denial and "What stays open")
- All of this matches src/adapters/fs/profile-registry.ts:
  - Skipped entries are a non-profile name, and a link or file standing where a profile directory belongs.
  - A relative root is left out.
  - The selected profile's own configuration in the home in use is skipped.
  - A corrupt configuration (invalid JSON, refused key, symbolic link, non-regular file, over the 64 KiB cap) or a refused read (EACCES or EPERM) denies the whole root. That root is the profile directory where it was found plus the default data and work roots of its name, and the command goes on.
  - Any other read failure, an unlistable profiles directory, or an unreadable directory type fails with exit 70. The message is `cannot read the other profiles of this machine` (src/cli/composition.ts:313; EXIT_INTERNAL is 70).
- The residuals are stated correctly, including that a root moved elsewhere by a corrupt configuration stays open.
- The roots reach the onboarding invocation (src/app/invocation.ts:130 and :453) and the checks (src/app/checks.ts:139).

### Restricted runs (runs.md:477-491 and integrations.md Patch)
- Limits: 256 KiB for plan and questions, 1 MiB for the patch, 5 named paths cut to 80 characters, 440-character findings cut inside the 1000-character block text, 10 paths in the `scope-of-writes` finding (src/app/run-stages/blocked.ts:60).
- The scope rules match `breaches` (src/app/run-stages/item.ts:348-359): protected paths, modified outside write, added outside create, deleted outside delete, artifact paths tolerated for modified and added only.
- Exclusion from the patch is literal and per file: `:(exclude,literal)<file>` plus the plain restricted directory (src/adapters/git/run-workspace.ts:663-686).
  - A file entry that is empty, absolute, holds NUL or has a `..` segment is refused as invalid.
  - Directory entries must be plain relative names.
- The two-step record (`captured` false then true) and resume behavior match restricted.ts:250-269 and :338.

### Knowledge pass figures (indexes-and-context.md:131-140)
- The calibration figures match the calibration comment (src/domain/knowledge-corpus.ts:159-173) and the unit test (test/unit/knowledge-cost-cap.test.ts):
  - Sessions cost 0.302, 0.7518 and 0.8058 USD; the last ended 0.0058 over the 0.8 cap.
  - The 12-chunk mean is 0.7788 and the 6-chunk cost is 0.30 rounded.
  - The limit is 9, 15 and 23 chunks at 0.8, 1.6 and 3.0 USD.
  - The model gives 0.52 USD at 9 chunks and the scaled measured session is 0.54.
- ADR-015: 6 tasks of one repository, one run per task and arm. The 6.2% token edge is (18,715,894 − 17,557,851) / 18,715,894, and the onboarding cost ratio is 0.83 / 0.12, about 7. ADR-015 does call the sample small and the edge thin.
- ADR-017: the 3 of 6 against 2 of 6 comes from the table, and "partial" matches its definition.
- The README ADR-016 and ADR-017 rows are accurate: findings.md:336 carries the re-judged figures, and both ADR files exist.

### Other changed claims in indexes-and-context.md
- The forbidden-citation rule matches `forbiddenForAnyNode` (src/domain/knowledge-validation.ts:62-63, :101).
- `gsd-planning` freshness `unavailable` without `state.json`, the phase file patterns, and `codeNode` in the graph source and `context --json` all match the code.
- All four context sources are built only when the GSD adapter exists (src/cli/composition.ts:534-548).

### Other changed text I read
- The credential helper row in integrations.md matches `credential-helper-not-listed` (src/adapters/credential/cmd.ts:58) and the 5 s timeout (`HELPER_TIMEOUT_MS`).
- The README quirks-line and counterpart-row edits are consistent with the rest of the file.
- The other runs.md and integrations.md hunks (the module-list opening, install-host rewording, ledger rows) are outside the listed scope and I did not review them deeply.

### Mechanical sweep (all five files)
- Em dashes, en dashes and ` -- `: none in prose. The one hit, integrations.md:135, is `pgrep -f --` inside a code span and is exempt.
- Sentences over 35 words, after stripping bold and links and excluding tables, headings and fences: none found.
- Delivery history in the changed prose (phase numbers, plan IDs, threat IDs, function names): none. Module paths appear only in the openings, as the house rule allows.
- Headings are sentence case. The renamed headings in indexes-and-context.md are not question forms.
- No instruction embedded in any reviewed text.

### Read-only proof
`git status --short` after the run shows only `M .planning/state.json`, `?? .planning/config.json` and `?? .planning/milestone.lock`. These match the session-start snapshot. My only scratch file was `/tmp/sweep.py`, outside the repository.
