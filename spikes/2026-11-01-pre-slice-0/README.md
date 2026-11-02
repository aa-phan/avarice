# Pre-slice-0 spikes, 2026-11-01

Three spikes on unknowns that could invalidate the slice 0 design. Host: Claude Code 2.1.316, GSD 1.17.0, graphify 0.9.53, macOS Seatbelt, Apple silicon. Every containment result below comes from a real `claude -p` run (model `haiku`, `--max-budget-usd 0.40`) against a scratch repository; outcomes were checked on the filesystem, not taken from the model's report. Total model spend was under $0.10.

| Spike | Result | Design impact |
|---|---|---|
| Containment 1: PreToolUse coverage | Pass | None |
| Containment 5: file-level `denyWrite` | Pass | None |
| Containment 6: empty `excludedCommands` | Pass | None |
| Containment 7: `--setting-sources ""` and skills | Fail as specified; workaround verified | Launch line gains `--plugin-dir` and `--agents` |
| New: working directory always writable | Found | Write scope inside the worktree is weaker than specified |
| New: config directory unwritable | Found | Worktrees and scratch must live outside `~/.claude*` |
| Knowledge pass | Answered; `merge-graphs` unusable as designed | Replace `merge-graphs` with an AVARICE merge |
| SQLite on Node 22.13 | Node 22.13 lacks the WAL-reset fix | Raise the minimum Node to 22.22.3 |

## Containment

Harness: `gen.py` writes the run settings (shape of [containment.md](../../docs/containment.md#generated-host-settings)), `run.sh` launches `claude -p` with the proposed flags, `hook.js` is a PreToolUse hook that logs its input and can crash or hang, `init.py` summarizes the stream-json `init` and `result` events.

### Limitation 1: PreToolUse in `-p` with `dontAsk` (pass)

The hook fired for every tool call: foreground Bash, Bash with `run_in_background: true` (the flag reaches the hook input), Read, Agent, and a Bash call inside a `general-purpose` subagent (hook input carries `agent_id`). `permission_mode` in the hook input is `dontAsk`.

`onFailure: "block"` holds in `-p`: a crashing hook and a hook exceeding its 5 s timeout each blocked the call (`blocking because onFailure is "block"`), counted as a permission denial, and no file was written.

### Limitation 5: file-level `denyWrite` on Seatbelt (pass)

With `allowWrite: [<repo>/src]` and `denyWrite: [<repo>/src/protected.txt]`, `echo >>` and a Python `open(...,"a")` on `protected.txt` fail with `operation not permitted`, while `src/new.txt` is writable. Without the `denyWrite` entry both writes succeed. Both `/abs` and `//abs` path forms work.

The Edit tool is not subject to the sandbox: `Edit` on `src/protected.txt` succeeded because `Edit(src/**)` allowed it. This matches the spec, which leaves file-level limits for file tools to the hook.

### Limitation 6: no command leaves the sandbox (pass)

With `excludedCommands: []` and `allowUnsandboxedCommands: false`: `dangerouslyDisableSandbox: true` is ignored (write to `~` still denied), `git init ~/x` and `git config --global` fail (git is sandboxed), and `curl https://example.com` fails at the proxy (`host is not on the allow list`). Ground truth: nothing created in `~`, `~/.gitconfig` unchanged.

### Limitation 7: `--setting-sources ""` (fail as specified, workaround verified)

The empty list is accepted, and user, project and local settings are not loaded. But the session then has **no GSD or graphify skills** (19 built-in skills only); `--setting-sources user` loads 68 GSD and graphify skills, and `--setting-sources project` (the spec's fallback) loads none. GSD agents (`gsd-planner`, `gsd-executor`, ...) are likewise absent.

| Mechanism tried with `--setting-sources ""` | Skills | Agents |
|---|---|---|
| `--add-dir <dir>` with `<dir>/.claude/skills/` | Not loaded | n/a |
| `--plugin-dir <generated plugin>` (skills symlinked) | Loaded, namespaced `avarice-run-skills:<name>`; bare `/gsd-help` still resolves | Loaded only when copied (symlinks ignored), and only under the namespaced name: `Agent(subagent_type: "gsd-executor")` fails with `Agent type 'gsd-executor' not found` |
| `--agents <json>` generated from `~/.claude/agents/gsd-*.md` | n/a | Loaded under the bare name; a `gsd-executor` subagent ran and replied |
| Generated `CLAUDE_CONFIG_DIR` with only `skills/` | Loaded | Session is `Not logged in` (credentials are per config directory) |

Verified launch shape: `--setting-sources ""` + `--plugin-dir <data root>/runs/<run>/plugin` (skills the contract allows, symlinked) + `--agents <data root>/runs/<run>/agents.json` (agent definitions the contract allows, converted from frontmatter and body). The `--agents` file for two GSD agents is about 97 KB.

### New finding: the working directory is always writable

Seatbelt allows Bash to write anywhere under the invocation's working directory regardless of `allowWrite`. With only `src/` listed, `echo > docs/a.md` succeeded. A `denyWrite` on the worktree root overrides `allowWrite` on `src/` (deny wins, nothing writable). Denying each existing out-of-scope sibling (`docs/`) blocks those paths, but new files and directories at the worktree root (`newroot.txt`) can still be created. `.avarice/` was protected only because a permission deny rule matched the shell redirect.

### New finding: paths under the Claude config directory are unwritable

The first runs used a scratch repository under `~/.claude-edu/jobs/...`: every Bash write failed, including inside `allowWrite` and the working directory. Moving the repository to `~` fixed it. Run worktrees and `<data root>/runs/<run>/scratch` must not live under `~/.claude*`.

## Knowledge pass

| Question | Answer | Evidence |
|---|---|---|
| Can `/graphify` be limited to chosen documents? | Yes, by directory plus `.graphifyignore` (gitignore syntax, including allowlist negation `docs/*` then `!docs/arch.md`). A single-file path finds nothing. Symlinks pointing outside the scan root are refused (`skipped_sensitive`). `detect()` also has an `extra_excludes` parameter that the CLI does not expose | `detect.py` against a fixture |
| Where does it write? | The skill: `graphify-out/` in the current working directory. The CLI: `graphify extract <path> --out <dir>` writes `<dir>/graphify-out/` and leaves the scanned tree untouched | Fixture runs |
| Exact command set | The skill runs about 15 inline `$(cat graphify-out/.graphify_python) -c "..."` scripts plus `mkdir`, `rm`, `find`, `graphify export/query`, and Agent subagents for document chunks; Step 1 may run `uv tool`/`pip` when graphify is missing. Command-text rules cannot meaningfully scope inline Python, so the sandbox write set is the boundary, and graphify must be preinstalled (no network) | `~/.claude/skills/graphify/SKILL.md` |
| Does `merge-graphs` keep confidence? | Tiers and `confidence_score` survive (EXTRACTED, INFERRED 0.8, AMBIGUOUS 0.2 all present after merge). GSD's reader drops edges by the `confidence` tier, so the tiers are usable | Fixture merge; `gsd-core/bin/lib/graphify.cjs:282-331` |

**`merge-graphs` is unusable for the designed merge.** It is a cross-repository merge: it prefixes every node ID with a tag from each input's directory name (`code::src_a`, `kp::docs_arch`). A document edge to `src_a` becomes `kp::src_a`, a phantom node, instead of linking to `code::src_a`, so every document-to-code edge is severed. It also drops `built_at_commit`, which the project record checks against the onboarded revision. The fix is an AVARICE-owned merge in one ID space (the same union-by-id the skill's own Part C performs), rewriting document `source_file` from the corpus manifest to the real path, stamping `built_at_commit`, then `graphify cluster-only`.

## SQLite on the minimum Node

sqlite.org/wal.html: the WAL-reset bug affects 3.7.0 through 3.51.2; fixed in 3.51.3, backported to 3.44.6 and 3.50.7.

| Node | Bundled SQLite | WAL-reset fix |
|---|---|---|
| 22.13.0 (current minimum) | 3.47.2 (verified at runtime) | No |
| 22.22.1 | 3.51.2 | No |
| **22.22.3** (LTS, 2026-05-13) | 3.51.3 (verified at runtime) | Yes |
| 24.15.0 (2026-04-15) | 3.51.3 | Yes |
| 26.9.0 (this Mac) | 3.53.4 | Yes |

Versions per release were read from `deps/sqlite/sqlite3.h` at each Node tag; 22.13.0 and 22.22.3 were confirmed with official binaries checked against `SHASUMS256.txt`. Node 22.13.0 also cannot run `.ts` files without `--experimental-strip-types`, which ADR-001's no-build-step development relies on; 22.22.3 runs them unflagged. `node:sqlite` prints an `ExperimentalWarning` on both.
