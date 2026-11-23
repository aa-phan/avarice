FAIL: 0 BLOCKER, 3 WARNING, 2 NIT.

# Review report: group B, round 1

- Group: B
- Round: 1
- Reviewer: fresh
- Date: 2026-11-22
- Worktree: /Users/aphan/avarice/.claude/worktrees/phase-04, HEAD 826ed28
- Review is read-only. `git status --short` after the run shows only the two untracked `.planning/` files that were there at the start. My one scratch file in /tmp was removed.

SHA-256 of each document as read (all three match the dispatch):
- docs/system/cli-reference.md: 937882f0f9ce43bfb859b7a35c0034930f71340f20c9d53613e74301f1e53cf2
- docs/system/config-reference.md: fc7997ff6625882f89b27411fb8b244e6c6296525b134fe7862510b3fcd68964
- docs/system/README.md: da33eb7bafce92c1b3aca7ade312c91fbd057fb3d76af93f4c461afa0eb66e58

Severity: BLOCKER is a factual error against the code. WARNING is a misleading claim or a doctrine violation. NIT is polish.

## Findings

### 1. WARNING, cli-reference.md:68 (sentence over the 35-word hard maximum)
- Problem: the second sentence of the new other-profiles bullet is about 45 words. It joins the refusal condition, the deny behaviour and the `init`/`repo add` consequence behind one colon and one `so`. Doctrine hard maximum is 35 (style.md:7).
- Quote: "A configuration the system refuses to open (a forbidding mode or a sandbox deny) does not stop the command: the whole root of that profile is denied and the command goes on, so `init` and `repo add` run beside a profile this one may not read."
- Fix: split it. For example: "A configuration the system refuses to open (a forbidding mode or a sandbox deny) does not stop the command. The whole root of that profile is denied and the command goes on, so `init` and `repo add` run beside a profile this one may not read."
- Confidence: high.

### 2. WARNING, cli-reference.md:68 (the message does not always name a profile)
- Problem: the bullet says the exit-70 failure names "the profile and the cause". The code does so only for a config that exists but cannot be read for a reason other than EACCES or EPERM. For a profiles directory that cannot be listed, the message names the config home, not a profile. For a failed `lstat` of a profile directory it carries only the error text.
- Evidence:
  - src/adapters/fs/profile-registry.ts:71 builds `cannot list the profiles under ${home}: <code>`.
  - src/adapters/fs/profile-registry.ts:87 builds `cannot read the config of profile ${entry} under ${home}: ...`.
  - src/adapters/fs/profile-registry.ts:101 builds `cannot read the other profiles: <message>`.
  - src/cli/composition.ts:313 prefixes `cannot read the other profiles of this machine`; src/cli/composition.ts:117-118 returns exit 70.
- The exit code 70 and the deny-on-EACCES/EPERM behaviour are correct: src/adapters/fs/profile-config.ts:23 sets `PERMISSION_CODES` to EACCES and EPERM, and src/adapters/fs/profile-registry.ts:83-85 denies the whole root. A corrupt config is skipped at registry:88, also as documented.
- Fix: write "(`cannot read the other profiles of this machine`, naming the cause and, for an unreadable configuration, the profile)".
- Confidence: high.

### 3. WARNING, cli-reference.md:795 (approve output, sentence over the hard maximum)
- Problem: one sentence is about 42 words.
- Quote: "The `params:` line is the summary of the bound parameters in key order: the parameters of the command, and `gitOptions`, `env`, `line` (the digest of the exact command text) and `cwd` (the directory of an attended call) when the request has them."
- The content is right. `gitOptions` and `env` are in src/domain/privileged-commands.ts:748 and :833. `cwd` is in src/hook/pre-tool-use.ts:692. The 80-character and 400-character clip limits match src/domain/approval.ts:10-11. The 30-minute expiry matches `APPROVAL_TTL_MS` at approval.ts:7.
- Fix: split after "key order", for example: "The `params:` line summarises the bound parameters in key order. Beside the command's own parameters it shows `gitOptions`, `env`, `line` (the digest of the exact command text) and `cwd` (the directory of an attended call) when the request has them."
- Confidence: high.

### 4. NIT, cli-reference.md:567 (the install-host Exit line is a very long sentence)
- The line carries about 65 words in one run. The same pattern, between 50 and 62 words, appears in the Exit lines at 331, 484, 521 and 686.
- I did not count these as violations. The doctrine exempts reference lists from the length cap, and these are compact code-to-meaning lists.
- The 567 line is the one in scope for the install-host check. It is accurate against src/cli/commands/install-host.ts (EXIT_REFUSED 3, EXIT_INTERNAL 70) and attended-hook-install.ts (a `denied` error gives exit 3, `internal` gives 70). Optional fix: one sentence per exit code.
- Confidence: medium.

### 5. NIT, README.md:39 (scope of the "no counterpart" sentence)
- The sentence reads "The decision records not listed here have no counterpart of their own." The unlisted ADRs include 001 to 004, 007, 008, 010 to 012. ADR-008 (repository onboarding), ADR-003 (local persistence) and ADR-004 (modular monolith) plausibly share ground with onboarding.md, data-model.md and overview.md.
- "Of their own" hedges this, and I did not verify the claim ADR by ADR. If the owner wants it exact, either list those ADRs or reword to "have no document written for them alone".
- Confidence: low.

## Verified, no finding

### install-host (cli-reference.md:538-571)
- Hook-entry pre-check, exit 3, the three messages (`does not exist | is not a regular file | is not readable`) and the "nothing written" claim match install-host.ts:61-67 and attended-hook-install.ts:62-71.
- Skill refusals match skill-install.ts:60-81:
  - Symbolic link or non-directory at `skills` or `skills/avarice-run`.
  - `SKILL.md` that is a symbolic link or not a regular file, or over 256 KiB (`MAX_EXISTING_BYTES`).
  - A missing marker line.
- Modes and write path match skill-install.ts: config directory 0700, created sub-directories 0755, file 0644, temporary file plus rename.
- Settings entry:
  - Matcher `Bash` and marker `--avarice-attended-hook` match.
  - Timeout 5 and `onFailure: block` match (`HOOK_TIMEOUT_SECONDS`).
  - Size limit 1 MiB matches `MAX_SETTINGS_BYTES`.
  - New-file mode 0600 and indentation preservation match.
  - The refusal cases (symbolic link, not a JSON object with hook structure, mixed marker) match.
- Output blocks, the order skill then hook, the "skill is in place" messages, the two adapter records (`host-skill:avarice-run`, `host-hook:attended`) and the upsert on unchanged files all match install-host.ts:73-108.
- Skill text claims (allowed tools, owner-only commands including the non-command `budget`, numbered options, `avarice context` before whole files) match avarice-run-skill.ts:24-38.
- The quirk at line 896 (skill written first, exit 3 or 70 possible) is correct.

### approve (cli-reference.md:781-808)
- Exit codes match approve.ts: conflict gives 3, not-found and invalid give 64, other errors give 70, the ownership refusal gives 64.
- The ID grammars (`apr_` and `apv_`, 4 to 64 alphanumerics), `--revoke` as a boolean flag with the `--revoke=<id>` form, and the question text path all match.
- The 64 for "no terminal to ask on" matches approve.ts:92-95.

### `codeNode` (cli-reference.md:514)
- The field is set on every graph node with `fileType === 'code'`, whether or not the excerpt is untrusted: src/adapters/context/gsd-graph.ts:184 and :211, src/ports/context-source.ts:76 and :91, src/app/context.ts:56-57 and :238.
- The stated key order (confidence, untrusted, codeNode, confirmed, then profile and accessScope) matches `packItem` in src/app/context.ts.
- The `--json` form prints the report directly (src/cli/commands/context.ts:135).

### Other-profiles exit-code bullet (cli-reference.md:68) and the gate rows (84-85, 104)
- The facts hold; only the wording problems in findings 1 and 2 remain.
- The gate rows 84-85 and 104 match src/cli/profile-gate.ts:25-31: invalid gives 3, unavailable gives 70.

### config-reference.md retrieval rows (lines 105-121)
- Built-in values match `RETRIEVAL_CAPS` in src/domain/retrieval-rules.ts:
  - indexEntries 2000
  - returnedBytes 64 KiB
  - searchHits 200
  - queryTimeoutMs 10000
  - snippetLines 40
  - snippets 30
  - fullReads 20
  - fullReadBytes 256 KiB, which is 262144
  - maxPages 5
  - There are nine caps, matching the "nine retrieval caps" claim at line 81.
- The profile section can only lower a cap, with the error text as stated (retrieval-rules.ts `parseRetrievalSection`).
- Per-run override names are exactly the three at src/domain/run-contract.ts:294. The `searches` limit is the tool-call limit (run-contract.ts:111). `broadDiscovery` is 1 or 0.
- Read counting:
  - One file per Read whatever the range: chargeRows applies one unit to `retrieval.fullReads`.
  - Bytes are the bytes of the lines asked for: `measureRead` in src/hook/pre-tool-use.ts.
  - A single Read over the cap is charged cap+1 and is refused whatever is left: pre-tool-use.ts:244-275.
  - The rule names `budget:retrieval.fullReads` and `budget:retrieval.fullReadBytes` match src/domain/hook-decision.ts:132-133.
- The `retrieval.fullReads` and `retrieval.fullReadBytes` names inside the doc match the ledger rows (src/domain/retrieval-rules.ts `RETRIEVAL_ROWS`). The cross-link `containment.md#retrieval-budgets` exists (containment.md:397).
- Line 274 and line 294 (three retrieval names plus seven budget names) match run-contract.ts.

### config-reference.md read-exclude row (line 320)
- The routine preset's `readExclude` is `['.git']` (src/domain/run-contract.ts:74).
- The hook does not read the list. No file under src/hook or src/domain/hook-decision.ts references `readExclude`.
- The context file search does read it, and treats an entry with no `*` or `?` as a directory at any depth (src/adapters/context/git-files.ts:45-57). The link target `indexes-and-context.md#the-sources` exists.

### README.md
- Every file in docs/system is listed once in the documents table: 21 documents plus README itself and the `diagrams/` directory.
- Every `../` link in both tables resolves to an existing file.
- The new ADR-016 row is accurate:
  - docs/decisions/ADR-016-ac8-token-bound.md exists and is Accepted.
  - findings.md:339 and :278 carry the AC-8 bound, the recorded result and the missing harness document.
- The status wording ("`changed after review`") matches coverage.md:94. "AC-8" is a requirement ID, not delivery history, so I did not flag it.

## Mechanical sweep
- Em dashes, en dashes and ` -- `: none in any of the three files.
- Delivery history in prose (phase numbers, plan IDs, finding or threat IDs, 40-character SHAs): none. The only `src/` and `.ts` paths are in the document openings (cli-reference.md:3, config-reference.md:3), which is the allowed once-only naming.
- Headings: all in sentence case. No changelog section and no "last updated" field.
- Sentence length: checked outside code fences and table rows. The only over-35 sentences in changed or checked sections are findings 1 and 3. The remaining Exit-line lists are noted in finding 4.
- Exit codes stated anywhere in the changed sections match the code. This covers the install-host and approve tables, the other-profiles bullet, the dispatch rows, and the exit-code rows at lines 99-108.
- Command count: "twenty commands" matches the twenty-name list.
- Profile config key count: "14 keys" matches the table rows (config-reference.md:73-88).
- No instructions embedded in the documents under review.

## Verdict
FAIL: 0 BLOCKER, 3 WARNING (findings 1, 2, 3), 2 NIT (findings 4, 5). All facts checked against the code are correct. The failures are two over-length sentences and one overstated message claim. The WARNING findings are quick edits, after which this group should pass.
