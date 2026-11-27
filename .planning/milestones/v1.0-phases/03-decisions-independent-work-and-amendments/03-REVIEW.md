---
phase: 03-decisions-independent-work-and-amendments
reviewed: 2026-11-15T00:00:00Z
depth: standard
files_reviewed: 77
files_reviewed_list:
  - src/adapters/fs/profile-config.ts
  - src/adapters/git/run-workspace.ts
  - src/adapters/gsd/agents-json.ts
  - src/adapters/host-claude/claude-host.ts
  - src/adapters/host-claude/launch-args.ts
  - src/adapters/host-claude/launch-preflight.ts
  - src/adapters/host-claude/stream-json.ts
  - src/adapters/notify/local-notifier.ts
  - src/adapters/proc/ancestry.ts
  - src/adapters/schedule/launchd.ts
  - src/adapters/sqlite/ledger.ts
  - src/adapters/sqlite/migrations/0003-decisions.ts
  - src/app/amend.ts
  - src/app/cancel.ts
  - src/app/checks.ts
  - src/app/decide.ts
  - src/app/deps.ts
  - src/app/derive-spec.ts
  - src/app/digest.ts
  - src/app/invocation.ts
  - src/app/notify.ts
  - src/app/run-context.ts
  - src/app/run-gsd-config.ts
  - src/app/run-resume.ts
  - src/app/run-service.ts
  - src/app/run-stages/blocked.ts
  - src/app/run-stages/finish.ts
  - src/app/run-stages/item.ts
  - src/app/run-stages/park.ts
  - src/app/run-stages/prepare.ts
  - src/app/run-stages/repair.ts
  - src/app/run-stages/schedule.ts
  - src/app/run-stages/stage.ts
  - src/app/run-start.ts
  - src/app/run-status.ts
  - src/cli/args.ts
  - src/cli/commands/cancel.ts
  - src/cli/commands/contract.ts
  - src/cli/commands/decide.ts
  - src/cli/commands/digest.ts
  - src/cli/commands/resume.ts
  - src/cli/commands/schedule.ts
  - src/cli/commands/start.ts
  - src/cli/commands/supervise.ts
  - src/cli/composition.ts
  - src/cli/host-config-dir.ts
  - src/cli/identity.ts
  - src/cli/main.ts
  - src/cli/render/decision-view.ts
  - src/cli/render/run-view.ts
  - src/cli/shell/actions.ts
  - src/cli/shell/shell.ts
  - src/cli/spawn-supervisor.ts
  - src/domain/amendment.ts
  - src/domain/brief.ts
  - src/domain/conventions.ts
  - src/domain/decision-policy.ts
  - src/domain/evidence.ts
  - src/domain/gates.ts
  - src/domain/hook-decision.ts
  - src/domain/ids.ts
  - src/domain/invocation-scope.ts
  - src/domain/item-scope.ts
  - src/domain/notify-policy.ts
  - src/domain/outcome.ts
  - src/domain/quick-record.ts
  - src/domain/reproducer.ts
  - src/domain/response-validation.ts
  - src/domain/run-contract.ts
  - src/domain/run-lifecycle.ts
  - src/domain/run-shell-rules.ts
  - src/domain/state-digest.ts
  - src/domain/work-items.ts
  - src/ports/agent-host.ts
  - src/ports/ledger.ts
  - src/ports/notifier.ts
  - src/ports/run-workspace.ts
findings:
  critical: 0
  warning: 7
  info: 6
  total: 13
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-11-15
**Depth:** standard
**Files Reviewed:** 77
**Status:** issues_found

## Summary

I read the containment-critical files in full (hook admission, launch-argument judgement, process ancestry, response validation, the decision and cancel and amend apps, the ledger's Phase 3 transactions, the notifier, launchd, park/unpark) and the stage code in `item.ts` and `blocked.ts`. I read the remaining files through their Phase 3 diffs. `tsc -p .` is clean. `tsc --noUnusedLocals` flags one unused import and one unused variable in files of this phase (IN-01).

I found no defect that breaks containment on its own proof. The areas I attacked held up:

- **Hook shell lexer.** It refuses `$`, backtick, `\`, `;`, `&`, `<`, `>`, `(`, `)`, a leading `~`, and the glob characters, in both quoted and unquoted forms.
- **Agent-command matching.** Leading assignments are re-judged by program word, and the denied-prefix list and the never-granted words are applied after them (plan 03-64).
- **Launch arguments.** The `--allowedTools` exception is exact: bare flag, once, value `Glob,Grep`, and the `=` form refused.
- **Ledger.** Every decision transition is one transaction under the run lock with an `AND state = 'open'` guard. Answers re-check the contract version in the same transaction, and the state digest depends only on contract fields, so that check covers it.
- **Park/unpark.** Park paths are normalized, `.git` is refused, git receives `--` and literal pathspecs, and parents are checked for links.
- **launchd and osascript.** Both use fixed templates or argv, with validated values.

The findings below are correctness and robustness defects. WR-01 to WR-03 are the ones I would fix first. Items already recorded in `docs/system/findings.md` are not repeated (contract amend owner check, `bootout` ordering, run-wide blocks not continuable after amendment, `--allowedTools`, reap pattern breadth).

## Warnings

### WR-01: The run-process-tree signature matches any argument of any process in the chain, so a legitimate owner command is refused

**File:** `src/adapters/proc/ancestry.ts:23` and `:72`
**Issue:** `SUPERVISOR_SIGNATURE = / supervise run_[0-9A-Za-z]/` is tested against the whole `ps` command line of every process in the chain, starting with the CLI process itself. The pattern is not anchored to the end of the line, and nothing separates argv words from the text inside one argument. An owner answer such as `avarice decide dec_X --text "let the supervisor supervise run_01ABC again"`, or `contract amend run_X --reason "supervise run_Y once more"`, puts ` supervise run_0` into the process's own command line. `refuseOutsideTerminal` then refuses with "refused from inside a run's process tree", which is misleading and cannot be worked around except by rewording. The comment says the supervisor signature sits at the end of the line, which is why `cutCommand` keeps the tail, but the check never uses that property.
**Fix:** Anchor the match to the end of the command and require the `supervise` word to follow an entry path: `/ supervise run_[0-9A-Za-z]+$/`. Free text in the middle of a line then cannot match, although text ending a line still could. The robust fix is to stop deriving identity from text. The spawn already records the supervisor pid (`supervisor:spawn`, `supervisor:decide` and `supervisor:resume` steps). Compare the chain's pids with the pids recorded for runs that still hold a live lease, and keep the text signature only as a secondary check.

### WR-02: The owner-identity check rests on the ancestor chain plus an environment variable the caller controls

**File:** `src/cli/identity.ts:24-29`, `src/adapters/proc/ancestry.ts:70-73`
**Issue:** `decide`, `cancel`, `contract amend` and `schedule` decide "not a contained process" from three facts: `AVARICE_RUN` unset, stdin and stdout are TTYs, and no ancestor carries the supervisor signature. A descendant of the run that re-parents to pid 1 (double fork) drops the supervisor from its ancestry, can `unset AVARICE_RUN`, and could obtain a pseudo-terminal. All three checks then pass. The hook admits no daemonizing command, and the data root is presumably outside the sandbox's write set, so I could not prove an exploit. But a contract command such as `npm test` runs a repository script and could spawn such a process. The code comments describe the ancestry walk as "the one fact a run cannot hide", which overstates what it establishes.
**Fix:** Add a second, independent signal that a re-parented process cannot forge. Options are to deny the sandbox read and write access to the ledger, the data root and the `avarice` entry, and to assert that in the containment suite, or to bind the confirmation to something the run cannot reach, such as a check that the controlling terminal's session leader is not a process group the supervisor created. Reword the comment so it does not claim more than the walk proves.

### WR-03: An answer that is resumed instead of freshly started does not reset the item's retry and repair counts

**File:** `src/app/run-stages/item.ts:1339-1341`, `src/app/run-stages/repair.ts:239-240`, reason chosen at `item.ts:892`
**Issue:** `attemptHistoryOf` and `repairsOf` both start over "since the last `answer` attempt" and find it with `lastIndexOf('answer')`. The first attempt after an answered decision gets the reason `answer` only on the fresh-unit path. When the item has a session and a parked delta (the normal case), `reason` is `resume` (`RESUME_REASON`), which neither function recognizes. After the owner answers a `repeated_failure` decision, typically by an amendment raising the invocations budget, the resumed unit is gated. If its check fails again, `offerRepair` counts the earlier repair (`used 1 < limit 1` is false) and returns `null`. The owner is asked again straight away with no repair offered. The doc comments in both places say an answer "starts the item over".
**Fix:** Treat both reasons as the restart marker:
```ts
const RESTART = [ANSWER_REASON, RESUME_REASON];
const lastAnswer = Math.max(...RESTART.map((r) => attempts.value.map((a) => a.reason).lastIndexOf(r)));
```
Use it in both functions. `repair.ts` cannot import from `item.ts`, because `item.ts` imports `repair.ts`. Move the two reason constants to a shared module.

### WR-04: A killed supervisor between "decision opened" and "item blocked" leaves a window where the resume opens a second decision for the same question

**File:** `src/app/run-stages/blocked.ts:287-298`, `:300-318`
**Issue:** `completeItemBlock` is described as repeatable. Its idempotence rests on `openDecisionOf`, which only finds a decision that is still **open**. The decision is opened first (`openRecord`), and the item moves to `blocked_on_decision` later in the same function. No fault point covers the gap, and the owner can see the decision in `inbox` as soon as it is written. If the supervisor dies there and the owner answers, `answerDecision` releases nothing, because the item is not `blocked_on_decision` yet. On resume `resumeBlock` calls `completeItemBlock`. It finds no open decision for the item, builds the draft again and opens a second decision with the same question. The owner is asked twice and the first answer is ignored.
**Fix:** Look for the decision this attempt opened regardless of state. Record the decision ID on the park step, or on the `decision.opened` event that already carries `attemptId`. Resolve a recorded decision that is answered or withdrawn as already settled, release the item, and move on. At minimum, find an existing decision for this attempt in any state before opening a new one.

### WR-05: A Glob pattern with `..` segments is not judged against the read set

**File:** `src/domain/hook-decision.ts:138-145`, used at `:795`
**Issue:** For Glob the hook checks the search `path` and, only for an absolute pattern, the literal prefix as `patternRoot`. A relative pattern such as `../../../.ssh/*` with `path` inside staging passes both checks. `normalizeToolCall` never looks at `..` segments, and `canon` is not applied to the pattern's own directory. Whether the admitted host's Glob honors `..` in a pattern depends on its glob engine, and I could not verify it. The Read, Grep-path and shell paths all treat `..` as an escape, so this is the one read route that does not. A `{`-brace pattern whose first alternative is absolute (`{/etc/passwd,x}`) also has no `patternRoot`.
**Fix:** Compute `patternRoot` for every Glob pattern. Refuse (`unresolvable-path` or `outside-read-set`) any pattern that contains a `..` segment or an absolute path inside a `{...}` alternative. Otherwise resolve the literal prefix of a relative pattern against `path` and send it through `checkRead`.

### WR-06: The amendment sentinel is handed to the unit as "the owner's answer"

**File:** `src/adapters/sqlite/ledger.ts:1008` (writes `amended:v<n>`), consumed at `src/app/run-stages/item.ts:187-200` and `src/app/run-gsd-config.ts:142`
**Issue:** A decision answered by an amendment records `answer = "amended:v3"`. `answeredDecisionOf` treats any answered decision with a non-null answer as an owner answer. `resumeAnswerText` and `ownerAnswerText` pass the sentinel through unchanged. The resumed session is told, under "Decision recorded by the owner", that the answer is `amended:v3`. A fresh unit is told "The owner's answer: amended:v3". For a scope, budget or repeated-failure decision this is neither a choice nor text, and it names no consequence. A model is likely to read it as a refusal or an unknown token.
**Fix:** Detect the sentinel (`/^amended:v\d+$/` on `decision.answeredBy`/`answer`) and give the unit a sentence of AVARICE's own words, for example "The owner amended the contract (version 3): the limits or paths you were stopped on have changed. Continue the work item." Keep the sentinel out of the prompt.

### WR-07: A resumed attempt puts the parked delta back before the budget is granted

**File:** `src/app/run-stages/item.ts:947-996`
**Issue:** `launchUnit` unparks the item's delta into the clone (`unparkDelta`, line 948) and only afterwards calls `prepareRunInvocation`. When that returns `granted: false`, `blockRun` marks the item and the run blocked for `budget_exhausted`. The delta is left applied in the working tree and its park ref is still present. The clone is dirty, and the next consumer of the clone no longer starts from the item base the stage assumed. The fresh-unit path has no such window, since it changes nothing before the grant.
**Fix:** Reserve and record the invocation (`prepareRunInvocation`) before unparking, and unpark only when the grant succeeded. If the order has to stay, put the delta back out (`discard` to the snapshot) in the `!granted` branch before `blockRun`.

## Info

### IN-01: Unused import and unused variable

**File:** `src/app/run-stages/item.ts:60` and `:850`
**Issue:** `ReproducerSet` is imported as a type and never used. `contract` is destructured from `unit` in `attemptUnit` and never read (`tsc --noUnusedLocals`).
**Fix:** Drop `ReproducerSet` from the import and `contract` from the destructuring.

### IN-02: Formatting slip in a constant

**File:** `src/adapters/sqlite/ledger.ts:127` (`const DECISION_CLASSES: readonly string[] =[`)
**Issue:** Missing space before `[`, left by the edit that added `AMENDABLE_DECISION_CLASSES` above it.
**Fix:** `= [`.

### IN-03: The acceptance file is opened with a blocking read-only open

**File:** `src/cli/commands/contract.ts:118`
**Issue:** `openSync(resolve(path), O_RDONLY)` blocks until a writer appears when `path` names a FIFO, before the regular-file check at `fstatSync`. The path is the owner's own input, so this is a hang, not a vulnerability.
**Fix:** Open with `O_RDONLY | O_NONBLOCK` and check `isFile()` after `fstatSync`, or `lstat` first.

### IN-04: Run ID patterns differ between commands

**File:** `src/cli/commands/contract.ts:32` (`/^run_[0-9A-Za-z]+$/`) and `src/cli/commands/cancel.ts:24` (`/^run_[0-9A-Za-z]{4,64}$/`)
**Issue:** The same ID is validated by two different patterns, and `decide` uses a third form for decision IDs (`{4,64}` here, `+` in `contract.ts:33`). A malformed ID reaches the ledger in one command and is refused up front in the other.
**Fix:** Export one pattern per ID kind from `src/domain/ids.ts` and import it in the commands.

### IN-05: The value of a value flag cannot start with `--`

**File:** `src/cli/args.ts:50`
**Issue:** The word after `--text` or `--reason` is taken as the value unless it starts with `--`. An answer that starts with `--` (for example `--text "--force the first one"`) turns `--text` into `true` and the command reports "--text needs the text of the answer". This is not a safety issue, but the message hides the cause. The `--text=...` form works.
**Fix:** Name the `--flag=value` form in the usage and error messages of `decide` and `contract amend`.

### IN-06: `amendRunContract` does not cross-check the stored body against the version it writes

**File:** `src/adapters/sqlite/ledger.ts:1116-1120` (inserts `version = latest + 1` with `input.next.body` as given)
**Issue:** The transaction proves the base version is current, but it does not check that `body.contractVersion === version`. Today `applyAmendment` sets it to the base plus one, so they agree. A future caller that builds the body differently would store a contract whose own `contractVersion` disagrees with its row, and `storedContract` in `amend.ts` would then refuse every later amendment.
**Fix:** In the transaction, abort with `invalid` when `(input.next.body as { contractVersion?: unknown }).contractVersion !== version`.

---

_Reviewed: 2026-11-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
