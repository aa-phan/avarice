---
phase: "02"
slug: "contained-unattended-run-of-one-work-item"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
block_on: high
register_authored_at_plan_time: true
created: "2026-11-07"
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail. Register built from the `<threat_model>` blocks of plans 02-01..02-25 plus SUMMARY threat flags; mitigations verified read-only by gsd-security-auditor on 2026-11-07.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| AVARICE → installed Claude Code | A new host version may change hook, sandbox or permission behaviour | Host version string, launch args, generated settings |
| Test harness → paid model API; live spend → owner's 25 USD ceiling | Live cases cost money | Prompts, costs, spend ledger |
| Ledger / repository / model strings → terminal | Paths, decision issues, titles, pause text are printed | Repo- and model-derived text |
| Supervisor and hook processes → local SQLite store | Several processes write one file | Leases, fences, transitions, hook rows, events |
| Brief file and `.avarice/config.json` → contract compiler | User-pasted or repo-committed data | Brief text, conventions, budget overrides |
| Agent-written files and final text → gates | Model output the gates must not trust | SUMMARY, VERIFICATION, pause text, test inventory |
| Contained agent → clone filesystem, shell, hook | Every tool call crosses the hook, which runs outside the sandbox | Edits, shell lines, GSD verbs, brief text in prompt |
| Sandboxed `npm ci` and checks → network/registry (allowlist proxy) | Repository code runs under Seatbelt | CONNECT targets, lockfile, packages |
| Run clone / user source repo / repo config → supervisor git calls | Agent-written objects are fetched; hostile filters and hooks possible | Git objects, refs, filters, pathspecs |
| Detached supervisor, dead supervisor's host, recovery/resume → clone and ledger | A background process acts for the user; a survivor may still write | Lease and fence, session IDs, snapshots, trailers |
| AVARICE → owner's Claude config and skill dir; shell → history file | `install-host` writes outside the data root; shell keeps history | Skill file, history lines |
| Contained runs and dry run → owner's real portfolio repository | First real write is one fetched branch per run; otherwise read-only | Git reads, one create-only ref, `.env` |
| Evidence files, code comments, agents → `docs/system` | What a grounder copies becomes committed documentation | Evidence content, containment claims |
| Attended session (owner login, no sandbox) and tests → owner's real Claude config and AVARICE profile | The model acts with the owner's user rights | Config directory, profile roots, transcripts |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | EoP | Unverified host version admitted | high | mitigate | Admit list, refuse others (`launch-preflight.ts`); `live-admission-override.test.ts`, `failclosed.test.ts`; live admission 23/23 | closed |
| T-02-02 | DoS (spend) | Live cases over 25 USD | medium | mitigate | Lower-only ceiling env (`live-harness.ts`); `live-spend-ceiling.test.ts` | closed |
| T-02-03 | Spoofing | Escape sequences in repo path / recorded string | medium | mitigate | `stripControl` in renderers (`render/style.ts`); `render.test.ts` | closed |
| T-02-04 | Tampering | `--json` broken by restyling | medium | mitigate | Snapshots committed first; `json-shapes.test.ts` | closed |
| T-02-05 | Tampering | Stale supervisor advancing a run | high | mitigate | Version + fence checks, strict-expiry takeover (`sqlite/ledger.ts`); `run-ledger.test.ts` | closed |
| T-02-06 | Repudiation | Evidence rewritten | medium | mitigate | Append-only triggers (migration 0002), event hash chain; `run-ledger.test.ts` | closed |
| T-02-07 | DoS | Interrupted migration | medium | mitigate | Checksum refusal, backup first, one transaction each (`migrate.ts`); `migrations.test.ts` | closed |
| T-02-08 | EoP | Conventions granting git, curl | high | mitigate | Command refusals (`domain/conventions.ts`, `run-contract.ts`); `conventions.test.ts` | closed |
| T-02-09 | Tampering | Brief widens write set / writes protected paths | high | mitigate | Contract compiler refusals (`run-contract.ts`); `run-contract.test.ts` | closed |
| T-02-10 | EoP | Brief/conventions raising budgets | high | mitigate | Lower-only budgets, policyRevision = preset digest; `run-contract.test.ts` | closed |
| T-02-11 | Tampering | Check env overriding PATH, NODE_OPTIONS | high | mitigate | Env key refusals (`conventions.ts`); `conventions.test.ts` | closed |
| T-02-12 | Spoofing | SUMMARY/VERIFICATION claiming success | high | mitigate | Gates judge structural evidence only (`gates.ts`, `evidence.ts`, `finish.ts`); `evidence.test.ts` | closed |
| T-02-13 | Tampering | Test weakening | high | mitigate | Inventory comparison, G2 (`test-inventory.ts`, `gates.ts`); `run-gates.test.ts` | closed |
| T-02-14 | Spoofing | Crafted final text forcing a pause | low | accept | See Accepted Risks R-01 | closed |
| T-02-15 | Info disclosure | Exfiltration from `npm ci` | high | mitigate | Seatbelt deny-network + one loopback port; exact host:port allowlist proxy; `allowlist-proxy.test.ts`, `run-deps.test.ts` | closed |
| T-02-16 | EoP | Install scripts during `npm ci` | high | mitigate | `npm_config_ignore_scripts`, writes confined (`app/checks.ts`); `npm-ci-proxy.test.ts` | closed |
| T-02-17 | Spoofing | Proxy reachable by other local processes | low | accept | See Accepted Risks R-02 | closed |
| T-02-18 | Tampering | Hostile objects / ref update in user repo | high | mitigate | Create-only ref, fsck, no checkout (`run-workspace.ts`, `safe-git.ts`); `run-source-untouched.test.ts` | closed |
| T-02-19 | EoP | Repo filters or hooks | high | mitigate | `hooksPath=/dev/null`, `--no-verify` (`safe-git.ts`, `run-workspace.ts`) | closed |
| T-02-20 | Tampering | Discard deleting user files | high | mitigate | Snapshot-bounded discard, HEAD-moved refusal; `run-workspace.test.ts` | closed |
| T-02-21 | Spoofing | Conventions from a working-tree file | medium | mitigate | Read from git objects, `.avarice/**`-only descendant (`run-source.ts`); `run-source.test.ts` | closed |
| T-02-22 | Tampering | Out-of-scope or protected writes | high | mitigate | Hook decision + scope denyWrite/protected globs; `hook-decision.test.ts`; live cs1..cs4 | closed |
| T-02-23 | EoP | `npm`/`npx` forms beyond the contract | high | mitigate | Argv-exact command matching (`hook-decision.ts`, `invocation-scope.ts`) | closed |
| T-02-24 | EoP | Agent committing, configuring git, calling avarice | high | mitigate | Denied prefixes, `.git` deny, HEAD-moved outcome; live cs11 | closed |
| T-02-25 | Spoofing | Brief text escaping the prompt | medium | mitigate | Escape, 32 KiB cap, fence (`run-gsd-config.ts`); `run-gsd-config.test.ts` | closed |
| T-02-26 | Repudiation | Hidden human prompts | medium | mitigate | AskUserQuestion denied, `text_mode`; `hook.test.ts` | closed |
| T-02-27 | EoP | Admitting a GSD verb that writes | high | mitigate | Three read-only run verbs (`invocation-scope.ts`); `hook-decision.test.ts` | closed |
| T-02-28 | Tampering | Executor committing despite addendum | high | mitigate | Commit denied in scope, HEAD-moved outcome; `spike-gsd-quick.test.ts`; live e2e | closed |
| T-02-29 | DoS (spend) | Spike rounds overrunning | medium | mitigate | Spike refusal at 4.00 USD, rounds capped; ledger 02-09 = 1.0033 USD | closed |
| T-02-30 | Tampering | Run on stale code | medium | mitigate | Staleness limits 25 commits / 14 days (`run-preflight.ts`) | closed |
| T-02-31 | Tampering | Conventions from uncommitted/unrelated commit | high | mitigate | Descendant-of-pin check (`run-source.ts`, `run-preflight.ts`) | closed |
| T-02-32 | Tampering | Contract editable by the run | high | mitigate | 0600 file in 0700 dir, temp+rename; data root in denyRead | closed |
| T-02-33 | DoS | Partial run from killed start | low | mitigate | One transaction; file written after (`ledger.ts`, `run-start.ts`) | closed |
| T-02-34 | Tampering | Stale edits overwriting | medium | mitigate | Read-before-edit digest (`pre-tool-use.ts`); `hook-read-digest.test.ts` | closed |
| T-02-35 | DoS | Agent loops on denials/searches | medium | mitigate | Loop limits, `continue:false`; `run-loops.test.ts` | closed |
| T-02-36 | EoP | Hook failing open | high | mitigate | Every error exits 2; unknown tool denied; `hook-read-digest.test.ts` | closed |
| T-02-37 | Tampering | Bash writes bypass read-before-edit | low | accept | See Accepted Risks R-03 | closed |
| T-02-38 | Tampering | Two supervisors on one run | high | mitigate | Lease + fence (`run-service.ts`, `ledger.ts`); `lease.test.ts` | closed |
| T-02-39 | EoP | Launching on an unenforced host | high | mitigate | G0 `enforcement_failure` before any invocation (`prepare.ts`); `run-supervisor.test.ts` | closed |
| T-02-40 | DoS | Supervisor running forever unseen | low | mitigate | Wall-clock budget; dead PID reported (`spawn-supervisor.ts`) | closed |
| T-02-41 | EoP | Checks running agent code with user access | high | mitigate | Sandboxed executor only, creds/data root unreadable, declared writes (`checks.ts`) | closed |
| T-02-42 | Tampering | Out-of-scope paths reaching review branch | high | mitigate | Diff gate (`item.ts`, `finish.ts`, `gates.ts`) | closed |
| T-02-43 | Spoofing | VERIFICATION `passed` standing in for evidence | high | mitigate | Evidence-only gates (`finish.ts`, `evidence.ts`); `run-baseline-workflow.test.ts` | closed |
| T-02-44 | Spoofing | Pause/SUMMARY text with escapes | medium | mitigate | `storedText` + `stripControl` (`quick-record.ts`); `quick-record.test.ts` | closed |
| T-02-45 | EoP | Declared check writing outside outputs / reaching network | high | mitigate | Check validation (`check-validation.ts`); `check-validation.test.ts` | closed |
| T-02-46 | Tampering | Test weakening to pass G2 | high | mitigate | AVARICE measures inventory (`checks.ts`, `test-inventory.ts`); `test-inventory.test.ts` | closed |
| T-02-47 | Info disclosure | Install exfiltrating data | high | mitigate | Registry-only proxy, credential dirs unreadable, scripts off; `run-deps.test.ts` | closed |
| T-02-48 | Repudiation | Pre-existing failure hidden | medium | mitigate | Base failure recorded and shown (`checks.ts`, `run-status.ts`); `render.test.ts` | closed |
| T-02-49 | Spoofing | Escapes in decision issues/paths | medium | mitigate | `stripControl` in run views and tables; `render.test.ts` | closed |
| T-02-50 | Tampering | A run installing a skill | high | mitigate | `install-host` refuses under `AVARICE_RUN`; `install-host.test.ts` | closed |
| T-02-51 | Tampering | install-host following symlinks | medium | mitigate | lstat, O_NOFOLLOW, `wx` temp, rename (`skill-install.ts`); `install-host.test.ts` | closed |
| T-02-52 | Info disclosure | status reading transcripts | low | mitigate | Ledger reads only (`run-status.ts`); `run-status.test.ts` | closed |
| T-02-53 | Tampering | Discard deleting user work | high | mitigate | Snapshot-bounded discard (`run-workspace.ts`, `discard.ts`); `run-discard-retry.test.ts` | closed |
| T-02-54 | DoS | Retry loops | medium | mitigate | One retry, invocations budget (`item.ts`); `run-discard-retry.test.ts` | closed |
| T-02-55 | Tampering | Recovery against user checkout | high | mitigate | Recovery git only in run workspace; `run-source-untouched.test.ts`; exit digests equal | closed |
| T-02-56 | Tampering | Relaunch beside a surviving host | high | mitigate | Reap before resume, failure stops resume (`run-resume.ts`); `resume-reap.test.ts` | closed |
| T-02-57 | Spoofing | Foreign commit taken as the item's commit | medium | mitigate | Trailer/commit identity checks (`item.ts`, `run-workspace.ts`) | closed |
| T-02-58 | Repudiation | Interrupted verification shown as passed | high | mitigate | Inconclusive rows on resume; G4 `no-stale-or-inconclusive`; `run-resume.test.ts` | closed |
| T-02-59 | Repudiation | Docs claiming unproven enforcement | medium | mitigate | Tracked test per matrix row; `containment-matrix.test.ts` | closed |
| T-02-60 | EoP | In-sandbox commit path left open | medium | mitigate | `.git` denyWrite; `sandbox-commit.test.ts` | closed |
| T-02-61 | EoP | A run reaching the shell's actions | high | mitigate | Shell refuses under `AVARICE_RUN`/non-TTY; `shell.test.ts` | closed |
| T-02-62 | Spoofing | Escapes in the shell view | medium | mitigate | `stripControl` in shell, home view, line editor; `shell.test.ts` | closed |
| T-02-63 | Info disclosure | History readable by others | low | mitigate | 0600, control chars stripped (`history.ts`); `shell.test.ts` | closed |
| T-02-64 | DoS | Shell exit killing a supervisor | medium | mitigate | Detached + unref spawn; `shell-supervisor.test.ts` | closed |
| T-02-65 | EoP | Containment failing only in the fake host | high | mitigate | Live run-purpose suite on real host 25/25 PASS; `not exercised` fails | closed |
| T-02-66 | Tampering | Live cases touching real repos/profile | high | mitigate | Scratch repos and temp profiles by construction (`live-harness.ts`, `scratch-repo.ts`) — see residual W-2 | closed |
| T-02-67 | DoS (spend) | Cases overrunning ceiling | medium | mitigate | Ceiling guard; total 9.8156 of 25 USD | closed |
| T-02-68 | Tampering | Claude writing to the portfolio | high | mitigate | Dry run `portfolio.unchanged: true`; checkout digests; `checkout-unchanged.test.ts` | closed |
| T-02-69 | Repudiation | Spend without owner approval | medium | mitigate | `02-21-exit-authorization.json`; `authorize` guard exit 75 | closed |
| T-02-70 | Tampering | Conventions file granting too much | medium | mitigate | Compiler refusals; committed digest equals draft | closed |
| T-02-71 | Tampering | Checkout or other branches changed | high | mitigate | `02-22-evidence-exit.json` `crossRun.equal: true`, 3 new `avarice/run_*` refs only | closed |
| T-02-72 | DoS (spend) | Exit runs overrunning | medium | mitigate | Spend guard exit 75; 9.285 of 25 USD | closed |
| T-02-73 | Info disclosure | Untracked `.env` read | medium | mitigate | `**/.env` protected, denyReadGlobs; `.env` in unchanged digests | closed |
| T-02-74 | Info disclosure | docs/system and grounding files | high | mitigate | Grep: 0 home paths, 0 credential-shaped strings | closed |
| T-02-75 | Spoofing | False enforcement claims in docs | high | mitigate | Detect-only limits stated in `docs/system/containment.md`; digest-bound reviews | closed |
| T-02-76 | Tampering | Embedded instructions in agent inputs | medium | mitigate | Embedded-instruction check in 02-23 reviews; no code changes | closed |
| T-02-77 | Tampering | Docs pass editing code or proposals | medium | mitigate | No src/bin/scripts change from the docs pass; no `docs/` outside `docs/system` | closed |
| T-02-78 | Repudiation | Review status in coverage.md | medium | mitigate | Per-document reviewed rows; reviews bound to sha256 + commit | closed |
| T-02-79 | Info disclosure | Documenting known bypasses | low | accept | See Accepted Risks R-04 | closed |
| T-02-80 | Tampering | Reconcile failure record by superseded supervisor | medium | mitigate | Fence guard in transaction (`run-resume.ts`, `ledger.ts`); `run-discard-stale-fence.test.ts` | closed |
| T-02-81 | Tampering | Discard by a stale-fence supervisor | medium | mitigate | Checkpoint carries fence before restore (`discard.ts`); `run-discard-stale-fence.test.ts` | closed |
| T-02-82 | EoP | Test interception leaking into src | low | mitigate | No `new Proxy` in src/bin; boundaries check ok | closed |
| T-02-83 | Tampering | Owner's Claude config and profile | high | mitigate | Digests, refuse-if-present, `--setting-sources ""`, equality asserted (`live-attended.ts`) | closed |
| T-02-84 | DoS (spend) | Sessions over ceiling or plan cap | medium | mitigate | Ceiling then 4.00 cap, `--max-budget-usd`; ledger 02-25 = 0.5305 USD | closed |
| T-02-85 | Repudiation | Verdicts from model's words | medium | mitigate | Structural verdicts; `live-attended-verdicts.test.ts` | closed |
| T-02-86 | EoP | Attended session acting outside scratch repo | medium | mitigate | dontAsk, allow list, web tools denied, edits only in scratch — see residual W-3 | closed |
| T-02-87 | Info disclosure | Transcripts committed | low | mitigate | Truncation + `redactSecrets`; 0 secret hits in committed jsonl — see residual W-4 | closed |
| T-02-SC | Tampering | Package installs (all 25 plans) | high | mitigate | devDependencies only; package files unchanged since Phase 1; `footprint.test.ts` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

Totals: 88 threats (43 high, 35 medium, 10 low) — 84 mitigate, 4 accept, 0 transfer; 88 closed, 0 open.

### Residual observations (unregistered, non-blocking)

| ID | Severity | Observation | Suggested fix |
|----|----------|-------------|---------------|
| F-02-20 | warning | SUMMARY 02-20 flag `sandbox-read-gap (narrowed)`: a profile whose roots are placed outside the default parents via `AVARICE_DATA_ROOT` / `AVARICE_WORK_ROOT` / `AVARICE_CONFIG_HOME` is readable by a declared check command; the hook still refuses the model's own reads. Closed for default-placed profiles (live cs7 PASS); documented in `docs/system/containment.md` | Documented residual; no action this phase |
| W-1 | medium | Phase 1 one-shot onboarding output prints the last `ctx.note` without `stripControl` (`src/cli/commands/onboard.ts:55`, `src/cli/commands/resume.ts:57`); notes can carry repository-derived paths. Outside T-02-03/T-02-49's scope but the same terminal-escape vector | Wrap `message` in `stripControl` at both sites; add a render test |
| W-2 | info | T-02-66 says "asserted by paths under $TMPDIR"; scratch roots come from `mkdtemp` but nothing asserts it explicitly | Add a realpath-under-tmp assertion in `makeShortRoots` / `makeScratchRepo` |
| W-3 | info | `Bash(cat:*)` in the attended allow list permits `cat > file` (test harness only; protected file asserted byte-identical; disclosed in 02-25-SUMMARY and LIVE-CASES) | Drop `cat` from the allow list or use Read |
| W-4 | info | One line of committed `live-attended-phase2.jsonl` contains a home path in a truncated error reason (not a secret) | Path-redact the record writer |

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-01 | T-02-14 | A crafted final text can force or hide a pause, but a pause only routes to a decision record and never passes a gate; worst case is a needless decision | Plan 02-05 threat model (owner) | 2026-11-05 |
| R-02 | T-02-17 | The allowlist proxy binds 127.0.0.1, lives for one step and admits only the registry; other local processes reaching it gain only registry access | Plan 02-06 threat model (owner) | 2026-11-05 |
| R-03 | T-02-37 | Bash writes bypass read-before-edit by design; the sandbox confines where Bash writes land and a later Edit sees the changed digest | Plan 02-11 threat model (owner) | 2026-11-05 |
| R-04 | T-02-79 | Documenting known bypasses and detect-only limits: local single-user tool, limits already in the proposal containment document, docs state behavior not exploit steps | Plan 02-23 threat model (owner) | 2026-11-05 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-07 | 88 | 88 | 0 | gsd-security-auditor (ASVS L1, block_on high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-07
