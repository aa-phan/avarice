Verdict: BOUNCE

Severity: a **BLOCKER** cannot ship, a **WARNING** needs rework, an **OBS** is worth noting.

**Not checked:** I had only Read, Grep and Glob, so I ran no git, no tests and no shasum. This verdict therefore names no digest. It applies to the working-tree files as I read them. I read the code at the working tree, not only the round's diff.

**Verified against the code:**
- **Lease section:**
  - A failed renewal aborts the unit (`run-service.ts:133-140`, `:159-162`).
  - The process group gets SIGTERM, then SIGKILL after the grace (`claude-host.ts:298-319`).
  - The invocation is settled before the abort check, so it stays charged (`item.ts:526-532`).
  - The supervisor returns an error before it classifies anything (`item.ts:532`).
- **Reap step:** a missing reap capability or a missing session ID stops the resume. The cause is recorded in the failed reconcile step (`run-resume.ts:83-84`, `:305-314`).
- **Gated commit:** it must have exactly one parent, the snapshot head (`item.ts:436`).
- **SIGTERM quirk:** there is no SIGTERM handler under `src/cli` or `src/app`.
- **Budgets bullet:** `settleBudgets` runs as one transaction with an optional event (`ledger.ts:679-685`). The orphan event goes through it (`budget.ts:112-125`), and so does the settlement (`budget.ts:211`).
- **Kill rule:** no result, a signal or the wall clock means "killed" (`invocation.ts:153-160`). A killed unit is charged `max(reported, costCapUsd)` (`budget.ts:209`).
- **Onboarding reap skip:** still in place (`resume.ts:29`).
- **Check output redaction:** applied by `redactSecrets` (`checks.ts:228`) with `[REDACTED:<kind>]` (`secret-patterns.ts:53-58`).

### WARNING

1. **The run resume diagram contradicts the changed reap text**
   - **Location:** `docs/system/diagrams/run-resume-after-kill.puml:45`. processes.md step 4 points to this diagram ("The flow is drawn in run-resume-after-kill.puml"), and runs.md reap step 1 makes the same claim.
   - **Problem:** The diagram's branch "else ended, none found, or the host cannot reap" leads to "launch rows marked interrupted". The changed text and the code say a host with no reap capability stops the resume: `run-resume.ts:83` returns an error, and `reconcileRun` records a failed `resume:reconcile` step. The diagram also leaves out the stop when a launch step has no session ID (`run-resume.ts:84`).
   - **Fix:** Move "the host cannot reap, or the step recorded no session ID" into the failure branch with "the reap fails" (failed reconcile step, rows stay started, exit 70). Keep "ended or none found" in the marking branch.
   - **Confidence:** high.

2. **processes.md step 10 puts the transcript inside the settlement transaction**
   - **Location:** processes.md, onboarding flow step 10: "the invocation settles in one ledger transaction: the unit, the measured duration and the cost are charged, and the transcript is stored redacted."
   - **Problem:** As written, storing the transcript is part of the one transaction. It is not. `settleBudgets` (`ledger.ts:679-685`), called from `budget.ts:211-215`, holds only the three budget charges. `finishInvocation` stores the transcript artifact and records the step after the settlement returns (`invocation.ts:179-185` and the lines after).
   - **Fix:** Split it: "When the host exits, the invocation settles: the unit, the measured duration and the cost are charged together in one ledger transaction. The transcript is then stored redacted."
   - **Confidence:** high.

### OBS

3. **Two terms for one amount**
   - **Location:** processes.md step 10 ("charged at least the cost reservation") and the discard-and-retry flow step 1 ("charged at least its cost cap").
   - **Problem:** Both mean the same amount, `reservation.costCapUsd` (`budget.ts:209`). That amount is the smaller of the per-invocation cap and what is left. "Cost cap" also names the host's budget flag in containment.md, so the two terms invite confusion.
   - **Fix:** Use one term in both steps, preferably "cost reservation" as data-model.md and containment.md use it.
   - **Confidence:** medium.

4. **"Stops with an error" does not say what the operator sees**
   - **Location:** runs.md, Supervisor and lease: "the supervisor stops with an error before it judges the unit."
   - **Problem:** The sentence is true, but the lost lease comes back as a `conflict` error (`item.ts:532`). `supervise` turns that into exit 3 and the line "is held by another supervisor; its lease must expire first" (`supervise.ts:42-44`). It is not the exit 70 an "error" suggests.
   - **Fix:** Optionally add: "`supervise` exits 3, reporting the run as held by another supervisor."
   - **Confidence:** medium.

5. **The SIGTERM quirk overstates how the host ends and what aborts it**
   - **Location:** runs.md quirk: "The unit's host keeps running until the next resume reaps it by session ID. Only a lost lease aborts the unit."
   - **Problem 1:** The host can also exit by itself. Once the supervisor is gone, nothing enforces the wall clock, because the timer lives in the adapter inside the supervisor (`claude-host.ts:314-315`).
   - **Problem 2:** "Only" leaves out the wall clock, which also ends the unit.
   - **Fix:** "The unit's host keeps running, with no wall clock enforced, until it exits or the next resume reaps it by session ID." Also drop "Only", or limit the claim to supervisor-side causes.
   - **Confidence:** medium.

6. **A hard-to-read quirk sentence in checks-and-evidence.md**
   - **Location:** checks-and-evidence.md quirk: "A secret that does not match one of them (a password with no recognizable shape, for example) that a check prints from its environment is written into the run's artifact store."
   - **Problem:** The two relative clauses on either side of the parenthesis make the sentence hard to parse.
   - **Fix:** "A check that prints a secret from its environment writes it into the run's artifact store when the secret matches no pattern, such as a password with no recognizable shape."
   - **Confidence:** high.

I found no dashes, no delivery history, no file paths or function names, and no sentence over 35 words in the changed prose. Apart from finding 1, every reference to an old claim elsewhere in docs/system now agrees with the changed text. That includes `integrations.md:144` and `findings.md:139`, and onboarding.md, which keeps the reap skip for onboarding only.
