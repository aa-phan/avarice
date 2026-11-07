Reviewed: docs/system/config-reference.md sha256 0ab3dc6b1206f47dfe0dd82f6cde9c7f524283ddf56eaf7a9151c97b4b1a850b at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKS: 1 WARNING and 1 OBS remain (0 BLOCKER); not PASS under the strict gate.

BLOCKS: 1 WARNING and 1 OBS remain (0 BLOCKER); not PASS under the strict gate.

Digest reviewed: 0ab3dc6b1206f47dfe0dd82f6cde9c7f524283ddf56eaf7a9151c97b4b1a850b (matches dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.

FINDINGS

1. WARNING (confidence high). Quirks, line 354: "although only `PATH`, `HOME`, `TMPDIR` and the loader names are refused at parse". The parse also refuses TMP, TEMP, NODE_OPTIONS, NODE_PATH, NODE_EXTRA_CA_CERTS, BASH_ENV, ENV, SHELL, IFS and the prefixes DYLD_, LD_, npm_config_ (the doc's own line 115 lists them). "only" is false and contradicts line 115.
   Fix: "although only the reserved names and prefixes listed above are refused at parse; CI, LANG and the rest of the sandbox names are not."
   Evidence: src/domain/conventions.ts:44-60 (RESERVED_CHECK_ENV, RESERVED_ENV_PREFIXES), :140-143 (isReservedEnv).

2. OBS (confidence medium). Run limits table, last row: "at most 10000 ignored entries kept". The adapter keeps 10000, but the recorded snapshot step stores only the first 200 plus the count.
   Fix: "at most 10000 ignored entries listed; the snapshot step record stores 200 and the total count."
   Evidence: src/adapters/git/run-workspace.ts:46,466; src/app/run-stages/item.ts:45,488.

No other findings.

CHECKED AND VERIFIED (not flagged)
- Env variables: the 9 AVARICE_* reads (CONFIG_HOME, DATA_ROOT, WORK_ROOT via profile-paths.ts:62-64; CLAUDE_BIN, HOOK_ENTRY composition.ts:122-124; GRAPHIFY_BIN graphify.ts:32,57; LEASE_TTL_MS onboarding-service.ts:44; FAULT :32; RUN main.ts:58, shell.ts:532, install-host.ts:25) and the 4 sets (spawn-supervisor.ts:47-53, host env.ts:44). The 10 other reads and the six passthrough names (gsd-tools.ts:20, launch-preflight.ts:112). NODE_TEST_CONTEXT removal. Empty-as-unset rules and the three exceptions. AVARICE_FAKE_HOST appears only under test/.
- Child environments: git (safe-git.ts:74-86), gsd, host onboarding and run (env.ts), graphify (PASSTHROUGH HOME, LANG, TMPDIR; graphify.ts:35,104-111), check/install/validation sandbox sets and override order (checks.ts:116-120,200,364; check-validation.ts:85), probes.
- Conventions keys, limits, reserved names, agent-command rules, host rules, glob rule (conventions.ts:41-225, 243-340); both readers' key sets; refusal codes and order (run-preflight.ts:7-73); 500 commits and 256 KiB cap (run-source.ts:16-17).
- Routine preset values, override names, integer flags and the two adjustments (run-contract.ts:75-125, 209-226, 286-330); onboarding budget values (onboarding-contract.ts:159-163).
- Carried limits spot-checked against code, all match: host kill grace 10 s, transcript 20 MiB, stream line 16 MiB (claude-host.ts:35-36, stream-json.ts:65); graphify 300/120/15 s and 64 MiB (graphify.ts:28-31); gsd-core 15 s, 5 s, 16 MiB (gsd-tools.ts:14-15, locate.ts:17); map 1 MiB, intel 4 MiB (shared.ts:15, index-intel.ts:29); event caps 1024/8192 (events.ts:11-12); sandbox kill grace 5 s; git 10 s, 120 s, 60 s, 64 MiB; hook stdin 1 MiB, busy 4 s, 8 MiB, 16384 chars; ledger busy 5 s; context 4000/100000; history 1000; lease 180000; install 15 min, lockfile 32 MiB, 20 attempts; test inventory 120 s, 50000, 500, 20000, 4 MiB; check validation 20/10; output 5 MiB; brief 64 KiB; prompt 32 KiB; quick record 64 KiB and archive 2 MiB; issue text 1000; wait margins 15 min / 24 h / 250 ms; skill 256 KiB; admitted Claude versions; Node engines; warning suppression.
- Mechanical: no em/en dashes or " -- "; script sweep found zero sentences over 35 words in running prose (opening, tables, fences exempt); headings sentence case; no delivery history, plan IDs or function names in prose; modules named once in the opening; no secrets or absolute home paths; quirks section present; cross-link file names named (runs.md, cli-reference.md, containment.md, onboarding.md) not re-opened; no embedded instructions found.
- Containment labels (prevention for install proxy and loop limits, detection for validation proxy, guard-not-control for AVARICE_RUN) consistent with the code read.
- Not verified: the onboarding .planning/config.json four-setting list, the bundled SQLite version table, and shell width/poll rows beyond the constants listed.

git status --porcelain (only pre-existing untracked files; this run touched nothing in the repository):
?? .planning/config.json
?? .planning/milestone.lock

## Answers

Applied: finding 1 (the reserved names are the ones listed above) and OBS 2 (the snapshot step stores 200 entries and the total).
