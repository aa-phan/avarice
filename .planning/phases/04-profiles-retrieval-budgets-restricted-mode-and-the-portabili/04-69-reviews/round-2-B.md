VERDICT: FAIL (group B, round 2). There are 0 BLOCKERs and 1 WARNING. There are also 2 OBS items and 1 out-of-scope note.

Severity key:
- BLOCKER: a hard-rule violation, or a claim the code contradicts.
- WARNING: a claim that is stale or supported only loosely. It blocks this gate.
- OBS: ambiguity or polish. It does not block.

## Header: documents and verified digests
All five digests match the dispatch.

| Document | sha256 | Match |
|---|---|---|
| docs/system/profiles-and-credentials.md | 94bb704271049420affa5d9d23ed4f83649f604a9770c94e259f138bcf01cbee | yes |
| docs/system/runs.md | 3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879 | yes |
| docs/system/integrations.md | eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858 | yes |
| docs/system/indexes-and-context.md | 56d118c0b317c4416ab4f803dbc3e722400839ef27af5826b57304b99c14ae31 | yes |
| docs/system/README.md | e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53 | yes |

Reviewed range: `git diff 96a0718..HEAD -- docs/system/<file>`. I also read docs/system/data-model.md (config-home row), docs/system/findings.md (lines 271 and 336) and docs/decisions/ADR-015, ADR-016 and ADR-017.

## Findings

### 1. WARNING (confidence high): the knowledge-pass paragraph states success counts that ADR-017 superseded
- Location: docs/system/indexes-and-context.md:140: "An evaluation on 6 tasks of one repository, one run per task and arm, found it matched the code-only arm's successes (4 of 6 each). It used 6.2% fewer run tokens and cost about seven times as much to onboard."
- This paragraph is outside the "Reuse and access" section, but it is a changed sentence in a reviewed document.
- What is wrong: the 4-of-6 and 4-of-6 counts are the ADR-015 and ADR-016 figures. ADR-017, which is Accepted and listed in the README ADR-017 row, restates them as B 2 and C 3 of 6, with partial runs A 2, B 2 and C 1 (ADR-017 Decision 5 and 7). docs/system/findings.md:336 says the same: "The D-08 rule keeps the knowledge pass on, now because C succeeds more often than B, 3 runs to 2".
- So the document contradicts the record it indexes. It also says the pass "matched" the code-only arm, while the current record has the pass ahead on successes.
- The other numbers in the sentence do trace. 6.2% is ADR-015:48, and "about seven times" is ADR-015:49. The sentence "calls the sample small and the token edge thin" matches ADR-015:47-48.
- Fix: restate the success counts under the brief-coverage rule, for example "found it ahead of the code-only arm on successes (3 of 6 against 2 of 6 after runs that skipped part of their brief were counted as partial)". Cite ADR-017 beside ADR-015 and keep the 6.2% and seven-times figures. Alternatively, cut the counts and route to findings.md.

### 2. OBS (confidence medium): "the selected profile's own configuration" is left out only in the configuration home in use
- Location: docs/system/profiles-and-credentials.md:67: "A root that a readable configuration states as a relative path is also left out, as is the selected profile's own configuration."
- Code: src/adapters/fs/profile-registry.ts:78 reads `if (home === inUse && entry === selected) continue;`. When the configuration home was moved, the selected profile's entry under the default home is still read.
- Its roots are dropped later only through the `own` set, at lines 86 and 96, and only if they equal the profile's actual roots. A corrupt copy there would add its profile directory and default roots to the denial.
- This is an edge case, and the sentence is true for the normal case.
- Fix: "as is the selected profile's own configuration in the configuration home in use".

### 3. OBS (confidence medium): the retry report lists only items that were in the previous pack
- Location: docs/system/indexes-and-context.md:285: "A retry's report says how many items were reused, and lists each item it read again with its source, its ID and the reason from the list above."
- Code: src/app/context.ts:464-470 pushes onto `refetch` only for a picked handle that the previous pack held (`prior.get(...)`), plus the access_revoked path at lines 430-431. An item that is new in the retry is read but is not listed.
- The first sentence of the paragraph ("Everything that is not reused is read again") has the same looseness.
- Fix: "lists each item of the earlier pack that it read again".

### Out-of-scope note, not counted
ADR-017 is immutable and its text is inconsistent: "Date 2026-11-23" against "approved ... on 2026-11-25" in Decision 2. The README row and findings.md do not repeat the dates. The owner may want to know, and no document in this group can fix it.

## Checks that passed
- **Banned dashes:** no em dash, en dash or " -- " on any added line of the five documents.
- **Sentence length:** no sentence over 35 words in the added prose. This excludes table rows and code. The cap is 35, from references/style.md line 7.
- **Delivery history:** no phase numbers, plan IDs or threat IDs in the added prose of the five documents. The only file paths are in the module-naming openings of runs.md and indexes-and-context.md, which the house rule allows.
- **Headings:** sentence case, no question forms.
- **Bindings lock, docs/system/profiles-and-credentials.md:26 and :119.** I checked each time and limit against src/adapters/fs/profile-bindings.ts.
  - Wait of 2 seconds (`BINDINGS_LOCK_WAIT_MS` 2000), and 60 seconds (`BINDINGS_STALE_AGE_MS`).
  - Start margin of 2 seconds (`START_MARGIN_MS`), and the lock text naming the process and "the time the lock was written" (`LockHolder.startedAt`).
  - The four takeover cases match `lockIsStale`, `processAlive` and `inspectLock`.
  - The lock that names the process itself counts as dead. The start comes from `ps -o etime=`. An unparseable `ps` output, a failing `ps` or a non-date lock time falls to the 60-second age rule.
  - The takeover-gap residual matches the `takeOver` comment. The temporary write, flush and rename match `addBinding`.
  - Registry size cap 64 KiB, 1000 bindings and mode 0600 also match.
- **Moved-root denial** against src/adapters/fs/profile-registry.ts and src/cli/composition.ts:312-313.
  - Left out: a non-profile name, a link or file standing where a profile directory belongs, and a root stated as a relative path.
  - Corrupt or refused configs deny the profile directory plus the default data and work roots of its name, and the command goes on. This covers invalid JSON, a refused key, a link, a non-regular file, oversize, and a permission or sandbox refusal (`isPermissionRefusal`).
  - Any other read failure, an unlistable profiles directory and an `lstat` failure give exit 70 with `cannot read the other profiles of this machine`.
  - The "What stays open" text is accurate. The onboarding-invocation claim holds: `profileRoots` is passed in src/app/invocation.ts at :130 and :453.
- **Roots rule:** `.claude*` means any first segment under home that starts with `.claude` (src/domain/root-rules.ts). The class now changes three things, which is correct because the repository policy tightens under every profile (docs/system/policy-and-approvals.md:42).
- **docs/system/data-model.md config-home row:** it describes the bindings lock the same way. It has the same four takeover cases, the 2-second wait and the 60-second rule, and "the time the lock was written".
- **docs/system/integrations.md.**
  - The `ps` row matches `readProcessStartMs`: it uses `ps -o etime= -p <pid>`, a 1000 ms timeout, and an environment of `PATH` and `LC_ALL` only.
  - The fallback to file age is correct, and the anchor `#selecting-a-profile` exists.
  - The failure-table row (60 seconds) is correct.
  - The Patch bullet matches `patch()` in src/adapters/git/run-workspace.ts:663-687. It uses `--binary`, `--no-renames`, `--no-ext-diff` and `--no-textconv`, and a temporary index beside the clone. Directory entries must be plain relative names. File entries use `:(exclude,literal)`. An empty, absolute, NUL or `..` entry is refused as invalid.
  - "Only the restricted run builds one" is correct: there is a single caller, at src/app/run-stages/restricted.ts:226.
- **docs/system/runs.md (restricted run, end and patch)** against src/app/run-stages/restricted.ts and src/app/run-stages/item.ts.
  - Limits: plan and questions 256 KiB, patch 1 MiB, at most five named paths cut to 80 characters then "and N more", findings text cut at 440, block text 1000 (`ISSUE_MAX_CHARS`), and the first 10 paths plus a count in the `containment.finding` event (blocked.ts:60 and :160).
  - Out-of-scope rules match `breaches()` in item.ts:348-358. A protected path is out. A modified path is out when it is outside write and not an artifact. An added path is out when it is outside create and not an artifact. A deleted path is out when it is outside delete, so a deleted artifact path is a breach.
  - The restricted directory is excluded from both the judging and the patch. Out-of-scope paths are left out literally.
  - The three problem kinds that do not stop the stage, the unreadable-file reasons (`readConfinedFile`: size, non-regular, link out of the clone), and the refusal at start (src/cli/commands/start.ts:128-138) all match. The `restrictedHint` behavior matches src/cli/composition.ts:256-263.
- **docs/system/indexes-and-context.md (Reuse and access)** against src/domain/cache-scope.ts and src/app/context.ts.
  - Five misses, judged in the order access_revoked, profile, access-scope, format, revision.
  - Format number 1 (`PACK_ITEM_FORMAT`). An absent or different format is a miss. Fields are appended in the order profile, accessScope, format. Format is judged before revision.
  - A pack built before stamping reuses nothing, because the missing profile gives a `profile` miss.
  - The README ADR-017 row and the second table row agree with each other. Their wording matches ADR-017, and the AC-8 figures in findings.md:336 match ADR-017 (A 0, B 2, C 3; partial 2, 2, 1; 94.4% and 88.5%).

## Sweep after the run
I touched no file. `git status --short` shows only the three entries that were already there at the start: ` M .planning/state.json`, `?? .planning/config.json` and `?? .planning/milestone.lock`. The one scratch file I wrote, /tmp/gb.diff, is outside the repository.

## Verdict for the group
FAIL: 1 WARNING (finding 1), no BLOCKER. Fixing finding 1 clears the gate. Findings 2 and 3 are OBS and optional.
