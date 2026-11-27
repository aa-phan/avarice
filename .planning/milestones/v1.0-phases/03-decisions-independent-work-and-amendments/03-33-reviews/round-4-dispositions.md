# Round 4 dispositions

Author of the drafts: the plan executor. Each finding of the round 4 report (`round-4-A.md`, group A, `findings.md` only) was checked against the code at `6b82bb6` before it was acted on. Decisions: fixed (the document was edited), applied (an optional nit was applied), no action (left on purpose). No finding was routed and no code was changed.

The reviewer returned needs-changes: 0 BLOCKER, 5 WARNING (four about code behaviour, one citation), 5 OBS. The WARNINGs force round 5, the last round the limit allows. Commits: report `fca03cb`; the document fixes `84bd6de`; this file and the review table follow in the next commit. Line numbers below are lines of `docs/system/findings.md`, which stays at 303 lines.

## Group A: findings.md

| Group | ID | Decision | Evidence or change |
|---|---|---|---|
| A | W-A | fixed | Confirmed: `src/domain/outcome.ts:69` returns `paused` when `pauseSignal === true`. `pauseSignal` is set only in `src/app/run-stages/item.ts` (`:407`, `:433`); the only other `classifyOutcome` caller, `src/adapters/host-claude/claude-host.ts:227`, passes none. Line 49 now says no onboarding stage passes a `pauseSignal`, so the classifier never returns `paused` to the map stage, and cites `outcome.ts:69` and `item.ts:407`. The map-stage branch at `map.ts:107` stays unreachable. |
| A | W-B | fixed | Confirmed: `ADMITTED_CLAUDE_VERSIONS` at `src/adapters/host-claude/launch-preflight.ts:24` lists 2.1.312, 2.1.316, 2.1.317, 2.1.318 and 2.1.319. Line 78 now names 2.1.317, 2.1.318 and 2.1.319 as the versions beyond the proposal and cites the list. |
| A | W-C | fixed | Confirmed: `src/adapters/exec/seatbelt-profile.ts:84` emits an `allow network-outbound` rule for `localhost:<port>`. Line 89 now ends with a sentence marking the network part as no longer holding and pointing to the run slice section, in the form of lines 9, 10 and 91. The `sandbox-exec` and caller env parts were not re-judged. Line 189 still names line 89 as stale for the same fact, which is now consistent. |
| A | W-D | fixed | Confirmed: `DecisionClassName` at `src/domain/decision-policy.ts:50` holds `acceptance`, `scope_expansion`, `permission`, `repeated_failure` and `budget`, so only `architecture` differs. The proposal row naming `scope_expansion` or `architecture` is `docs/autonomy-and-decisions.md:40`; `:54` is the `human` class row. Line 297 now says the class name `architecture` is not among the five the code writes and cites `:40`. |
| A | W-E | fixed | Confirmed: `src/adapters/fs/profile-paths.ts:62` is `configHome: pick(...)`, a path lookup. The write is `writeFileSync(..., { flag: 'wx' })` inside the `try` that starts at `:90`, with the call at `:91`. Line 25 now cites `:91`. A range `:87` to `:96` was tried first and dropped: `verify` flagged its end line (`);`), which shares no word with the claim, and a single line is enough. |
| A | O-1 | applied | Confirmed: `EXIT_INTERNAL = 70` is `src/cli/composition.ts:51`, and `src/cli/main.ts:18` shows only `EXIT_USAGE`. Line 168 now adds `70 is EXIT_INTERNAL at src/cli/composition.ts:51`. |
| A | O-2 | applied | Line 282 dropped the clause "at the pass's code state"; the sentence now ends "that still hold." |
| A | O-3 | applied | The heading at line 106 now reads "From review". No other file cites the old heading. |
| A | O-4 | no action | The duplicates (reaping, `findGraphifyBinary`, the fixed PATH) are acknowledged on their first lines and the reviewer left them. One home each would drop findings the owner may want to see in both slices. |
| A | O-5 | no action | The reviewer accepted `src/cli/main.ts:68` as inside the block. |

## Checks run after the edits

- `round-3-sentence-check.py docs/system/findings.md`: 544 sentences, 0 over 35 words.
- `round-3-citation-check.py verify`: 549 citations extracted, 418 current, 0 failures. As `round-3-citation-check.md` now states, this tests existence, range, non-blank content and a loose word overlap only. It does not show that a citation supports its claim.
- No em dash, en dash or ` -- ` outside code spans (lines 74 and 216 hold `pgrep -f --` inside code).
- Each changed line (25, 49, 78, 89, 168, 282, 297) was re-read against the code or proposal line it cites.

## Other documents touched

- `round-3-citation-check.md`: the statement that all 410 current citations "land" and "support" their claims is replaced. A new section, "What the check does not prove", names what the script tests, says it cannot judge meaning, and cites `round-4-A.md`. The script is kept.
- `docs/system/coverage.md`, Per-document status: the sentence that each reviewer bounced its first draft except one, and that no document was bounced twice, is replaced by two sentences that describe the repair-and-reread rounds and point to `03-33-reviews/README.md`. `findings.md` stays `drafted`.

## Next

`findings.md` goes to round 5, the last round of the limit. The reviewer is asked for a targeted recheck of lines 25, 49, 78, 89, 168, 282 and 297 and a read of any other line the diff against `6b82bb6` touches. If round 5 still returns a WARNING about code behaviour, the remaining items are reported for the owner and `findings.md` is marked `reviewed with open items`.
