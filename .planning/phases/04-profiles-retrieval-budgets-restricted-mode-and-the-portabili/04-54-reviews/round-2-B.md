VERDICT: FAIL. BLOCKER 0, WARNING 4, NIT 2.

# Round 2, group B, fresh-eyes review

- Group: B (cli-reference.md sections install-host, approve, other-profiles bullet, context `codeNode`; config-reference.md retrieval rows and read-exclude row; README.md both tables)
- Round: 2
- Reviewer: fresh. I did not open 04-54-reviews/.
- Date: 2026-11-22
- Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04 (branch worktree-phase-04)
- sha256 as read. All three match the dispatch; no mismatch.
  - docs/system/cli-reference.md: 3e84fe6c97a35f59b770224555be0c0f7462bd58d11092acd82064962699cf0f
  - docs/system/config-reference.md: fc7997ff6625882f89b27411fb8b244e6c6296525b134fe7862510b3fcd68964
  - docs/system/README.md: ab813bb0a86018c2a7e2b9cccb9a7cd15f40c664dee03d4d372fb25d46c151b1

Severity vocabulary: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, or doctrine violation (sentence over 35 words in running prose). NIT = polish.

## Findings

### W1. WARNING (confidence high). README.md:7, an overstated claim
- Quote: "Each document ends with the quirks a reader is likely to trip over."
- Problem: the claim is false for many documents. The last `##` heading of each is:
  - indexes-and-context.md: "Verification"
  - integrations.md: "Related documents"
  - processes.md: "Diagram index"
  - history.md: "2026-11-06: the run slice documented"
  - findings.md: "Proposal drift"
  - unknowns.md: "Campaign-wide"
  - coverage.md: "Outstanding"
- Cause: the index states something its sources do not support. The source wins and the index is the bug.
- Evidence: `grep -n '^## '` on each file in docs/system. cli-reference.md:877 and config-reference.md:454 do end with Quirks.
- Fix: say "Most descriptive documents carry a Quirks section for what a reader is likely to trip over", or "Reference and descriptive documents carry a Quirks section."

### W2. WARNING (high). cli-reference.md:68, a 38-word sentence in running prose (other-profiles bullet)
- Quote: "Any other failure to read one, and a profiles directory that cannot be listed, stops the command with exit 70 (`cannot read the other profiles of this machine`, naming the cause and, for an unreadable configuration, the profile)."
- Fix: split it. For example: "Any other failure to read one stops the command with exit 70. So does a profiles directory that cannot be listed. The message is `cannot read the other profiles of this machine`, with the cause and, for an unreadable configuration, the profile."
- The content itself is correct. It matches src/adapters/fs/profile-registry.ts (EACCES/EPERM deny the whole root and go on; invalid is skipped; other failures are `unavailable`) and src/cli/composition.ts:313 (EXIT_INTERNAL=70).

### W3. WARNING (high). cli-reference.md:549, a 45-word sentence (install-host)
- Quote: "A run is recognized by the `AVARICE_RUN` environment variable, which a contained invocation has (`avarice install-host: refused inside a run (AVARICE_RUN is set)`), and by its process tree, when a run supervisor is an ancestor of the command (`refused from inside a run's process tree`)."
- Fix: split at "and by its process tree". For example: "A run is recognized by the `AVARICE_RUN` variable (`... refused inside a run (AVARICE_RUN is set)`). It is also recognized by its process tree, when a run supervisor is an ancestor of the command (`refused from inside a run's process tree`)."
- The facts are correct. src/cli/identity.ts:34-37 and src/adapters/proc/ancestry.ts:70-73 confirm the checks, including the fail-closed case.

### W4. WARNING (high). cli-reference.md:553, a 44-word sentence (install-host)
- Quote: "A script that does not exist, is not a regular file or is not readable is refused with exit 3 and `avarice install-host: refused: the hook entry <path> does not exist | is not a regular file | is not readable; nothing was written`."
- Fix: "Such a script is refused with exit 3." Then give the message form as a separate sentence, or move it to a code span after a colon.
- The facts are correct. src/cli/commands/install-host.ts:run and hookEntryProblem confirm them.

### N1. NIT (medium). cli-reference.md:567, the install-host Exit line
- Its final clause runs about 56 words: "70 failure, including a write error (...), a failure to write the hook (...) and a failure to record either (...)".
- Exit lines are reference-list-like and exempt, so this is not a WARNING. It would read better as a short list, one bullet per exit code.

### N2. NIT (medium). Other long sentences outside group B scope, for the owner of the next group
- cli-reference.md:182 (48 words), 309 (37), 311 (48), 331 (69, an Exit line), 484 (56, an Exit line), 521 (62, an Exit line), 609 (38), 686 (65), 843 (41).
- I counted these with a rough splitter and did not verify them. Treat them as pointers only.

## Verified correct against the code (no finding)

**install-host (src/cli/commands/install-host.ts, src/adapters/host-claude/attended-hook-install.ts, skill-install.ts, avarice-run-skill.ts)**
- Usage and exit paths:
  - Exit 3 for a hook-entry problem checked before any write, for a skill `denied`, and for a hook `denied` (skill stays installed).
  - Exit 64 for usage or inside a run; exit 70 for internal failure.
  - All error strings quoted in the doc match the code: `failed: cannot install the avarice-run skill: <code>`, `the skill is in place; the attended hook failed`, and both `record failed` forms.
- Defaults and limits:
  - The `--config-dir` default chain matches: flag, then non-empty `CLAUDE_CONFIG_DIR`, then `~/.claude`. A bare or empty flag is exit 64.
  - Directory modes: config dir 0700, created skill dirs 0755. File modes: SKILL.md 0644, new settings.json 0600, with an existing mode preserved.
  - Size limits: SKILL.md over 256 KiB is refused; settings.json over 1 MiB is refused.
- Hook entry:
  - Matcher `Bash`, timeout 5 s, `onFailure: block`, marker `--avarice-attended-hook`.
  - Settings refusals: symlink, not a JSON object, mixed marker.
  - Statuses are installed, unchanged or updated.
  - The two adapter records, `host-skill:avarice-run` and `host-hook:attended`, are written even when unchanged.
- Skill text: skill text, front-matter tools and the owner-only command list match. The marker line is `<!-- written by avarice install-host -->`.

**approve (src/cli/commands/approve.ts, src/domain/approval.ts)**
- IDs and limits:
  - ID grammars `apr_`/`apv_` with 4 to 64 alphanumerics.
  - TTL 30 min (`APPROVAL_TTL_MS`).
  - Value cut at 80 characters, summary at 400, with an ellipsis.
  - `--revoke` is boolean and `--revoke=<id>` works.
- Exit codes:
  - Exit 3 on conflict (already approved, revoked or consumed; confirmed at ledger.ts:680 and :719).
  - Exit 64 for not_found, invalid, no terminal to ask, and a profile owned by another user.
  - Exit 70 on internal failure.
- Refusal and output:
  - Refusal before the profile is resolved, covering run marker, no terminal, and process tree.
  - The params keys `gitOptions`, `env`, `line` (digest) and `cwd` (attended call) match privileged-commands.ts and the hook.
  - Output lines match.
  - The doc does not state exit 0 for "not approved" or a revocation. That is acceptable, since the code returns 0 for both.

**Other-profiles bullet**
- Behaviour and exit codes confirmed against profile-registry.ts, composition.ts:313 and profile-config.ts (isPermissionRefusal, invalid versus unavailable). See W2 for the wording defect.

**context `codeNode` (src/ports/context-source.ts:76, src/app/context.ts:238, src/adapters/context/gsd-graph.ts:184)**
- Set only for graph nodes with `fileType === 'code'`, whether or not the excerpt is untrusted. It is carried through to the pack item. The doc matches.

**config-reference.md retrieval rows (src/domain/retrieval-rules.ts, src/app/context.ts, src/app/retrieval-guard.ts, src/hook/pre-tool-use.ts, hook-decision.ts, run-contract.ts)**
- All nine built-in values match `RETRIEVAL_CAPS`: 2000, 65536, 200, 10000, 40, 30, 20, 262144, 5.
- Section parsing:
  - Caps are lower-only and must be whole numbers above 0, with an error naming `retrieval.<key>`.
  - `maxPages`: no local source declares `paged` (grep).
- Notes and cuts in context.ts:
  - The `indexEntries` cut and its note.
  - The `returnedBytes` cut: the excerpt that crosses the limit is truncated and later ones keep only the marker.
  - Snippets past 30 are listed as omitted.
- Run counters:
  - `fullReads` counts one file per Read.
  - `fullReadBytes` counts the bytes of the requested lines (measureRead), and a single Read above the cap is refused.
  - The rule names `budget:retrieval.fullReads` and `budget:retrieval.fullReadBytes` match.
  - `--budget retrieval.*` is lower-only. The ceiling for `searches` is the tool-call limit.
  - `broadDiscovery` is 1 when authorized, else 0.

**config-reference.md read-exclude row (src/adapters/context/git-files.ts:45-58)**
- A plain entry (no `*` or `?`) is a directory at any depth.
- The hook does not read `readExclude` (no reference in src/hook or hook-decision).
- The run preset's `readExclude` is `['.git']`.
- The `AVARICE_RUN` rows at config-reference.md:30 and :458 match the code: the shell gate, install-host, digest and the owner commands.

**README.md tables**
- Every linked file exists: 21 system documents, all 14 proposal files, and ADR-005, 006, 009, 013, 014, 015 and 016.
- ADR-016 exists and is Accepted. findings.md does hold the AC-8 bound and the recorded result, and the evaluation harness has no document in this tree.
- The ADR-006 "still marked Proposed" note is correct.
- The processes.md row matches: nine flows and nine diagrams under docs/system/diagrams.
- The "twenty commands" claim matches `COMMANDS` in src/cli/main.ts.

**Mechanical sweep**
- No em dash, en dash or ` -- ` in any of the three files.
- No delivery history in prose: no phase, plan or threat IDs, and no `src/` paths outside the openings of cli-reference.md:3 and config-reference.md:3, which the doctrine allows.
- Headings are in sentence case.
- No frontmatter in these files.
- Sentence-length sweep (code fences and table rows excluded):
  - config-reference.md: none over 35 words.
  - README.md: none over 35 words.
  - cli-reference.md: see W2 to W4, N1 and N2.

**Read-only proof**
- `git status --short` after the run shows only the two untracked `.planning/config.json` and `.planning/milestone.lock`, which were already present at the start. No tracked file changed.
- Scratch scripts are in /tmp only.
