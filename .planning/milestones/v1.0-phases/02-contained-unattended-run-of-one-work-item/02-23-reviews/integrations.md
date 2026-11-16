Reviewed: docs/system/integrations.md sha256 f71a6d6bcb5a06e0ea466df8aed51a13db012f04c0e642f4fa2cdb1b0b5317bf at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 0 BLOCKER, 7 WARNING, 4 OBS. Rework needed on a contradictory quirk, a wrong exit-code claim, two overstated discard claims, over-35-word sentences, a duplicated install section and an incomplete command table for the version-control tool.

BLOCKED: 0 BLOCKER, 7 WARNING, 4 OBS. Rework needed on a contradictory quirk, a wrong exit-code claim, two overstated discard claims, over-35-word sentences, a duplicated install section and an incomplete command table for the version-control tool.

Target: docs/system/integrations.md, SHA-256 f71a6d6bcb5a06e0ea466df8aed51a13db012f04c0e642f4fa2cdb1b0b5317bf (matches the dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.
Severity: BLOCKER = cannot proceed; WARNING = rework, blocks this gate; OBS = worth noting.

## Findings

### W1 WARNING (high): Quirks bullet contradicts the document and the code
Location: line 377: "The three run ports and the egress proxy are built on every composition, read-only ones included. Only the host and executor descriptors are recorded in the ledger, so the run ports leave no record..."
Defects: (a) the egress proxy is one of the three run ports (lines 33, 49 and the ports table), so "three run ports and the egress proxy" counts four; (b) line 33 says the executor, graph tool, GSD adapter and host descriptors are recorded, so "Only the host and executor" is false.
Evidence: src/cli/composition.ts:186-192 (executor), :203-209 (graph), :227-233 (gsd), :260-266 (host) all call upsertAdapterConfig; :250-252 build runSource, runWorkspace and egress; src/app/deps.ts:57-60 names those three as the run ports.
Fix: "The three run ports (run source, run workspace, egress proxy) are built on every composition, read-only ones included. Only the executor, graph, GSD and host descriptors are recorded, so the run ports leave no record of which adapter a profile ran with."

### W2 WARNING (high): "A refusal exits 3" is wrong for the run-environment refusal
Location: line 159 ("The command refuses to run when `AVARICE_RUN` is set") with line 164 ("A refusal exits 3 and a read or write failure exits 70"); table row line 14 ("`install-host` refuses (exit 3) or fails (exit 70)"); failure table line 372.
Evidence: src/cli/commands/install-host.ts:5-6 ("3 refused; 64 usage or inside a run; 70 internal failure") and :22-23 (usage() returns the AVARICE_RUN refusal, which maps to the usage exit, not EXIT_REFUSED = 3). Exit 3 applies only to the link, non-directory and unmarked-file refusals from installSkill (skill-install.ts:66-79).
Fix: state that the AVARICE_RUN refusal and bad arguments exit 64, and the link/unmarked-file refusals exit 3; correct the table row on line 14.

### W3 WARNING (high): Discard claims overreach the code
Location: line 276: "It works one path at a time, never as a reset or a clean, never deletes a directory..."
Evidence: src/adapters/git/run-workspace.ts:136 (`rmdirSync(target)` in clearDirectoryInTheWay removes an empty directory standing where a snapshot file belongs, called from discard at :269); :272-274 (restore runs once per batch of RESTORE_CHUNK = 200 paths, not one path at a time). removeAddedPath (:113) never removes a directory, but discard as a whole does remove an empty one.
Fix: "never removes a directory except an empty one standing where a snapshot file belongs; restores in batches of 200 literal paths". Keep "no reset, no clean, no write through a symbolic link".

### W4 WARNING (high): Sentences over the 35-word hard maximum (style.md line 7)
- Line 74, sentence 1 (42 words): "`--setting-sources ""` means none of the user's own settings load; everything the host may do comes from files AVARICE generates per invocation under the data root (...)."
- Line 74, sentence 3 (66 words): "Before spawning, a refusal check judges the finished argument list: it refuses `--bare`, anything starting with `--dangerously`, ..."
- Line 304 (36 words): "The child is detached into its own process group, its standard streams are ignored, its working directory is the data root and it is unreferenced, so closing the shell or killing `start --wait` leaves it running."
Fix: split at the semicolon and colon; move the refusal list of line 74 into a bullet list (lists are exempt). Counted with markers stripped, code fences, table rows and list items excluded. Lines 29 (34), 76 (35) and 349 (35) are at or under the cap and not flagged.

### W5 WARNING (medium): Dependency-install detail duplicated from checks-and-evidence.md (one fact, one home)
Location: "### Dependency install" (lines 186-203) and "### Check validation" (205-207): the outcome table (lines 192-201), the write and read sets, the 15 minute timeout, the 32 MiB lockfile limit and the check-validation rules.
Evidence: docs/system/checks-and-evidence.md lines 37-57 ("The dependency install", with its own condition/reason/class table) and 63-73 own the same facts. The packet lists checks-and-evidence.md as a cross-link and "must not cover" control semantics; integrations.md does not link it (Related documents, lines 387-393).
Fix: keep in integrations.md only what is integration-specific (proxy behavior, allowlist `<host>:443`, proxy env variables, loopback port, registry reachability), link to checks-and-evidence.md for outcomes, limits and validation, and add it to Related documents.

### W6 WARNING (medium): Command and timeout tables for the version-control tool are not exhaustive for a reference section
Location: line 245 ("listing the tree allows 60, and clone, checkout and fetch 120"); table lines 257-265.
Evidence: run workspace status, ls-files, restore, read-tree/add -A/write-tree, diff-tree and commit all get 120 s (src/adapters/git/run-workspace.ts:44, :185, :192, :274, :307, :443, :458, :464); run source rev-list, log and diff-tree get 60 s (run-source.ts:18, :39, :70, :135). Commands run but absent from the table: run workspace `rev-parse HEAD`, `rev-parse --verify --quiet <ref>^{commit}`, `rev-parse --show-toplevel`, `rev-parse --path-format=absolute --git-dir`, `log -1 --format=%B`, `ls-tree --name-only` (run-workspace.ts:162, :169, :197-208, :394-414); run source `cat-file -e`, `ls-tree -z`, `rev-parse --show-toplevel` (run-source.ts:82-122); staging `config --file <partial>/.git/config --get` (staging-clone.ts:115); the unselected worktree adapter's `worktree add|list|lock` and `merge-base --is-ancestor` (staging-worktree.ts:41-85), although line 42 says that adapter exists.
Fix: state that run workspace tree operations and the hand-off fetch allow 120 s and run source listings 60 s; add the missing commands to their rows, or say the table lists production commands by group and name where the full list lives.

### W7 WARNING (low-medium): Reason list for launch refusals is incomplete
Location: line 132: "Reasons seen by callers: `host-unavailable`, `host-version-unreadable`, `host-version-not-admitted:<version>`, `sandbox-unavailable`, `hook-script-unreadable`, `hook-self-test`, and the settings-shape reasons."
Evidence: launch-preflight.ts:243-263 also yields `settings-missing`, `settings-invalid`, `settings-key:<path>`, `hook-missing`, `config-hook-missing`, `hook-not-blocking`, `post-hook-missing`, `post-failure-hook-missing`; claude-host.ts:163 yields `invocation-files:<kind>` and :188 `launch-args:<rule>`. "Settings-shape reasons" covers only some of these.
Fix: list them or name the groups (settings, hook configuration, invocation files, launch arguments).

### O1 OBS (high): "today" in a state document
Line 95: "wherever it is loaded, which today means the run purpose". Drop "today" and say "the run purpose loads it, no other purpose does" (src/domain/invocation-scope.ts:60-65).

### O2 OBS (high): Sandbox rule 2 omits a device
Line 326: "Re-allow writes for the system temp areas, `/dev/null` and tty devices." The profile also allows `/dev/dtracehelper` (src/adapters/exec/seatbelt-profile.ts:85).

### O3 OBS (medium): Test-only host list omits the run fake
Line 37: "scripted fake hosts for the map, intel and knowledge passes". test/helpers/fake-run-host.ts exists for the run purpose.

### O4 OBS (medium): "two exceptions noted below" is unclear; index row incomplete
Line 33: "Composition wires one production adapter per port, with two exceptions noted below." The table shows three conditional cases (refusing host, GSD adapter absent, context sources absent) and the worktree adapter that is never selected. Name them. Also README.md line 27 describes integrations.md without the proxy, registry, Claude configuration directory and supervisor (the index routes, so it should name them).

## What I checked and did not flag
- Digest matches the dispatch; HEAD matches the brief.
- Banned dashes: none (em, en, spaced double hyphen outside code spans). No changelog, last-updated, delivery history, plan IDs, absolute home paths or secrets in prose. Headings are sentence case, no question headings. All cross-links (runs, containment, onboarding, indexes-and-context, config-reference, data-model) resolve. The status banner matches every other docs/system file.
- Spawn sites exhaustive: a grep for spawn, execFile, execSync and child_process over src and bin finds sandbox-exec probe (sandboxed-executor.ts:45) and wrapper (:174), mount (local-mount.ts:72), the version-control wrapper (safe-git.ts:139), gsd identity node (locate.ts:60), claude launch (claude-host.ts:286), pgrep (:378), ps (:390), preflight sandbox probe (launch-preflight.ts:124), `claude --version` (:131), hook self-test node (:210), supervisor node (spawn-supervisor.ts:28). No fork, exec, Worker, fetch, https, dns or net client beyond the proxy's `node:net` connect. Line 29 matches this list. GSD verbs and graphify only reach the sandboxed executor.
- `gh` unused is proven: a grep for the word over src and bin finds only the denied command prefix (invocation-scope.ts:151), the refused agent command word (conventions.ts:64), the `~/.config/gh` read-deny (graphify.ts:91, gsd-onboarding.ts:105, checks.ts:120, invocation-scope.ts:289, :486) and a token regex (secret-patterns.ts:15). No spawn or HTTP client names it; the three-places claim in lines 343-345 holds (the token-redaction regex is not a use of the CLI).
- Allowlist proxy: bind 127.0.0.1 ephemeral, host:port parse and lower-casing, 200/403/400/405/502 behavior and recording, idempotent close, resolve-without-address-check, observer failure isolation all match allowlist-proxy.ts:45-135. Install allowlist `<host>:443`, env variables, `ignore_scripts`, 15 minute timeout, 32 MiB lockfile, write and read sets, and the five outcomes match checks.ts:317-398; validation proxy with empty allowlist and no-port fallback match check-validation.ts:76-91; `allowLoopbackPorts` is set only at those two sites.
- Admitted host versions (2.1.312/316/317/318), `--version` 10 s timeout and per-launch read, preflight order, refusal rules in launch-args.ts, env construction (env.ts), reap by session ID (claude-host.ts:375-413), outcome rules (outcome.ts:56-71), transcript 20 MiB, 2 s pipe wait, 10 s kill grace, stream-json 16 MiB line cap, gsd locate order and `1.17.x` admission, gsd verb set and timeouts (15 s, 16 MiB), graphify commands and timeouts, mount heuristic, SQLite version gate (runtime-support.ts), ledger ownership and 0600, safe-git environment and option allowlists, run source (500 commits, 256 KiB, staleness), staging clone reuse rules, supervisor spawn and environment, install-host write rules (skill-install.ts), skill text (avarice-run-skill.ts) all match.
- Port count: `ls src/ports` gives 11 ports plus capability.ts, matching line 33; run-ledger operation list (line 60) matches src/ports/ledger.ts:540-665.
- Not flagged: the add subcommand is denied through the hook allowlist (hook-decision.ts:452, :520) although it is not in DENIED_COMMAND_PREFIXES; line 95 says hook denial, which holds. The GSD guard hook has a 10 s timeout (settings.ts:133) while line 136 states 5 s for AVARICE's own hook entries, which is correct as written. The unused `findGraphifyBinary` import is already in findings.md.
- Prevention/detection/recovery labels (lines 124, 203, 207) are correct; no sentence claims enforcement the code does not perform.
- No embedded instructions in the document.

## Run hygiene
Digest reviewed: f71a6d6bcb5a06e0ea466df8aed51a13db012f04c0e642f4fa2cdb1b0b5317bf
Version-control status after the run: only `?? .planning/config.json` and `?? .planning/milestone.lock`, identical to the status at session start; the report was written outside the repository.

## Answers

Applied: W1 to W7 and O1 to O4. W5: the install outcomes, limits and the check validation rules now live in checks-and-evidence.md, which this document links; only the proxy, the allowlist, the proxy variables and the loopback port stay here. One 36-word sentence in the sandbox profile list remains (a list item).
