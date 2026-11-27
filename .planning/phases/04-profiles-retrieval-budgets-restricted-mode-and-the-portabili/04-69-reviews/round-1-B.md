**Verdict: FAIL.** There is no BLOCKER. There is one WARNING: three sentences in `docs/system/profiles-and-credentials.md` exceed the 35-word hard cap. Every factual claim I checked against the code at HEAD holds.

## Header

Review of group B, round 1, in /Users/aphan/avarice/.claude/worktrees/phase-04 at HEAD 632cf05, diffed from 96a0718. I changed no file. `git status --short` after the run matches the status at the start (`.planning/state.json` modified, `.planning/config.json` and `.planning/milestone.lock` untracked). My only scratch file is /tmp/sl.py, outside the repository.

Severity terms used here:
- **BLOCKER:** cannot proceed.
- **WARNING:** likely rework; fix it, and it blocks this gate.
- **OBS:** worth noting, does not block.

| Document | Verified sha256 | Matches dispatch |
|---|---|---|
| docs/system/runs.md | 3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879 | yes |
| docs/system/profiles-and-credentials.md | 430857d04a34524798acc573fe9df322dc6e3ed62cafc00651842ecb38e6321d | yes |
| docs/system/integrations.md | eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858 | yes |
| docs/system/indexes-and-context.md | 56d118c0b317c4416ab4f803dbc3e722400839ef27af5826b57304b99c14ae31 | yes |
| docs/system/README.md | e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53 | yes |

I also read docs/system/data-model.md (config-home row) and docs/decisions/ADR-017-ac8-brief-coverage.md. I did not digest data-model.md.

## Findings

### 1. WARNING (confidence high): three sentences over the 35-word hard maximum

All three are in the changed "Moved-root denial" and "What stays open" paragraphs of docs/system/profiles-and-credentials.md. This is the only file where my sweep found any sentence over 35 words (prose only, code fences and table rows excluded).

- profiles-and-credentials.md:67, 51 words: "A directory that is not a profile name, a link or a file standing where a profile directory belongs, a root that a readable configuration states as a relative path, and the selected profile's own configuration are left out of the list, so one odd entry does not lock the machine."
- profiles-and-credentials.md:67, 45 words: "That is a configuration that is corrupt (not valid JSON, a refused key, a symbolic link, a file that is not regular, or one over the size cap) and one that the system refused to read (a mode that forbids it, or a sandbox deny)."
- profiles-and-credentials.md:69, 39 words: "A configuration that is corrupt, or that the system refused to read, cannot say where its profile moved its roots, so only that profile's directory and its default roots are denied, and a root it moved elsewhere is not."

Evidence: references/style.md:7 ("hard maximum 35").

Fix: split each at its list.
- First sentence: "These entries are left out of the list: a directory that is not a profile name, a link or file where a profile directory belongs, a root stated as a relative path, and the selected profile's own configuration. One odd entry therefore does not lock the machine."
- Second sentence: put the corrupt and refused cases in two short sentences.
- Third sentence: end it after "denied", and give "a root it moved elsewhere is not" its own sentence.

### 2. OBS (confidence medium): "a holder that cannot be read" is ambiguous

Location: profiles-and-credentials.md:25 ("a lock whose holder cannot be read, or was never fully written, and whose file is older than the 2-second wait") and the matching clause in the data-model.md config-home row.

In the code, only a lock file whose text does not parse into a process ID and a time is taken over after 2 seconds (src/adapters/fs/profile-bindings.ts, `lockIsStale`: `holder === undefined` then `lockAgeMs > BINDINGS_LOCK_WAIT_MS`). A lock file that cannot be opened or read (for example EACCES) is never judged stale at all. `inspectLock` returns `held` for any read error other than ENOENT. A reader could take "cannot be read" to cover that case.

Separately, a lock whose time field does not parse as a date falls to the 60-second rule, like an unreadable process start. Both docs list only the `ps` causes for that rule.

Fix: say "whose text does not name a process and a time". Optionally add "or whose time cannot be parsed" to the 60-second case.

### 3. OBS (confidence medium): label matching in the multi-item prompt is looser than described

Location: runs.md:262 (the Launch paragraph): "a paragraph is labelled for an item when its first line starts with `Item <id>:` or `Work item <id>:`".

In the code, the first non-empty line is used, and the match is case-insensitive with optional whitespace before the colon (src/domain/item-scope.ts, `LABEL = /^(?:work\s+)?item\s+([^\s:]+)\s*:/i`). The doc is correct for the plain form and does not overstate it. This is outside the restricted-run scope you named.

### 4. OBS (confidence low): the first miss of the cache rule is narrower in the doc than in the code

Location: indexes-and-context.md:277 ("`access_revoked`: the reference is revoked").

`cacheMiss` also reports `access_revoked` when an entry's `answer` is `denied` or `unauthenticated` (src/domain/cache-scope.ts). src/app/context.ts:467 never sets `answer`, so the built behavior matches the doc.

A pack built before items were stamped misses first on `profile`, not `format`, because its `profile` reads as an empty string. The doc says only that it "reuses nothing", which is true.

## Verified and not flagged

**Bindings lock** (profile-bindings.ts, against profiles-and-credentials.md:25 and the Quirks bullet, the integrations.md ps row, spawn-site bullet and failure-table row, and the data-model.md config-home row):
- The 2-second wait is `BINDINGS_LOCK_WAIT_MS = 2000`.
- The 2-second margin for a reused process ID is `START_MARGIN_MS`.
- The 60-second fallback is `BINDINGS_STALE_AGE_MS = 60_000`.
- The four takeover cases match `lockIsStale` and `processAlive`, including the case where the lock names the reading process itself.
- The takeover residual (a third writer in the rename and put-back gap) matches the `takeOver` comment.
- The lock file records the time the lock was written, not the process start.
- Start is read as `nowMs` minus `ps -o etime=`, with a 1-second timeout, `PATH` and `LC_ALL` only, and absolute `ps` paths.
- data-model.md and profiles-and-credentials.md agree on the cases and numbers. data-model.md omits the self-named lock case and the takeover residual, which is acceptable for a table row.
- The `#selecting-a-profile` anchor exists, and the lock paragraph sits under that heading.

**Other profile with a corrupt config** (profile-registry.ts, against profiles-and-credentials.md:67 and :69):
- A corrupt config (invalid JSON, refused key, symbolic link, non-regular file, over the size cap) denies the whole root of that profile and the command goes on. This covers the profile directory in the home where it was found, and the default data root and work root of its name.
- The same applies to a permission or sandbox refusal (EACCES, EPERM).
- Any other read failure returns `unavailable`, and composition.ts turns that into "cannot read the other profiles of this machine", exit 70 (`EXIT_INTERNAL`).
- An unlistable profiles directory, and an `lstat` failure on a profile directory, also end in exit 70.
- A link or file named like a profile directory, a name outside the grammar, a relative root and the selected profile's own config are skipped.
- The "run and onboarding invocation" claim holds: `otherRoots` is passed to both in src/app/invocation.ts:130 and :453.
- The `.claude*` rule matches src/domain/root-rules.ts.

**Restricted run** (restricted.ts, src/adapters/git/run-workspace.ts, item.ts, src/ports/run-workspace.ts, against runs.md "Restricted runs" and "Quirks"):
- Artifact limits: 256 KiB for plan and questions, 1 MiB for the patch.
- A plan is stored only if non-empty (`planText.trim() !== ''`), and questions only if at least one line is non-blank.
- Scope rules match `breaches()`:
  - A protected path is out of scope first.
  - A modified path must be in the write set or an artifact path.
  - An added path must be in the create set or an artifact path.
  - A deleted path must be in the delete set, so a deleted artifact path is a breach.
- The restricted directory is excluded by `:(exclude)` and the out-of-scope paths by `:(exclude,literal)`, so `*`, `?`, `[`, `:` and a leading `-` are ordinary characters, and in-scope edits stay.
- Entries refused by `patch()`: empty, leading `/`, NUL, or a `..` segment. integrations.md:270 states exactly this. runs.md does not repeat it, which is correct under one-fact-one-home.
- The block text names at most 5 paths, each cut to 80 characters, then `and N more`. The `containment.finding` event lists 10 paths and the count (blocked.ts `MAX_FINDING_PATHS = 10`).
- Problem and finding sentences are cut at 440 characters. The worst case I computed is about 910 to 930 characters (prefix, three 64-hex digests, 444 characters of findings, a 165-character ending), so the ending always survives the 1000-character limit (`ISSUE_MAX_CHARS`).
- The three non-fatal problem kinds, the "could not be read" and "larger than the 1 MiB limit" wordings, and the two-step record with `captured` false then true all match. A resume never relaunches the host once the step is `completed`, and re-takes the outputs from the clone if `captured` is false.
- "Unreadable" (over 256 KiB, not regular, link out of the clone) matches `readConfinedFile`.
- Restricted preparation (no install, validation, baseline or GSD settings) matches prepare.ts.
- The start refusal and the hint rule match start.ts and composition.ts (`restrictedHint`).
- "Thirteen refusal codes" is 7 start checks plus 6 preflight rules.
- `patch()` is called only from restricted.ts, so "Only the restricted run builds one" holds.

**Pack-item cache misses** (cache-scope.ts, context.ts, against indexes-and-context.md:273):
- The miss order is `access_revoked`, `profile`, `access-scope`, `format`, `revision`, matching `cacheMiss`.
- `PACK_ITEM_FORMAT = 1`.
- The stamp order is `profile`, `accessScope`, `format`, appended last in `packItem`.
- The access scope is a digest of the read scope (read lists, exclusions, secret globs).
- The revision miss covers a missing revision or a different one.
- Reuse applies only on a retry (item.ts:279).
- The report lists each refetched item with source, ID and reason.
- No ledger excerpt text is kept, so a fresh supervisor reuses nothing.

**Other integrations.md changes:**
- The credential helper row is right: `credential-helper-not-listed`, 5-second `HELPER_TIMEOUT_MS`, 16 KiB limit.
- "All four are built only when the GSD adapter exists" matches composition.ts:534.
- The `host-hook:attended` row is right.
- The settings-file refusals match attended-hook-install.ts (1 MiB cap, regular file, `hooks` an object, `hooks.PreToolUse` a list of objects).

**README ADR-017 row:**
- docs/decisions/ADR-017-ac8-brief-coverage.md exists, and the link target is correct.
- The "partly: findings.md" claim holds: findings.md:336 carries the figures under the brief-coverage rule (successes A 0, B 2, C 3 of 6; partial 2, 2, 1; tokens at 94.4% and 88.5%; the knowledge-pass reasoning). findings.md:271 carries the harness re-judgement.
- Those figures match ADR-017 decision 5.
- The row's "evaluation harness has no document" matches findings.md:271.
- The ADR-016 row also exists and resolves.
- The rewritten intro sentences and the coverage-status wording are consistent with coverage.md.

**Mechanical sweep:**
- No em dashes, en dashes or ` -- ` outside code spans, in all five documents plus data-model.md.
- No phase numbers, plan IDs, threat IDs or file paths in prose. Modules appear only once, in the openings.
- Headings are in sentence case.
- No changelog or "last updated" text.
- No instruction embedded in any document.
