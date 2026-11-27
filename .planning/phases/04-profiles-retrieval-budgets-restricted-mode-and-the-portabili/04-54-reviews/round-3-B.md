ROUND 3, GROUP B REVIEW: FAIL (1 BLOCKER, 1 WARNING, 2 NIT)

Header
- Group: B (cli-reference.md install-host / approve / other-profiles bullet / context `codeNode`; config-reference.md retrieval and read-exclude rows; README.md both tables)
- Round: 3
- Reviewer: fresh. I did not open 04-54-reviews/.
- Date: 2026-11-22
- Digests as read (all three match the dispatch):
  - docs/system/cli-reference.md 8f1eb2e382a679aa825985f65c31dea909f47c3b75a22d72c2919e11317e2c62
  - docs/system/config-reference.md 6336f617b890a35b8119a4f64cc423b69bc3f5dcb32a68b6a6ed9fefc2730bbc
  - docs/system/README.md 3e31b43ba3b89ffc51a67c537b796c17c6154d406b0cc7c0dbf1569bf800ca09
- Severity vocabulary: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, or doctrine violation. NIT = polish.

FINDINGS

1. BLOCKER (confidence high). cli-reference.md:571 (the 70 list under install-host Exit). The literal message is wrong.
   - Quote: "`failed: cannot install the avarice-run skill: <code>`, a write error."
   - Problem: the command prints `failed: ` plus `describeError(e)`. For an internal error that adds the prefix `internal error: `. The real line is `avarice install-host: failed: internal error: cannot install the avarice-run skill: <code>`.
   - Evidence:
     - src/cli/commands/install-host.ts:82 (`failed: ${describeError(e)}`)
     - src/adapters/sqlite/db.ts:35-36 (`internal error: ${cause}`)
     - src/adapters/host-claude/skill-install.ts:~96 (cause `cannot install the ${skill.name} skill: <code>`)
   - Fix: write `failed: internal error: cannot install the avarice-run skill: <code>`. Alternatively write `failed: ...`, as the next bullet does. The same prefix applies to the hook bullet's `...` (`internal error: cannot install the attended hook: <code>`), which the elision already covers.

2. WARNING (confidence high). README.md:39 contradicts README.md:61.
   - Quote: "A proposal with no counterpart has nothing built yet."
   - Problem: the last table row maps implementation-plan.md, reference-system-comparison.md and reference-system-deep-dive.md to "none: planning and comparison material, not a description of the system". They have no counterpart because they are not descriptions of anything built, not because nothing is built.
   - Evidence: README.md:61 against the sentence at README.md:39.
   - Fix: "A proposal with no counterpart either has nothing built yet or is planning material, not a description of the system."

3. NIT (confidence medium). cli-reference.md:105 (the exit 64 row).
   - Problem: the row lists unknown IDs only for `resume`, `supervise`, `contract`, `decide` and `cancel`. `approve` also exits 64 for an unknown request or approval ID and for a profile whose data root another user owns. The approve section at lines 804-805 states this correctly, and the global row is only a summary. The exit 3 row does name `approve`, so the treatment is inconsistent.
   - Evidence: src/cli/commands/approve.ts:57-59 (`not_found` returns EXIT_USAGE), :75-78 (`ownsProfile` refusal returns EXIT_USAGE).
   - Fix: add `approve` to the unknown-ID list and to the 64 refusal wording.

4. NIT (confidence medium). config-reference.md:294.
   - Quote: "The number must be finite and above 0, and an integer where marked."
   - Problem: the three retrieval override names are not in the table and are always integers. Their ceiling is the profile's cap (`searches` has the `400n` tool-call limit as its ceiling), not "the limit the preset gives for n items".
   - Evidence: src/domain/run-contract.ts:341-347 (`retrievalLimits`) and :370-374 (integer check).
   - Fix: add "The three retrieval names must be integers; the ceiling of `retrieval.fullReads` and `retrieval.fullReadBytes` is the profile's cap."

CHECKED AND NOT FLAGGED (coverage)

- Digests: all three match.
- Dashes: no em dash, en dash or ` -- ` in any of the three documents.
- Sentence length over 35 words:
  - Period-split, code and table rows excluded, links and bold stripped, in all three documents. The only sentences over 35 are cli-reference.md:7 (49 words, a reference list, exempt) and :732 (36 words, a `schedule` bullet outside this group).
  - Every sentence in the audited sections is 35 words or fewer. The longest are cli-reference.md:69 (35) and :563 (35).
- Delivery history and file paths in prose: none in the audited sections. The paths in the openings are the permitted once-in-the-opening mentions.
- Code-grounded claims that hold:
  - install-host:
    - Config dir resolution: flag, then `CLAUDE_CONFIG_DIR`, then `~/.claude`.
    - Refusals: `AVARICE_RUN`, process tree, and an unreadable process table (fails closed), all exit 64 before the profile is resolved.
    - The hook entry script check (`AVARICE_HOOK_ENTRY`, else the checkout script) runs first, exits 3, and its message text matches. A symlink to a file is followed.
    - Skill file rules: mode 0700 for the config dir, 0755 for new subdirs, 0644 for the file, O_NOFOLLOW, 256 KiB cap, marker line, temp file plus rename.
    - Hook entry: matcher `Bash`, timeout 5, `onFailure: block`, marker `--avarice-attended-hook`, settings cap 1 MiB, new file mode 0600, indent and mode kept, mixed-entry refusal.
    - Exit lines and message forms: 3 and 70 messages, adapter records `host-skill:avarice-run` and `host-hook:attended`, written also when unchanged.
    - Not read-only; the skill text claims match avarice-run-skill.ts.
  - approve:
    - ID grammar `apr_`/`apv_` plus 4-64 alphanumerics.
    - TTL 30 minutes.
    - Params summary: 80-character value and 400-character summary clips with an ellipsis, key order, `gitOptions`/`env`/`line`/`cwd`.
    - Stdout lines, the `not approved` path (exit 0), exit table (3 conflict, 64 not_found / no terminal / refusals / owner check, 70 internal).
    - `--revoke` is boolean and `--revoke=<id>` works.
  - Other-profiles bullet (cli-reference.md:68):
    - EACCES/EPERM denies the whole root and goes on; a corrupt config is skipped.
    - Any other read failure or an unlistable profiles directory exits 70 with `cannot read the other profiles of this machine: <cause>`.
    - Not applied to `doctor`, which composes its own deps.
    - The omission that an absent profiles directory (ENOENT/ENOTDIR) is not an error is harmless.
  - context `codeNode`:
    - Set only by the graph source for `fileType === 'code'`, regardless of `untrusted`.
    - Carried through find, read and the pack item; `profile` and `accessScope` are appended last.
  - Retrieval rows:
    - Nine caps and their built-in values: 2000, 65536, 200, 10000, 40, 30, 20, 262144, 5.
    - Lower-only validation messages; `budget:retrieval.fullReads` and `budget:retrieval.fullReadBytes` rule names.
    - A Read counts as 1 file, and its bytes are those of the requested lines; a single over-cap Read is charged cap+1 and refused.
    - `searches` limit is the toolCalls limit (400n); `broadDiscovery` limit is 1 or 0.
    - Override names are the three retrieval names plus seven budget names.
  - Read-exclude row: preset `['.git']`; a plain entry is a directory at any depth; the hook does not read `readExclude`; the onboarding preset list (`.git`, `build`, `coverage`, `dist`, `node_modules`, `vendor`) matches.
  - README:
    - All 21 documents and 9 diagrams exist, and every document is listed.
    - Twenty commands match the COMMANDS array.
    - All 14 proposal documents are covered by the table.
    - ADR-006 is still Proposed.
    - ADR-016 exists, and findings.md carries the AC-8 bound and the recorded result and notes that the harness has no document.
    - The ADR-009 "no caller" claim matches profiles-and-credentials.md:118.
    - The ADR-014 and ADR-015 targets cover their topics.
    - Per-document descriptions match the headings.
    - "Nine flows" matches processes.md.

Not flagged but noted for the caller: install-host replaces the first marked entry and removes further marked copies. The doc says only that "only an entry that carries the marker is ever replaced". It is true, but it omits the duplicate removal (attended-hook-install.ts, the `owned.includes(index) ? []` branch). I judged it not misleading.

Read-only sweep: git status after the run shows only the two untracked planning files that were present at the start (.planning/config.json, .planning/milestone.lock). I wrote helper scripts only under /tmp/rv3b, outside the repository. A /tmp/sl2.py that I did not create was already on disk and I did not use it.

VERDICT: FAIL. 1 BLOCKER, 1 WARNING, 2 NIT.
