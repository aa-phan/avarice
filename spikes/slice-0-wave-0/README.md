# Wave 0 live spikes, 2026-11-02

Seven spikes (S0-A to S0-G) on the Claude Code, GSD and graphify seams that phase 1 plans 01-08, 01-11, 01-15, 01-17, 01-18 and 01-19 build on. Host: Claude Code 2.1.316, GSD 1.17.0, graphify 0.9.53, macOS Seatbelt. Every result below comes from a real `claude -p` run (model `haiku`, subagents forced to `haiku`, a per-run `--max-budget-usd`) on a scratch repository or a scratch clone; outcomes were checked against files, git state and tool output, never the model's own report. Machine-readable verdicts are in [results.json](results.json), per-case digests in [evidence/](evidence/), the spend ledger in [evidence/ledger.jsonl](evidence/ledger.jsonl).

**Spend authorization:** the user approved option `approve-all` with a total cap of 4.30 USD on 2026-11-02 (six spikes at 0.40 USD, S0-F fast map 0.40 USD plus full map 1.50 USD). **Total spend: 0.41 USD** over 47 recorded runs, including reruns and a 0.02 USD allowance for the environment-bisect runs. The cheapest-first ordering and the ledger gate in `harness.sh` (refuses a run when ledger spend plus its cap would pass the total) never triggered. Every spike ran.

| Spike | Result | Evidence | Design impact |
|---|---|---|---|
| S0-A Bash permission semantics for the GSD preamble | Finding | A1 to A8 | Do not rely on `permissions.allow` Bash text rules: skills pre-approve Bash, and the post-skill steps are denied. The PreToolUse hook is the identity control (allow by preamble SHA-256, deny by default); hook allow and deny both hold under `dontAsk` |
| S0-B Git metadata exposure by staging strategy | Finding | B1 to B4 | A linked worktree without `denyWrite` on the source `.git` lets a contained run move a source branch ref; with the two generated `denyWrite` entries or with a local clone it cannot. Prefer the clone; `denyRead` on the checkout root with `allowRead` of `.git` works |
| S0-C `gsd_run` discovery | Pass | C1, C2 | Put `<gsd-core>/bin` first on `PATH`; add `USER` and `LOGNAME` to the env allowlist (login fails under `env -i` without `USER`) |
| S0-D Intel seam | Pass | D1, D2 | Use `claude -p --agent gsd-intel-updater "focus: full; project root: <staging>"` with the agent in `--agents`; no Agent tool, so the intel subagent budget is 0. `-p` also waits for a background agent |
| S0-E Instruction and skill loading | Finding | E1, E1b, E2, E2b, E3, E4 | `--setting-sources ""` already excludes repository and user `CLAUDE.md`; auto memory stays on unless `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. Skills arrive namespaced through `--plugin-dir`, agents bare through `--agents` |
| S0-F Cost and wall clock on the target | Finding | F1-attempt1, F1, F2 | Fast map 0.04 USD and 147 s; full map 0.13 USD and 171 s (four subagents, 82 tool calls). Default budgets below. A stalled subagent held `-p` for the 10-minute host ceiling, so AVARICE enforces its own wall clock |
| S0-G Knowledge pass under the sandbox | Finding | G1, G2, G3 | Needs the graphify directory on `PATH` for that invocation and Read of the skill files; output lands in `<cwd>/graphify-out`; document edges come back `EXTRACTED` and must be re-tagged; no `_origin`, no `built_at_commit` |

## Decisions the spikes settle

**Bash strategy (plan 01-11).** All four fast-map strategies completed with all four files (A1 to A4) because `/gsd-map-codebase` declares `allowed-tools: Bash`, which pre-approves Bash while the skill runs. The same commands without the skill were denied (A5), and the compound `stamp-codebase-map` step after the background mappers returned was denied in the full map (F2). The model also did not run the 2.5 KB preamble verbatim in A1 to A4. A hook `allow` is honored under `dontAsk` for a command no rule allows (A8: the preamble plus `gsd_run runtime-identity --raw` ran, `node -e` and a write outside the write set were denied); a hook `deny` holds even against the skill grant (A7). The preamble's first line is 2,573 characters, SHA-256 `c71090e895dc5a024a60e879e621d201f1b7f1fc4a9d5649e90dcabfba52622b`, identical in `workflows/map-codebase.md` and `workflows/scan.md`; the verbatim line is stored in `results.json` under `spikes.S0-A.preamble.firstLine`. Recommendation: sandbox for effects, hook for identity, AVARICE runs `stamp-codebase-map` itself, `Read(//<gsd-core>/**)` stays allowed, `commit_docs` false.

**Staging strategy (plan 01-08).** Ground truth is the source repository's `git for-each-ref` digest, `HEAD` and `config` bytes before and after.

| Strategy | Source ref moved | Source config written | Commit possible |
|---|---|---|---|
| Linked worktree, no extra `denyWrite` (B1) | **Yes** (`refs/heads/main`, by `update-ref` and `branch -f`) | No (redirect denied by the permission layer, `git config` could not lock the file) | Yes |
| Linked worktree, `denyWrite` on the repo `.git` and the worktree gitdir (B2) | No | No | No |
| Local clone, `denyWrite` on the clone `.git` (B3) | No (also refused by absolute path) | No | No |

Onboarding needs no commits, so the safe strategies lose nothing. Recommendation: stage in a `git clone --local --no-hardlinks`; if a worktree is kept, preflight asserts the two `denyWrite` entries and a post-run digest. B4: with `denyRead` on the checkout root and `allowRead` on its `.git`, `cat .env` was denied by the permission rule, a Node `readFileSync` failed with `EPERM` at the OS layer, and `git log` worked.

**Environment (plans 01-08, 01-11).** `PATH=<gsd-core>/bin:/usr/bin:/bin:/opt/homebrew/bin` (the control without it fails with `gsd-tools.cjs not found`); `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, `CLAUDE_CONFIG_DIR`; the four safe-git variables; `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` (and `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` as belt and braces). The graphify directory goes on `PATH` only for the knowledge invocation. The Bash tool runs zsh, so the preamble prints a harmless `unset: no such hash table element: gsd_run` line.

**Intel seam (plan 01-15).** `--agent gsd-intel-updater` resolves an agent supplied only through `--agents` and wrote five valid intel files in 31 s for 0.009 USD (D1). The Agent-tool form with `run_in_background` also works and `-p` waits for it (D2). `/gsd-map-codebase --query` has no workflow behind it (E3).

**Default onboarding budgets (plan 01-11, from S0-F).** Haiku mapper, 363-file target. Measured: fast map 0.040 USD, 147 s, 24 tool calls, 1 subagent; full map 0.130 USD, 171 s, 82 tool calls, 4 subagents; knowledge pass on 4 documents 0.024 USD, 77 s. Recommended defaults: `wallClockMinutes` map 8, intel 5, knowledge 6; `invocations` 4; `toolCalls` 300; `subagentsTotal` 4 for the map, 0 for intel, 1 per 20 documents for the knowledge pass; `costUsd.perInvocation` 1.00 and `perRun` 3.00; `retry` 1. The cost figures hold for the haiku mapper only. A stalled subagent held `-p` open for the host's 10-minute background ceiling (`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`) with almost no cost recorded, so the wall clock must be AVARICE's own SIGTERM.

**Knowledge-pass flags (plan 01-17).** Under the sandbox with no network the skill's step 1 fails (`uv` cannot write `~/.cache/uv`; the install fallbacks hit the proxy), so the interpreter resolves only through the graphify binary's shebang, which needs its directory on `PATH` (G1 fails, G3 passes). Output lands in `<cwd>/graphify-out/`. A document-only pass runs no code extraction, so `--max-workers 1` was not needed; keep it for code extraction. The graph had 11 nodes (4 `code`, 3 `concept`, 4 `document`) and 21 edges (20 `EXTRACTED`, 1 `INFERRED`); 16 document edges were `EXTRACTED`, which S-45 forbids, no node had `_origin`, and `built_at_commit` was absent. The AVARICE merge re-tags, stamps and drops dangling edges.

## Other findings

- The host creates an empty `.claude/.cc-writes` directory in the working directory; the staging diff gate must tolerate it.
- The mapper tried `git add` and `git commit` when `commit_docs` was true (A2); `denyWrite` on `.git` refused it.
- `Glob` and `Edit` were not available in the subagent sessions; agents fall back to `find` and `Write`.
- `init.map-codebase` returned `mapper_model: haiku` for the scratch repository; `CLAUDE_CODE_SUBAGENT_MODEL=haiku` held every subagent on haiku (only `claude-haiku-5-5` appears in `modelUsage` across all runs).

## Reproducing

```bash
export SPIKE_ROOT=$HOME/.local/share/avarice-spikes/wave-0      # never under ~/.claude*
spikes/slice-0-wave-0/run-all.sh --authorize approve-all 4.30 2026-11-02 S0-E S0-C S0-B S0-A S0-D S0-G S0-F
node spikes/slice-0-wave-0/assemble-results.mjs
node spikes/slice-0-wave-0/check-results.mjs spikes/slice-0-wave-0/results.json
```

`make-scratch.sh` builds the scratch repository, linked worktree, clone, run plugin and agents file; `gen-cases.mjs` writes `cases/*.json`; `gen-settings.mjs` renders the generated host settings; `hook-log.mjs` is the logging and deciding PreToolUse hook; `harness.sh` runs one case (refuses without `--max-budget-usd` or past the authorized total); `truth.mjs` computes ground truth; `summarize.mjs` reduces a transcript to a digest. S0-F clones `~/aa-phan-portfolio-v2` with `git clone --local --no-hardlinks`; the user's checkout was never written (`git status --porcelain` still shows only `?? .env`, `for-each-ref` digest and `HEAD` unchanged).
