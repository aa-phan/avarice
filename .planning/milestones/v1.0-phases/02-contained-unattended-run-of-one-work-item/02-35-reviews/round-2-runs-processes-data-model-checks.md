Verdict: PASS

Severity terms: a **BLOCKER** cannot ship, a **WARNING** needs rework, and an **OBS** is worth noting.

**What I could not check.** I had only Read, Grep and Glob, so I computed no SHA-256 digests and this verdict is not tied to a file version. I did not render the PlantUML or run git. I also did not dispatch one `prose-reviewer` per file as the prose-review skill asks, because the brief allowed only three tools. I reviewed the four documents and the diagram myself in this one pass.

**Claims I verified against the code** (no BLOCKER or WARNING found):
- **runs.md lease section.**
  - When a renewal fails, the timer aborts the signal at `src/app/run-service.ts:133-139`. The loop's own renewal does the same at `:159-162`.
  - The host listens for the abort and sends SIGTERM to its process group, then SIGKILL after the grace, at `src/adapters/host-claude/claude-host.ts:298-319`.
  - The invocation is still settled and charged before the abort check, at `src/app/run-stages/item.ts:526-527`. The `conflict` error comes back before the classify checkpoint at `item.ts:532-535`.
  - `supervise` maps `conflict` to exit 3 at `src/cli/commands/supervise.ts:42-44`.
- **Reap step** (runs.md, processes.md step 4 and the diagram). A host with no reap, or a step with no session ID, returns an error at `src/app/run-resume.ts:83-84`. That error is recorded as a failed `resume:reconcile` step, with the cause in `detail`, at `run-resume.ts:305-325`. This agrees with `integrations.md` "Reaping by session ID".
- **Gated-item bullet.** The trailer check is at `src/app/run-stages/item.ts:422`. The check for exactly one parent, equal to the snapshot head, is at `item.ts:436-447`. Parents come from `src/adapters/git/run-workspace.ts:169-176`.
- **SIGTERM quirk.** Nothing in `src`, `bin` or `scripts` installs a signal handler, so Node's default SIGTERM exit applies. The wall clock is the supervisor's own timer, so it stops with the supervisor.
- **data-model.md budgets bullet.** `settleBudgets` writes all the charges and the optional event in one `tx` at `src/adapters/sqlite/ledger.ts:679-685`. `settleInvocation` and the orphan charge both use it, per `src/app/budget.ts:11-12, 111-122, 210-217`.
- **processes.md settlement steps.** A killed invocation is charged `max(reported, costCapUsd)` at `src/app/budget.ts:209`. The "killed" condition (timed out, a signal, or no result seen) is at `src/app/invocation.ts:153-160`.
- **checks-and-evidence.md.** `redactSecrets(output)` runs before `artifacts.put`, at `src/app/checks.ts:227-228`. The replacement form `[REDACTED:<kind>]` is at `src/domain/secret-patterns.ts:51-58`. No `docs/system` document still says check output is unfiltered.
- **Diagram syntax.** The new `alt` label uses `\n`, as `run-discard-retry.puml:24` and `run-to-ready.puml:21` already do.

**OBS**

1. **checks-and-evidence.md, the sentence "Secret-shaped strings in that text are replaced by `[REDACTED:{kind}]` before the artifact is stored, as in a transcript."**
   - Problem: the "Secret redaction" section of `containment.md` already owns this fact, and `containment.md:379` repeats it too. This document now restates it a third time without linking to the owner.
   - Fix: keep the clause and point "as in a transcript" to `containment.md#secret-redaction`, or replace the sentence with that link.
   - Confidence: medium.

2. **diagrams/run-resume-after-kill.puml, line 41 "Supervisor -> Host : find the process by session ID, end its group".**
   - Problem: this message sits before the `alt`, so it shows a host call on every path. In the new "cannot be reaped" branch the host is never called (`src/app/run-resume.ts:83-84` returns first).
   - Fix: move line 41 inside the `else ended or none found` branch, or label it "for each launch that can be reaped".
   - Confidence: medium.

3. **processes.md step 10, "except for an ending without a result, a signal or the wall clock".**
   - Problem: the code also charges at least the reservation when the adapter reports a `timeout` or `cancelled` error whose side effect is `unknown` (`src/app/invocation.ts:154-156`). The list leaves that case out.
   - Fix: add "or a host error that may have left it running", or leave the list as it is if that case is rare enough to omit.
   - Confidence: low.

4. **checks-and-evidence.md quirk "The check output is redacted only by the secret patterns."**
   - Problem: the executor reports `truncated` (`src/app/checks.ts:219`), and redaction runs on the text after the cap. A secret cut by the truncation boundary may therefore go unmatched. `findings.md:75` and `findings.md:209` record this limit for transcripts, but not for check output.
   - Fix: add a `findings.md` line for `src/app/checks.ts:228` once someone checks where the executor applies its cap.
   - Confidence: low; I did not read the executor's cap.

The changed passages agree with the code, and the new lease and reap text also agrees with `integrations.md` and the run-resume diagram's branch labels. Sentence lengths, dashes, headings, and the rule against file paths and delivery history all hold in the changed prose.
