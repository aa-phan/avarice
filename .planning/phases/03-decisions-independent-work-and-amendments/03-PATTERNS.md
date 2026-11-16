# Phase 3: Decisions, independent work and amendments - Pattern Map

**Mapped:** 2026-11-08
**Files analyzed:** 41 (new and modified)
**Analogs found:** 38 / 41
**Tracked-source gate:** every analog path below is under `src/` or `test/` and appears in `git ls-files`. No `.gsd/capabilities` mirror path is named.

Line numbers refer to the worktree at commit 850eaf0. Excerpts below were read this session; for the rest, the analog is named with the symbol to grep.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/domain/work-items.ts` (new) | domain, pure | transform | `src/domain/gates.ts` (pure verdict style), `src/domain/run-lifecycle.ts` | role-match |
| `src/domain/decision-policy.ts` (new) | domain, pure | transform | `src/domain/outcome.ts` (`classifyOutcome`, `detectPause`) | role-match |
| `src/domain/state-digest.ts` (new) | domain, pure | transform | `src/domain/digest.ts` + inline digest in `blocked.ts:74` | exact |
| `src/domain/response-validation.ts` (new) | domain, pure | request-response | `src/domain/gates.ts` (`GateVerdict` shape, fixed rule order) | role-match |
| `src/domain/gates.ts` (modify: G1, G3) | domain, pure | transform | `evaluateG2` in same file | exact |
| `src/domain/amendment.ts` (new) | domain, pure | transform | `globWithin`/`withinAny` and narrowing in `src/domain/run-contract.ts`; `src/domain/policy-narrowing.ts` | role-match |
| `src/domain/notify-policy.ts` (new) | domain, pure | transform | `src/domain/run-lifecycle.ts` (tables + pure functions) | partial |
| `src/domain/brief.ts` (modify: `items`) | domain, parser | transform | same file `parseFrontmatter` (:53, :124-129) | exact |
| `src/domain/run-contract.ts` (modify) | domain | transform | same file (`ROUTINE_PRESET`, `OVERRIDE_LIMITS`, compile ~:443) | exact |
| `src/domain/run-lifecycle.ts` (modify) | domain | state machine | same file (item edges :145-154) | exact |
| `src/ports/ledger.ts` (modify) | port | CRUD | same file (:634-663) | exact |
| `src/ports/notifier.ts` (new) | port | event-driven | `src/ports/agent-host.ts`, `src/ports/run-workspace.ts` | role-match |
| `src/adapters/sqlite/ledger.ts` (modify) | adapter | CRUD, transaction | `openDecision` (:1184-1224), `storeRunContract` | exact |
| `src/adapters/sqlite/migrations/0003-decisions.ts` (new) | migration | CRUD | `migrations/0002-run.ts` | exact |
| `src/adapters/notify/local-notifier.ts` (new) | adapter | request-response (child process) | `src/adapters/host-claude/claude-host.ts` (`/bin/ps` shell-out), `src/adapters/git/safe-git.ts` | role-match |
| `src/adapters/schedule/launchd.ts` (new) | adapter | file-I/O | `src/adapters/host-claude/skill-install.ts` (writes user files), `src/adapters/fs/artifact-store.ts` | role-match |
| `src/adapters/proc/ancestry.ts` (new) | adapter | request-response | `reapBySessionId` in `claude-host.ts` (`/bin/ps -o pgid=`) | role-match |
| `src/adapters/git/run-workspace.ts` (modify: park/unpark) | adapter | file-I/O | same file (`snapshot`, `discard`, `changedSince`) and `src/ports/run-workspace.ts` | exact |
| `src/adapters/host-claude/{launch-args,claude-host,stream-json}.ts` (modify) | adapter | streaming | same files | exact |
| `src/app/run-stages/item.ts` (modify: scheduler loop) | app stage | request-response | same file (889 lines) | exact |
| `src/app/run-stages/blocked.ts` (modify) | app stage | CRUD | same file | exact |
| `src/app/run-stages/finish.ts` (modify: `itemId = 'A'` at :57) | app stage | request-response | same file | exact |
| `src/app/run-stages/park.ts`, `repair.ts` (new) | app stage | file-I/O | `src/app/run-stages/discard.ts` | role-match |
| `src/app/decide.ts` (new) | app service | request-response | `src/app/run-resume.ts` (`resumeRun`) | role-match |
| `src/app/amend.ts` (new) | app service | CRUD | `src/app/run-start.ts` (contract compile + store) | role-match |
| `src/app/cancel.ts`, `notify.ts`, `digest.ts` (new) | app service | request-response | `src/app/run-status.ts` (`getInbox`), `src/app/run-resume.ts` | partial |
| `src/app/run-gsd-config.ts` (modify prompt) | app | transform | same file (`RUN_WORKFLOW_SENTENCE`, `contractText`) | exact |
| `src/cli/commands/decide.ts` (new) | CLI command | request-response | `src/cli/commands/resume.ts` | exact |
| `src/cli/commands/contract.ts` (new) | CLI command | request-response | `src/cli/commands/resume.ts`, `install-host.ts` (`usage()` + `AVARICE_RUN` refusal) | role-match |
| `src/cli/commands/digest.ts`, `schedule.ts`, `cancel.ts` (new) | CLI command | request-response | `src/cli/commands/inbox.ts` (read-only), `resume.ts` | role-match |
| `src/cli/main.ts` (modify `COMMANDS`, :12) | CLI | config | same line | exact |
| `src/cli/shell/actions.ts` (add Decide) | CLI shell | request-response | existing `ShellAction` entries in same file | exact |
| `src/cli/render/run-view.ts` (modify `renderInbox`) | CLI render | transform | same file | exact |
| `test/unit/*.test.ts` for each new domain file | test | transform | `test/unit/gates.test.ts`, `test/unit/run-lifecycle.test.ts`, `test/unit/brief.test.ts` | exact |
| `test/integration/run-decide.test.ts`, `run-amend.test.ts`, `run-scheduler.test.ts` (new) | test | request-response | `test/integration/run-supervisor.test.ts`, `run-outcomes.test.ts` | role-match |
| `test/fault/decide-race.test.ts`, kill points for park and decide (new) | test | fault injection | `test/fault/run-killpoints.test.ts` + `test/helpers/fault-run.ts` | exact |
| `test/helpers/fake-run-host.ts` (modify: multi-item, resume) | test helper | streaming | same file | exact |
| `test/helpers/live-harness.ts` (modify: Phase 3 ledger) | test helper | file-I/O | same file :205-240 (`PHASE2_CEILING_USD`) | exact |
| `test/unit/footprint.test.ts` (modify allow-list) | test | static scan | same file :88-103 | exact |
| `test/benchmark/portfolio/*` briefs (new) | fixture | n/a | `test/benchmark/r1/*.md`, `test/benchmark/portfolio/avarice-config.json` | role-match |
| `docs/system/*` (documentation plan) | docs | n/a | existing `docs/system/*.md`, `coverage.md`, `findings.md` | exact |

## Pattern Assignments

### `src/app/run-stages/blocked.ts` (modify: richer decision record)

**Analog:** itself (111 lines). It is the one place the decision, item edge and run edge are written (header :1-5).

**Core pattern to keep** (lines 63-110): `storedText` the issue, `openDecision`, transition the item to `blocked_on_decision` unless `done` or already blocked, `endRunAttempt` tolerating `conflict`, then `ctx.transition(current.value, 'blocked_on_decision', 'none', {...})`.

**What changes (exact lines):**
```typescript
// :44   const itemId = options.itemId ?? 'A';            -> required itemId from the scheduler
// :70-71 options: [], consequences: {},                  -> from classifyDecision (options parsed from the pause)
// :73   affectedItems: [itemId],                         -> itemId + transitive dependents (stored fact)
// :74   stateDigest: digestOf({ contractVersion: stored.value.version, baseRevision: contract.workspace.baseRevision, policyRevision: contract.policyRevision }),
//                                                         -> computeStateDigest(contract, version) shared with decide
```
Also write `work_items.gsd_session` from the invocation's session ID here (transitionWorkItem already accepts optional `gsdSession`).

---

### `src/domain/gates.ts` (modify: G1, G3) and `src/domain/gate-g1.ts` / `gate-g3.ts`

**Analog:** `evaluateG2` (gates.ts:67), `GateFailure`/`GateVerdict` (:9-17), rule list constant (:19-28).

**Shape to copy:**
```typescript
export const G1_RULES = ['plan-within-spec', 'plan-within-write-scope', 'decision-checkpoint-unresolved'] as const;
export interface G1Facts { /* measured facts only */ }
export function evaluateG1(facts: G1Facts): GateVerdict {
  const failures: GateFailure[] = [];
  const fail = (rule: (typeof G1_RULES)[number], detail: string): void => { failures.push({ rule, detail }); };
  // sort every input list before judging so order never changes the verdict (gates.ts:77-82)
  ...
  return { passed: failures.length === 0, failures };
}
```
Reuse `matchesAny` from `./glob.ts` and `listPaths` capping (:58-63). Header rule (:1-4): a model-written text is never an input that can pass a gate. Test analog: `test/unit/gates.test.ts` (deep-equal verdict under shuffled input).

---

### `src/domain/brief.ts` (modify: `items`)

**Analog:** itself.

**Excerpt** (:52-53, :124-129):
```typescript
const FRONTMATTER_KEYS: readonly string[] = ['title', 'size', 'model', 'baseRevision', 'expectedDecisions'];
...
    if (!FRONTMATTER_KEYS.includes(key)) return invalid(`brief.frontmatter.${key}`, 'unknown frontmatter key');
    if (Object.hasOwn(front, key)) return invalid(`brief.frontmatter.${key}`, 'repeated frontmatter key');
    front[key] = (match[2] as string).trim().replace(/^(["'])(.*)\1$/, '$2');
```
Add `'items'` to the keys, join indented continuation lines, `JSON.parse` once, and validate every field (RESEARCH Pitfall 9). Errors use `invalid('brief.items[<n>].<field>', reason)`. Leave `items` out of the digested content when absent so Phase 2 digests do not move. Test analog: `test/unit/brief.test.ts`.

---

### `src/domain/run-contract.ts` (modify)

**Analog:** itself. Touch points from CONTEXT: `ROUTINE_PRESET` (~:75-124, `repairAttemptsPerCheck: 0` becomes 1), `OVERRIDE_LIMITS` (:219-227, takes scaled limits as input), `RunContract` interface (:136-138, `contractVersion: 1` becomes `number`), compile emitting single item `A` (~:443-451, becomes N items), `globWithin`/`withinAny` for `--add-write` containment. A stored contract keeps its stored `policyRevision`; amend copies it. Test analog: `test/unit/run-contract.test.ts` (pins will move).

---

### `src/domain/run-lifecycle.ts` (modify)

**Analog:** itself. Add item edge `implemented -> delegated` (repair) near :145-154, multi-item block reasons and `RUN_NEXT_ACTIONS` forms. The `blocked_on_decision -> ready` item edge and `blocked_on_decision -> running` run edge exist already. Test analog: `test/unit/run-lifecycle.test.ts`, `test/unit/transitions.test.ts` (every edge asserted).

---

### `src/domain/work-items.ts` (new)

**Analog:** `src/domain/run-lifecycle.ts` (pure tables) and `evaluateG2` (sorted inputs, pure). RESEARCH Pattern 1 sketch is the shape:
```typescript
export function readyItems(items: readonly ItemFacts[], openAffected: ReadonlySet<string>): ItemFacts[] {
  const done = new Set(items.filter((i) => i.state === 'done').map((i) => i.itemId));
  return items.filter((i) => i.state === 'ready' && !openAffected.has(i.itemId) && i.dependsOn.every((d) => done.has(d)));
}
```
Imports only domain files and `./result.ts` (boundary rule: domain touches no `process`; `node scripts/check-boundaries.ts` stays green).

---

### `src/domain/decision-policy.ts` (new)

**Analog:** `src/domain/outcome.ts` (`detectPause` reads the first ~2000 chars of final text, `classifyOutcome` over measured facts, never model confidence). Class table: RESEARCH Pattern 3. Ledger accepts eight classes (`src/adapters/sqlite/ledger.ts:102`, `DECISION_CLASSES`); `RunDecisionClass` in `blocked.ts:17` currently uses four. Strip with `storedText` from `src/domain/quick-record.ts`.

---

### `src/adapters/sqlite/ledger.ts` and `src/ports/ledger.ts` (modify: answer, stale, withdraw, amend, notifications)

**Analog:** `openDecision` (ledger.ts:1184-1224).

**Pattern to copy for every new mutating method:**
```typescript
answerDecision(input: ...): Result<DecisionRow> {
  return tx(this.db, () => {
    this.lockRun(input.runId);                       // lock first
    /* validate with abort({ kind: 'invalid', field, reason }) */
    this.db.prepare(`UPDATE decisions SET ... WHERE decision_id = ? AND state = 'open'`).run(...);
    // item blocked_on_decision -> ready in the same transaction
    this.insertEvent({ type: 'decision.answered', runId, data: { runId, decisionId, ... }, nowMs });  // IDs and counts only
    return toDecision(this.db.prepare('SELECT * FROM decisions WHERE decision_id = ?').get(decisionId) as Row);
  });
}
```
Port side: add the method signatures next to `openDecision`/`listDecisions` (ports/ledger.ts:661-663). `amendRunContract` (optimistic: expected contract version, run state check, no lease fence) inserts version n+1 with `authorized_by`, `reason`, `diff_json`, UPDATEs `budgets.limit_value`/`contract_version`, and appends `stale` evidence rows, all in one `tx`. Update the port comment that says nothing raises a limit (D-19). Events: strings max 1024 chars, data 8192. Evidence and gate tables refuse UPDATE and DELETE by trigger (`migrations/0002-run.ts`); only append. Test analogs: `test/integration/run-ledger.test.ts`, `test/mutation/ledger-and-record.test.ts`.

---

### `src/adapters/sqlite/migrations/0003-decisions.ts` (new)

**Analog:** `src/adapters/sqlite/migrations/0002-run.ts`; registry and test in `src/adapters/sqlite/migrate.ts`, `test/fault/migrations.test.ts`, fixture `test/fixtures/db/schema-v1.sqlite`. Content per RESEARCH: `notifications` table, `attempts.item_id`. Add a count to the coverage denominators (tables 23, event kinds 28).

---

### `src/cli/commands/decide.ts` (new)

**Analog:** `src/cli/commands/resume.ts` (exact for exit codes, `usage`, spawn path, `--wait`).

**Imports and constants** (resume.ts:11-24):
```typescript
import { describeError } from '../../adapters/sqlite/db.ts';
import type { AppDeps } from '../../app/deps.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { errorLine, outcomeLines, resultLine, stripControl } from '../render/style.ts';
import { spawnSupervisor, supervisorEnv, waitForRun } from '../spawn-supervisor.ts';
const EXIT_NOT_ACTIVE = 3;  const EXIT_USAGE = 64;  const EXIT_INTERNAL = 70;
export const booleanFlags: readonly string[] = ['wait'];
function usage(io: Io, message: string): number {
  io.err(`${errorLine('resume', message)}\nusage: avarice resume <onboardingId | runId> [--wait]\n`);
  return EXIT_USAGE;
}
```
**Command shape and error mapping** (resume.ts:71-85): `not_found` -> 64, `conflict` -> 3, anything else -> 70, always `errorLine(cmd, describeError(e))`.

**Pickup** (resume.ts:95-108): spawn only when no live lease; record a step after spawn:
```typescript
const spawned = spawnSupervisor({ entry: process.argv[1] ?? '', runId, env: supervisorEnv(deps), cwd: deps.profile.dataRoot });
if (!spawned.ok) { io.err(`${errorLine('decide', `...: ${spawned.message}`)}\n`); return EXIT_INTERNAL; }
deps.ledger.recordRunStep(runId, { step: 'supervisor:resume', attempt, status: 'completed', result: { pid: spawned.pid }, nowMs, completedAtMs: nowMs });
```
`decide` must go through `spawnSupervisor` (spawn-supervisor.ts:24-42), the only detached spawn. Update `test/unit/footprint.test.ts:88-103` importer allow-list from `['resume.ts', 'start.ts']` to include `decide.ts`.

**Identity** (D-14, RESEARCH "Identity check"): one function in the CLI layer used by decide, amend, schedule and cancel: TTY on stdin and stdout, `env['AVARICE_RUN'] === undefined`, profile owner uid equals `process.getuid()`, ancestry walk via the new `proc/ancestry.ts`. Copy the `AVARICE_RUN` usage from `src/cli/commands/install-host.ts` `usage()`. A rejected response is recorded as an event.

---

### `src/cli/commands/contract.ts` (new; `contract amend <run>`)

**Analog:** `resume.ts` for structure, `install-host.ts` for the refusal. Parse typed flags (`--budget cost=8`, `--add-write`, `--acceptance-file`, `--check +lint`, required `--reason`) through `src/cli/args.ts`; print diff and invalidation preview, then confirm on the terminal. Refusals create no row and no file (STATE pattern).

---

### `src/cli/commands/digest.ts`, `schedule.ts` (new)

**Analog:** `src/cli/commands/inbox.ts` (read-only exports and `--json`):
```typescript
export const readOnly = true;
export const booleanFlags = ['json'] as const;
export function usage(args: ParsedArgs): string | undefined { ... }
export function run(args: ParsedArgs, deps: AppDeps, io: Io): number {
  const inbox = getInbox(deps.ledger);
  if (!inbox.ok) { io.err(`${errorLine('inbox', `failed: ${describeError(inbox.error)}`)}\n`); return 70; }
  ...
}
```
`digest` reuses `getInbox` (`src/app/run-status.ts`) and prints nothing when empty. `schedule` is not read-only (writes a plist), so omit `readOnly`. Register all four commands in `COMMANDS` at `src/cli/main.ts:12`; the header says a command is added by adding its file, but the allowlist constant still needs the name.

---

### `src/cli/shell/actions.ts` (add Decide)

**Analog:** existing `ShellAction` objects (interface at :19-26: `id`, `keys`, `label`, `run(ctx)`). The action runs the command module in-process through `main()` via the `ActionContext`, the same as start and resume. Keys test analog: `test/helpers/pty-drive.py`, `test/integration/shell-tty.test.ts`, `test/unit/shell.test.ts`.

---

### `src/adapters/host-claude/*` (modify: resume, final text, reap)

**Analog:** same files. Per RESEARCH Pitfall 4: `buildLaunchArgs` emits `--resume <id>` instead of `--session-id` when `resumeSessionId` is set (`--resume` already in `VALUE_FLAGS` at launch-args.ts:83, not in `WIDENING_FLAGS` :88); `reapBySessionId` also matches `--resume <uuid>`; `StreamJsonParser` keeps a bounded tail (about 2000 chars) of the result text only for `InvocationOutcome.question`. Add `ADMITTED_CLAUDE_VERSIONS` handling at `launch-preflight.ts:22` (or pin 2.1.318 via `AVARICE_CLAUDE_BIN`). Test analogs: `test/unit/launch-args.test.ts`, `test/unit/stream-json.test.ts`, `test/integration/resume-reap.test.ts`, `test/fixtures/claude-fake/claude-replay.mjs`.

---

### `src/adapters/notify/local-notifier.ts` (new)

**Analog (no close one):** shell-out style of `reapBySessionId` in `claude-host.ts` (`/bin/ps`). Use the argv-only form verified in RESEARCH:
```typescript
execFile('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'display notification (item 1 of argv) with title (item 2 of argv)', '-e', 'end run', '--', text, title], { timeout: 10_000 }, cb);
```
Text is AVARICE-owned words only, through `stripControl` and a length cap. No `detached`, no `unref()` (footprint test). A failure appends an event and leaves the decision open.

---

### `src/app/run-stages/park.ts` and `src/adapters/git/run-workspace.ts` (park/unpark)

**Analog:** `src/app/run-stages/discard.ts` (102 lines; recovery with `discard`, step recording, `faultPoint`) and the `RunWorkspace` port `src/ports/run-workspace.ts` (`snapshot`, `discard`, `changedSince`, `restorePaths`, `removeUntracked`). Add `park`/`unpark` to the port and adapter; record a `park` run step with tree ID and paths; keep a ref so gc cannot drop it. Test analog: `test/integration/run-workspace.test.ts`, `test/fault/run-discard-retry.test.ts`.

---

### `src/app/run-stages/item.ts` (modify: scheduler loop)

**Analog:** itself. Header (:1-21) documents the stage list (context-pack, launch:run, classify, discard-attempt, gate:g2, commit). Replace the exactly-one-item check (`loadUnit`, ~:70) with `readyItems`, pass the explicit item ID into every step, finish each item with `running -> running` (supervisor errors on a stage that makes no progress, `run-service.ts`). Keep `faultPoint` calls at each side-effect boundary (imported from `../onboarding-service.ts`). Every `'A'` literal: `blocked.ts:44`, `finish.ts:57`, plus `items[0]` sites in baseline and resume prelude (RESEARCH Summary).

---

### Test patterns

- **Kill-point and race suites:** `test/fault/run-killpoints.test.ts` header (:1-12) and its imports from `test/helpers/fault-run.ts` (`RUN_KILL_POINTS`, `runRunWithFault`, `resumeRunCli`, `ledgerInterruption`, `normalizeRunResult`). Add decide and park points to `RUN_KILL_POINTS`; one case at a time, no tolerance, compare with an uninterrupted reference run.
- **Fake host:** `test/helpers/fake-run-host.ts` `FakeRunOptions` (`edits`, `summary`, `verification`, pause question, per-attempt behaviour). Add per-item behaviour and a resume path. Every tool call goes through the real hook.
- **Fixtures:** `test/helpers/run-fixtures.ts` (`makeRunRepo`, `onboardRunRepo`, `startWithFakeRunHost`, `writeBrief`), `test/helpers/run-cli.ts` (`makeRoots`).
- **Phase 3 live spend ledger (D-05):** copy `test/helpers/live-harness.ts:205-240` (Phase 2 block):
```typescript
export const PHASE2_CEILING_USD = 25;
export const phase2LedgerPath = (): string => process.env['AVARICE_PHASE2_LEDGER'] ?? join(REPO_ROOT, 'test', 'containment', 'live-spend-phase2.jsonl');
// AVARICE_PHASE2_CEILING_USD may lower the ceiling and never raise it; anything that is not a positive number is ignored.
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, PHASE2_CEILING_USD) : PHASE2_CEILING_USD;
```
  Rename to `PHASE3_*`, `AVARICE_PHASE3_LEDGER`, `AVARICE_PHASE3_CEILING_USD`, file `test/containment/live-spend-phase3.jsonl`, and add a Phase 3 branch to `spendRefusal` (:196-200). Record cases in `test/containment/LIVE-CASES.md` style.
- **Benchmark briefs:** `test/benchmark/r1/*.md` for brief format, `test/benchmark/portfolio/avarice-config.json` for the portfolio config; `test/unit/exit-drafts.test.ts` validates drafted exit briefs (extend for the three Phase 3 briefs).

## Shared Patterns

### One transaction per state change under lease and fence
**Source:** `src/adapters/sqlite/ledger.ts:1184-1224` (`tx`, `lockRun`, `abort`, `insertEvent`); `ctx.transition(...)` in stages. **Apply to:** every ledger method added and every stage transition. `decide` and `amend` are not lease holders: they use version-checked methods, not `{ fence }`.

### Refusals create no row and no file
**Source:** CONTEXT code_context; `resume.ts:71-85` returns before any write. **Apply to:** `decide`, `contract amend`, `schedule`.

### Error and exit-code mapping
**Source:** `resume.ts:20-22, 71-85`; `inbox.ts:22-23`. `errorLine(cmd, describeError(e))`, exit 0, 3 (conflict, not active), 64 (usage, not found), 70 (internal). `--json` shapes frozen; optional keys appended last (`test/unit/json-shapes.test.ts`, fixtures in `test/fixtures/json-shapes/`).

### Model text is data
**Source:** `storedText` (`src/domain/quick-record.ts`), `stripControl` (`src/cli/render/style.ts`), `ISSUE_MAX_CHARS` (`blocked.ts:34`). **Apply to:** decision records, banners, events.

### Layering
**Source:** `scripts/check-boundaries.ts`, `test/unit/boundaries.test.ts`, `test/unit/footprint.test.ts`. `src/domain` imports only domain and `node:crypto`; `src/app` imports no adapters or cli; no runtime dependency; exactly one detached spawn.

### Documentation plan (last plan, CLAUDE.md)
**Source:** `docs/system/coverage.md`, `docs/system/findings.md`, `docs/system/README.md`. New subsystems (decisions, notifications, amendments) get their own document listed in both README tables and in coverage; recount denominators (CLI commands 10, tables 23, event kinds 28, external systems 13, run transitions 37, item states 6). Findings entries are one line with `file:line`.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/adapters/schedule/launchd.ts` | adapter | file-I/O + `launchctl` | No code writes OS-registered state; use RESEARCH plist template, `plutil -lint`, `launchctl bootstrap gui/<uid>` and `bootout`. Mark `StartCalendarInterval` array form as unverified until a temp-label test runs |
| `src/adapters/proc/ancestry.ts` | adapter | process walk | Only `ps -o pgid=` exists in `claude-host.ts`; the ppid walk to a `supervise run_` command line is new |
| `src/domain/notify-policy.ts` | domain | transform | No batching, quiet-hours or backoff logic exists; write pure functions in the `run-lifecycle.ts` table style |
| `src/ports/notifier.ts` | port | event-driven | No outbound port of this kind; follow the `agent-host.ts` Result-returning port style |

## Metadata

**Analog search scope:** `src/` (domain, ports, app, app/run-stages, adapters, cli), `test/` (unit, integration, fault, helpers, containment, benchmark)
**Files scanned:** about 240 tracked paths listed; 9 read in full or in part (blocked.ts, resume.ts, gates.ts, inbox.ts, spawn-supervisor.ts, brief.ts, ledger.ts openDecision, shell actions.ts, live-harness.ts and killpoint test headers)
**Pattern extraction date:** 2026-11-08
