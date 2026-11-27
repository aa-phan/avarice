---
status: resolved
trigger: "Full npm test after wave-2 plans (04-08..04-11): 4388 tests, 63 fail, 2502 s vs wave-1 4272 tests, 2 fail, 1458 s. Failing files pass in isolation; failures are timeouts under full-suite concurrency."
created: 2026-11-16T22:18:50Z
updated: 2026-11-16T22:18:50Z
---

## Current Focus

bug_class: environment (not a code Bohrbug): whole-process-tree pause from macOS system sleep
hypothesis: the wave-2 failures and +1044 s were caused by the laptop sleeping (clamshell, on battery, thermal emergency sleep) mid-run; wall-clock timers and leases that fell due during sleep fired at wake. No wave-2 commit made per-onboarding work slower.
test: full `caffeinate -i npm test` at HEAD (2eba70f, no code change), output /Users/aphan/.claude-edu/jobs/5be29488/tmp/fix-test.log; then check pmset log for sleep in that window
expecting: if confirmed, ~1458-1600 s and only the 2 wave-1 failures (attended live-shaped ones), with no Sleep events; if refuted, timeouts recur without sleep
next_action: wait for background full run to finish, then compare totals and grep pmset for Sleep between fix-test.start and end

## Symptoms

expected: full suite ~1458 s, 2 known failures (as at wave-1, 993a560)
actual: 2502 s, 63 failures; individual tests 50-100x slower in the full run (e.g. "returns cancelled and starts nothing when the signal is already aborted" 5.4 s -> 517.9 s; "passes --mode fast through" 9.4 s -> 513.9 s)
errors: onboardRunRepo "active ... null !== 0"; supervisor {"kind":"timeout","afterMs":15000}; kill point expected SIGKILL got SIGTERM; cancel-cli decision_id undefined; "avarice repo add: timeout 70 !== 0"
reproduction: npm test (full); every failing file passes in isolation
started: after wave-2 commits 0fa8884..2eba70f

## Eliminated

- hypothesis: 04-11 flag probe spawns `claude --help` on every launch preflight / fake-host run
  evidence: checkHelpFlags runs only when admitHostVersion returns unverified-patch; the adapter memoizes readiness (#ready ??=); test CLI injects FakeAgentHost/FakeRunHost and runCli points AVARICE_CLAUDE_BIN at /nonexistent; fixture timing identical at 993a560 and HEAD
  timestamp: 2026-11-16T22:55:00Z

- hypothesis: 04-10 runs gsd-core's drift check (a spawn) on every onboarding
  evidence: workspace stage calls gsd.checkDrift only when existingMap === 'stamped-complete'; run fixtures have no committed map; onboard fixture 1.69 s at both commits
  timestamp: 2026-11-16T22:55:00Z

- hypothesis: 04-08 binding backfill / profile config reads add per-command I/O that compounds under concurrency
  evidence: onboard (a writing command) and status timings identical at both commits; 8-file concurrent set 139.2 s vs 140.1 s
  timestamp: 2026-11-16T22:55:00Z

## Evidence

- timestamp: 2026-11-16T22:18:50Z
  checked: wave1 vs wave2 logs, same test names
  found: per-test durations 10-100x larger in wave2 (5377 ms -> 517852 ms; 1503 ms -> 513301 ms; 9181 ms -> 258368 ms); many failing tests cluster at ~513-518 s
  implication: not a uniform +8% from added tests; a contention or stall that hits many concurrent tests at once

- timestamp: 2026-11-16T22:30:00Z
  checked: offsets of the slow tests vs their wave-1 durations
  found: tests with very different base durations land on the same totals (1.5 s -> 513.3 s, 5.4 s -> 517.9 s, 9.4 s -> 513.9 s; 3.5 s -> 250.0 s, 7.0 s -> 247.7 s, 9.2 s -> 258.4 s), i.e. base + constant ~505-512 s or ~240-250 s; "staging contract: clone" (untouched by wave 2) 3.5 s -> 250 s
  implication: an additive pause of the whole process tree, not a multiplicative slowdown from extra work

- timestamp: 2026-11-16T22:35:00Z
  checked: time one onboardRunRepo fixture + `--version` + `status --json` through test-cli, 3 runs each, at HEAD (2eba70f) and in a temp worktree at 993a560
  found: HEAD onboard 1935/1692/1694 ms, version 130/123/125 ms, status 133/135/137 ms; 993a560 onboard 1869/1666/1688 ms, version 127/121/123 ms, status 137/133/135 ms
  implication: no per-onboarding or per-invocation cost was added by 04-08..04-11 on the fake-host path the fixtures use

- timestamp: 2026-11-16T22:40:00Z
  checked: `pmset -g log` for the wave-2 window (log mtime 16:13:57 CST, duration 2502 s -> start ~15:32:15) and the wave-1 window (13:40-14:04)
  found: wave-2 window: Clamshell Sleep 15:38:32 (lid closed, on battery) until Wake 16:01:25, including a 'Thermal Emergency Sleep' (15:39:45) and Maintenance Sleeps of 514 s (15:42:36) and 249 s (15:51:15); a second Clamshell Sleep 16:07:43 until FullWake 16:13:27 (another Thermal Emergency Sleep 16:08:33). Wave-1 window: no Sleep/Wake events at all.
  implication: the 514 s and 249 s sleeps match the two duration clusters exactly; the stall is the machine sleeping, and timers/leases due during sleep fire at wake (spawnSync timeout SIGTERM, supervisor 15000 ms timeout, expired leases)

- timestamp: 2026-11-16T22:50:00Z
  checked: 8 previously failing integration files run together under node --test (concurrency 9): decide, intel-step, claude-host, lease, ledger-status, preflight, offline, gsd-configure; at HEAD and at 993a560
  found: HEAD 181/181 pass, 139.2 s wall, 281.6 s user; 993a560 181/181 pass, 140.1 s wall, 275.3 s user
  implication: no regression under concurrency either; wave 2 added no measurable per-test cost to these files

- timestamp: 2026-11-16T22:52:00Z
  checked: leftover processes; npm run typecheck at HEAD
  found: no orphaned node/fake-claude processes; typecheck clean
  implication: nothing from the earlier run is still loading the machine

## Resolution

root_cause: macOS system sleep during the wave-2 full run (clamshell on battery, thermal emergency sleep; maintenance sleeps of 514 s and 249 s match the two stall clusters). Wall-clock timers and leases due during sleep fired at wake. Plans 04-08..04-11 added no measurable per-test cost.
fix: none in code. Post-wave gates run under `caffeinate -i`.
verification: full `caffeinate -i npm test` at HEAD 2eba70f, no code change: 4416 tests, 4345 pass, 0 fail, 71 skipped, 1040 s (2026-11-16, log /Users/aphan/.claude-edu/jobs/5be29488/tmp/fix-test.log).
files_changed: []
