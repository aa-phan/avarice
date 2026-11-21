# Round 2 dispositions

Groups A and C failed round 2 with one WARNING each; groups B, D and E passed. Each finding was checked against the code at HEAD before a document changed. Nothing is marked reviewed by this file; the status change in `coverage.md` follows a passing round. Groups B, D and E are not edited, because an edit would void their passing review.

## Group A (commit 797e579)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| W1 | WARNING | Fixed | Both Quirks sections now keep only what has no home in the body. `profiles-and-credentials.md` keeps the unwired credential broker, the two-store lock, the binding backfill race, the roots snapshot in the first `config.json` and the network-less helper. Removed as restated by the body: the two unread keys (table rows), the keychain and helper trimming and outcome lines (credentials section), the personal profile's unread organization file (`policy-and-approvals.md`). The one fact the body did not state, that a `config.json` the parser refuses ends the command with exit 70 (`composition.ts`, `failure()` on a failed profile resolution), moved into the configuration file section, beside the closed key set. `policy-and-approvals.md` keeps the scope-not-actor binding, the dangling attended start and the attended 5-second block; the six lines that restated the hook-versus-gate paragraph, the action count, the retry rule, the option binding and the enforcement map are removed. |
| N1 | NIT | Fixed | `NAME` in `policy.ts` is `/^[a-z0-9][a-z0-9._-]{0,63}$/`; the rule `id` and `action` sentence now says "starting with a letter or a digit". |
| N2 | NIT | Fixed | `enforcement-map.ts` gives the three platform rows the reason "Enforced by the platform that owns it" and the two host rows "not yet resolved by a containment test". The document now says the platform rows have no proof because the platform owns the control, and the host-limitation rows are unverified because the question is open. |
| N3 | NIT | Deferred | The reviewer notes the module-list openings follow the house rule and are not a defect. Left as written; a bullet list is optional polish. |

## Group C (commit 5026ed6)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| F1 | WARNING | Fixed | The only source for the statement that the host removes Glob and Grep from a session with a shell is the comment above `SEARCH_TOOLS_ALLOWED` in `launch-args.ts`; no test checks it. `containment.md` now says a code comment records it and no test checks it, and `integrations.md` says the same, so the two documents state one fact at one confidence. The checkable part (the line names Glob and Grep, and a different `--allowedTools` value is refused) is unchanged. |
| N1 | NIT | Fixed | The malformed code span at the start of the launch-line paragraph in `integrations.md` is a single code span, and the sentence names the code comment as the recorder. |
| N2 | NIT | Fixed | `data-model.md`: the stray leading space is gone and a blank line separates the restricted-host sentence from the list. |
| N3 | NIT | Fixed in part, rebutted in part | The git wrapper sentence in `integrations.md` that restated the refusals, the environment and the filter blanking now links to the git safety section of `containment.md` and keeps the timeouts, which are the integration's own. The resume line (the `--resume` flag form of the launch line) and the reap line (the exact `pgrep` and `ps` invocations with their timeouts) describe the call AVARICE makes, and already link to `containment.md` for how matches are signalled; they are the integration's own facts and stay. |

## Deferred NITs of passing groups

Not edited, so the passing reviews stay valid. All are optional polish and are carried to the documentation plan's final pass.

| Group | Id | Note |
|---|---|---|
| B | N-1 | `portability.md` Limits of the proof: say the tests configure 5 to 30 ms for the executor and 1 to 5 ms for the store (the 1 to 5 ms is passed by the callers, the fakes default to 5 to 30 ms). |
| B | N-2 | `coverage.md` lists `README.md` as reviewed although its tables changed; set it to drafted until round 2 is recorded, then reviewed. The status change is made when the groups are marked, which this stage does not do. |
| D | N1 | `cli-reference.md` schedule environment bullet is at the 35-word cap (36 by one count); move the LaunchAgent reason into its own sentence. |
| D | N2 | The lease time-to-live (180000 ms) is stated in three places across `config-reference.md` and `cli-reference.md`; keep one home and link. |
| E | 1 | `onboarding.md` project record enumeration is one long reference-list sentence; a bullet list is optional. |
| E | 2 | `processes.md` privileged action, step 2, is 37 words; split before "and tells the agent". |
| E | 3 | `onboarding.md` list item on a user-edited or unknown-format map is 36 words; split at the semicolon. |
