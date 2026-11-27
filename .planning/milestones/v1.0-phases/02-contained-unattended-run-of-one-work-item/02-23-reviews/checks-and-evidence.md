Reviewed: docs/system/checks-and-evidence.md sha256 89498726463fbbb783bcac377eb7b26f9ec31163391a91802aa9703e9759d06c at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 3 WARNING and 4 OBS remain (no BLOCKER). Overlap with containment.md (one fact, one home), one 36-word sentence in running prose, one inaccurate status claim for the inventory list command.

BLOCKED: 3 WARNING and 4 OBS remain (no BLOCKER). Overlap with containment.md (one fact, one home), one 36-word sentence in running prose, one inaccurate status claim for the inventory list command.

Target: docs/system/checks-and-evidence.md, SHA-256 reviewed 89498726463fbbb783bcac377eb7b26f9ec31163391a91802aa9703e9759d06c (matches dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.

Severity: BLOCKER (cannot proceed), WARNING (rework needed, blocks this gate), OBS (worth noting).

## Findings

### 1. WARNING (high): sandbox posture restated here though containment.md owns it
Location: section "The sandbox every command runs in" (table, lines 21-35); line 44 (install scripts), line 73 (network detection), lines 239-241 (quirks on install scripts, text matching, validation reads).
Line 7 says containment.md owns the sandbox, the proxy internals and the hook, yet containment.md "Commands AVARICE runs for checks" already states the environment, reads, writes, network and 15-minute timeout (containment.md:349-355), validation network detection (416), the install-scripts caveat (417) and the validation read-denial gap (439). Two homes will drift; wording already differs: containment.md:351 says nothing is inherited from AVARICE, this document says only PATH is inherited.
Fix: keep here only what the checks pipeline decides (which command runs where, the writes-glob reduction, verdict logic); link containment.md for posture, detection mechanics and the install-scripts caveat; keep one routing line per quirk.
Evidence: containment.md:349-355, 416-417, 439; src/app/checks.ts sandboxSetup.

### 2. WARNING (high): inventory list command status stated incompletely
Location line 167: "A list command that cannot run or fails is recorded as unavailable or failed with an empty ID list."
A timeout or cancel is recorded inconclusive (same mapping as checks). The empty-list part is right (IDs are read only when the command passed).
Fix: say the status is the mapped one (unavailable, failed or inconclusive) with an empty ID list.
Evidence: src/app/checks.ts measureInventory (status from evidenceStatusOf of the command status; IDs only when passed); src/domain/evidence.ts evidenceStatusOf (timed_out and cancelled map to inconclusive).

### 3. WARNING (high): sentence over the 35-word cap in running prose
Location line 73: "Network use is prevented by the sandbox and detected from two signals: an attempt that reached the proxy, whose allowlist is empty, and the error text in the check output (ENOTFOUND, EAI_AGAIN, getaddrinfo, connect EPERM, ECONNREFUSED)." (36 words)
Fix: end at "two signals." then "One is an attempt that reached the proxy, whose allowlist is empty; the other is error text in the check output (...)." This paragraph is also the one to shrink under finding 1. The 36-word bullet at line 235 is in a list, so exempt; splitting it is optional polish.

### 4. OBS (medium): "always" on G2 revisions unproven
Line 113 "G2 rows always carry a tree revision." It is a tree revision because the unit changed the clone (clean only when the status is empty), not by rule. Fix: "G2 rows carry a tree revision, because the unit has changed the clone." Evidence: src/app/checks.ts cloneRevision (clean when the status list is empty).

### 5. OBS (low): "internal error of the supervisor" for an unreadable lockfile
Line 42. The read returns an error of kind denied or invalid (link out of clone, non-regular file, over size), which the action returns unchanged instead of recording a block. "No block" is right; confirm "internal error" matches how the stage engine surfaces a returned error. Evidence: src/adapters/git/staging-base.ts:42, 97-144; src/app/checks.ts installDependencies (returns the failed lock read).

### 6. OBS (low): registry host rule narrower in words than in code
Line 57 "a bare host name of dotted labels made of letters, digits and hyphens". Code also accepts a single label, lowercases, caps at 253 characters. Evidence: src/domain/conventions.ts:222-234. Consider routing the host grammar to config-reference.md.

### 7. OBS (medium): runs.md restates rules this document owns (defect of runs.md, not the target)
runs.md:255 and 278-279 re-list G2 rule categories, the G4 rule set and the test: semantics; runs.md:199-201 summarize install block reasons. They agree today (no contradiction found) but are second homes. Fix in runs.md: keep the block table (runs.md:257-263), link the rules.

## Checked and deliberately not flagged
- Digest and HEAD match; no repository file modified.
- No em dash, en dash or spaced double hyphen (grep). No banned constructions found. Headings sentence case. No delivery history, function names or line numbers in prose; source paths only in the opening module list. Runtime paths (~/.ssh, node_modules) are not source paths or absolute home paths.
- Sentence length: no other running-prose sentence over 35 words (line 7 only looked long through link markup).
- Status banner matches the other drafted documents; README and coverage.md list the document; coverage counts (6 statuses, 8 G2, 7 G4, 12 markers, 3 verdicts) match evidence.ts, gates.ts, test-inventory.ts (12 confirmed by running) and check-validation.ts.
- Verified against code: baseline delta table; acceptance mapping (test: substring, empty text, test-check selection); status mapping; marker patterns; inventory limits (50000, 500, 20000, 4 MiB, 120 s) and failure order; all eight G2 and seven G4 rules; G2 three-stage evaluation; delete list always empty (run-contract.ts:467); install reasons, 15 min, 32 MiB, 20 groups, 16 hosts, proxy behaviour; validation verdicts, reasons, caps 20 and 10, cache key, unavailable never cached, step and block rules, event payloads; baseline opens first attempt; resume inconclusive rows (run-resume.ts:139-187); handoff.fetched fields.
- No contradiction with runs.md on stage order, G2 block classes or hand-off; proxy internals route to containment.md. Quirks section present; prevention and detection labeled correctly; no enforcement claimed beyond the code.
- No embedded instructions, secrets or transcript text.
- Not run: no live sandbox execution; the validation read quirk is stated as unverified, matching the code (no read re-allowance in check-validation.ts).

## Repository status after the run (porcelain)
?? .planning/config.json
?? .planning/milestone.lock
(both present in the initial snapshot; nothing touched by this review)

## Answers

Applied: findings 1 to 4 and 6. Finding 1: the environment and read rules are now one row that routes to containment.md; the install-scripts caveat and the network detection mechanics stay, each in one place here because they are verdict logic. OBS 5: the unreadable lockfile is an error the install action returns unchanged, and the stage engine surfaces a returned error as an internal error, so the wording stays. OBS 7 concerns runs.md, which keeps one block table for orientation and links this document for the rules.
