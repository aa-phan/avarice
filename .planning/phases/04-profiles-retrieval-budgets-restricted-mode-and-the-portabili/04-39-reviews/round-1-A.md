# Fresh-eyes review, round 1, group A

Verdict: FAIL (0 BLOCKER, 4 WARNING, 8 NIT). Findings are ordered most severe first.

Reviewed at HEAD 8c6eaa7, sha256 of the documents:
- docs/system/profiles-and-credentials.md fa789146363cedf7aa2b2b5c7e49c77dd50f16b2ea4451ef2b4ee6d2e16f51cb
- docs/system/policy-and-approvals.md 7dcc306a956b0d91f750f090d233bf3cdc546cb8eb08d2fb6a34dbce6e785a85
- docs/system/findings.md b5b48d79540325c5105d8259f8055d925b81b26f5a53e3930b1d2b6d25d5d8bf

Severity: BLOCKER (hard-rule violation or a claim the code contradicts at the root), WARNING (claim contradicted in part, hard sentence cap, ledger line that no longer holds), NIT (polish, imprecision). Under this gate any WARNING fails the round.

## WARNING

### W1. profiles-and-credentials.md: brief, check output and printed comment are said to skip the seed list; in the built system they do not
- Location: Redaction table row "Briefs, check output and pasted comments | Secret patterns only, without seeded values"; Quirks line "Check output, a brief and a printed comment are redacted by pattern, so a value that only the seed list knows passes through them."
- Evidence: src/app/run-start.ts:221 redacts the brief with deps.redact (falling back to redactSecrets), and src/app/manual-inputs.ts:405 redacts the printed comment the same way. src/cli/composition.ts:586 wires redact to the seeded process redactor, so in production both use the seed list. Check output is stored by src/app/checks.ts:262 through redactSecrets, but the artifact kind check-output is on the redacted list in src/adapters/fs/redacting-artifact-store.ts:19 (and in the document's own Artifacts row), so the stored bytes are redacted again with seeds. Only the pattern-only fallback (no deps.redact) matches the document, and no production path takes it.
- Fix: delete the row and the quirk, or restate them to name the one real gap (text that is shown but not stored, if any exists; verify before writing it). "Pasted comments" is also a term nothing else in the document uses (the command prints a comment; it pastes nothing).
- Confidence: high for brief and comment; medium-high for check output.

### W2. findings.md line 11: a finding whose subject no longer exists in the code
- Location: "From cli-reference", the line starting src/cli/commands/init.ts:15: user-facing error string carries delivery narrative ("only personal-local in Phase 1")
- Evidence: a search of src for "only personal-local" returns nothing, and src/cli/commands/init.ts holds no "Phase" text. Line 15 is the usage signature. The change log of init.ts shows the commit "init accepts every valid profile name" (bb93b18) after the finding was written. Every sibling line that stopped holding carries a "No longer holds at <sha>" note; this one does not.
- Fix: add "No longer holds at bb93b18: init accepts every valid profile name" or delete the line. Confidence: high.

### W3. findings.md: first cites that have drifted and carry no "now at"
- Location: ledger lines in the sections from cli-reference through the run slices. Sampled 12 cites with no "(now at ...)" marker; three no longer land on the claimed code:
  - line 209, src/hook/pre-tool-use.ts:134: the unindexed invocation_id scan is at src/hook/pre-tool-use.ts:162 and :178; line 134 is a try block opener.
  - line 11, src/cli/commands/init.ts:15 (see W2).
  - line 52, src/app/stages/activate.ts:209: the line is blank; the claim is marked resolved but names no current location.
- All 623 path:line cites in the file resolve to an existing file and a line within its length (mechanical check), so the defect is drift, not dangling paths. Cites that carry "now at" targets were not individually re-verified.
- Fix: the ledger owner re-points each drifted cite and adds "(now at ...)" where the old line is kept, or drops the old cite. A full pass is needed; the sample suggests roughly one in four unmarked cites has moved. Confidence: high for the three named, medium for the rate.

### W4. Sentences over the 35-word hard maximum
- profiles-and-credentials.md line 61 (41 words): "The data root and the work root each come from an environment variable ... else from a default under the user's home for that profile." Fix: split after the environment variable clause.
- policy-and-approvals.md line 60 (36 words): "A grant inserts one approval row (apv_ and 26 characters) with ... an expiry 30 minutes after the grant." Fix: move the expiry into its own sentence.
- policy-and-approvals.md line 80 (43 words): "Every other privileged action reaches the owner through the hook, which does not evaluate policy rules: it classifies ... are not read there." Fix: end after "through the hook", then "The hook does not evaluate policy rules. It classifies the command and then refuses it or consumes an approval, so ... are not read there."
- policy-and-approvals.md line 95 (40 words): "It looks through a leading assignment, env, ..." Fix: turn the list into a bulleted list, or split into wrappers, shell separators and substitutions.
- Confidence: high (mechanical count, backticked spans kept whole, table rows and code fences excluded).

## NIT

- N1. profiles-and-credentials.md, Credentials: "Exit 44 means no item, and any other failure is reported as unavailable with the exit status" and the Quirk "A keychain failure other than 'no item' is reported as unavailable". src/adapters/credential/keychain.ts also returns timeout (5 s kill) and invalid (output over 16 KiB); the audit outcome for a timeout is unavailable (src/app/credentials.ts:36) but invalid for oversize. Fix: "a non-zero exit is unavailable; a value over 16 KiB is invalid; a timeout is a timeout".
- N2. profiles-and-credentials.md, The handle: "the argument of the function passed to use" names a function in prose, which the house rule keeps out. Fix: "leaves only as the argument of the one callback the handle accepts".
- N3. profiles-and-credentials.md, Selecting a profile and Enterprise claims: the exit code for a repository claimed by an enterprise profile while a personal profile is selected is not stated. src/cli/main.ts (the branch where enterprise is set and the selected class is personal) returns 3. Fix: add "A personal selection for a claimed repository is refused with exit 3."
- N4. profiles-and-credentials.md, configuration table: a policy.organizationFile that is not a string, is empty, exceeds 1,024 characters or holds a control character fails policy loading (src/cli/composition.ts:157); the policy row says only "Per the policy file rules". Fix: add the shape rule to the row.
- N5. policy-and-approvals.md, Enforcement map: "The two rows that name host limitations are marked as claimed by no profile." Three rows name host limitations (host-managed-permissions, tool-call-decisions, hook-cost-fields); two carry the not-claimed mark. Fix: "Of the three rows that name host limitations, two are marked as claimed by no profile."
- N6. policy-and-approvals.md, Enforcement map: "host limitation 3 / 4" is numbered by the proposal docs/containment.md ("Unresolved host limitations"); no docs/system/ document defines the numbers. The row text states each claim in place, so the number adds an unresolved reference. Fix: drop the numbers or name the proposal section.
- N7. policy-and-approvals.md, Enforcement map row tool-call-decisions: "Evaluates the contract and policy in the fail-closed PreToolUse hook" sits beside "Policy is evaluated by the approval gate and nowhere else". The row means the run's generated hook policy, not the four ranked sources. Fix: write "the run's generated hook policy" in the row.
- N8. policy-and-approvals.md: "the fourth migration" (opening) is a delivery-flavoured name, and "The proposal lists seven; six have a command" and "The rows follow the order of the proposal's table" compare against a proposal inside a built-system document; code-versus-proposal differences belong in findings.md, which already holds the audit-sink line. Fix: name the migration by content ("the profiles migration") and drop the proposal comparisons.

## Verified without finding (coverage)

Mechanical: no em dash, en dash or spaced double hyphen in the two documents (two spaced double hyphens in findings.md lines 74 and 217 sit inside a quoted process-matching command, exempt); no phase, plan or threat IDs in the prose of the two documents; headings in sentence case; modules named in the openings.

Against code (all matched): profile name grammar and class; selection order, exits 3 and 64; registry limits (1,000 bindings, 64 KiB, 64 patterns of 256 characters, mode 0600); remote normalization; config key set, closed-key refusal, section behavior and composition refusals for credentials, retention, adapters and limits; limits and retrieval key names and caps; credential reference grammar, provider allow-list by class, keychain and helper limits (5 s, 16 KiB, environment), handle placeholder, audit event fields, 8-character seed floor, unused broker; seven redaction kinds and the twelve artifact kinds; moved-root registry behavior and exit 70; supervisor and LaunchAgent carry AVARICE_PROFILE; 22 classed actions (3, 4, 15) and 8 with a call site; policy file limits, reserved IDs, evaluation order, broken rank 1, user versus organization precedence, one-time read, repository policy read from the pin; approval digest, summary limits (80 and 400), 30-minute window, trigger guards, local-user source, exits of the approve command, key ordinal; the seven hook forms, 65,536-character and 8-level limits, bound parameters, attended entry (Bash matcher, 5 s, block on failure, session token of up to 100 characters, no allow printed); no-replay decisions and enforcement_failure; 18 enforcement-map rows, enforcers and proofs (three "proved by plan" rows); manual-input limits (16,000 bytes, 200 characters, 2 MiB, pull-request URL shape); the findings.md section "From policy-and-approvals, profiles-and-credentials, doctor and portability" cites checked line by line (all resolve; the single caller of the policy evaluator and of the gate confirmed by search).

Deliberately not flagged: findings.md ledger lines carry commit SHAs, plan numbers, ruling dates and delivery narrative; the task states the ledger is exempt by design. The "drafted, not yet reviewed" status line is the tracked convention. Quirk lines that restate table facts are a deliberate summary section. Not verified in depth: the other sections of findings.md (sampled only for cite drift, see W3), and the command classifier's option tables beyond the parameter names.

Read-only claim: the only file written by this run is this report.

Verdict: FAIL
