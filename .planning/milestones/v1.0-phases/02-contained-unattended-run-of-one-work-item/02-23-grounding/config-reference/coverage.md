Package covers docs/system/config-reference.md, checked at HEAD 0632fd4 against base e725db6, from the files at HEAD and the diff of each packet file.

Per code file:
- src/adapters/exec/allowlist-proxy.ts: covered (bind, answers, target form, allowlist, attempts).
- src/adapters/git/run-workspace.ts: covered in part (commit identity constant, fetch and tree timeouts, ignored cap). Lines 120-400 were read only for timeouts and call sites.
- src/adapters/git/safe-git.ts: covered (per-call environment entries); the option allowlists have no further configuration to document.
- src/adapters/gsd/agents-json.ts: no documentable behavior for configuration (the executor addendum is a constant, counted among the six constants).
- src/adapters/host-claude/avarice-run-skill.ts: no documentable behavior beyond the constant name and the skill target directory.
- src/adapters/host-claude/env.ts: covered (run host environment).
- src/app/budget.ts: covered (charge rule for killed invocations); budget row names belong to the data model.
- src/app/check-validation.ts: covered (proxy use, environment, caps).
- src/app/checks.ts: covered (sandbox environment, deny and allow lists, install and inventory caps).
- src/app/onboarding-service.ts: covered (lease TTL, fault variable).
- src/app/run-gsd-config.ts: covered (seven settings, prompt cap).
- src/app/run-service.ts: covered (lease renewal, fault checkpoint names).
- src/cli/commands/install-host.ts: covered (config directory resolution, run refusal).
- src/cli/composition.ts: covered (claude, hook and config directory variables, egress composition).
- src/cli/main.ts: covered (AVARICE_RUN shell gate).
- src/cli/render/style.ts: covered in part (NO_COLOR, TERM only).
- src/cli/shell/history.ts: covered (cap, file, mode).
- src/cli/shell/shell.ts: covered in part (TERM, AVARICE_RUN, poll interval, width default).
- src/cli/spawn-supervisor.ts: covered (supervisor environment, wait polling).
- src/domain/conventions.ts: covered (every key and limit).
- src/domain/run-contract.ts: covered (preset, overrides, adjustments).
- src/domain/run-preflight.ts: covered (staleness limits, refusal order).

Also read outside the packet: src/domain/policy-narrowing.ts, src/app/stages/activate.ts, src/adapters/git/run-source.ts, src/adapters/exec/seatbelt-profile.ts, src/domain/brief.ts, src/app/run-start.ts, src/hook/pre-tool-use.ts lines 262-330.

Counts (2026-11-06):
- AVARICE_* names: 15 of 15. M: git grep -ohE "AVARICE_[A-Z0-9_]+" -- src bin | sort -u | wc -l gave 15. By reading each site: 9 read variables, 6 constants. Set: AVARICE_RUN, and the three roots for the supervisor.
- Other variables read: 10 of 10. M: git grep -nE "process[.]env|env[[]" -- src bin, plus the passthrough lists in the gsd-tools, graphify, host env and launch-preflight adapters.
- Conventions keys: 6 top-level, 6 check, 3 paths, 2 testInventory, 3 dependencies, matching TOP_KEYS, CHECK_KEYS, PATH_KEYS and the two inline lists in src/domain/conventions.ts.
- Profile config keys: 4 of 4, dead. The file is written at src/adapters/fs/profile-paths.ts:92; git grep -n "configPathFor" -- src shows no reader.
- Budget override names: 7 of 7 (BUDGET_OVERRIDE_NAMES); onboarding 8.
- Recorded-only preset fields: grep -rnE 'noProgress|[.]delivery|reviewReady|[.]notify|repairAttempts|[.]toolClasses|readExclude|gsdVerifier|integrityGates|afterEachItem' src matches only src/domain/run-contract.ts and the onboarding modules.
- Alive proofs: the proxy is started at src/app/checks.ts:355 and src/app/check-validation.ts:76 and composed at src/cli/composition.ts:252; the loop limits are read at src/hook/pre-tool-use.ts:276 and :304.

Not checked: live behavior of any command. Carried from the existing document without re-reading, because their files are outside the diff: host kill grace, transcript cap, stream line cap, graphify and gsd-core timeouts, map and intel caps, event caps. Re-verified by grep: ledger busy timeout, hook caps, admitted versions, Node and SQLite rows, profile config.
