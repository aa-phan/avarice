Reviewed: docs/system/containment.md sha256 c839dcd96e6cf8a550d40db8bbceb5c12d7ceb083de0351563e0c9260223741f at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 0 BLOCKER, 6 WARNING, 3 OBS. No dash form, no secret or home path, no embedded instruction; the containment claims verify against the code except the labels and over-cap sentences below.

BLOCKED: 0 BLOCKER, 6 WARNING, 3 OBS. No dash form, no secret or home path, no embedded instruction; the containment claims verify against the code except the labels and over-cap sentences below.

Digest reviewed: c839dcd96e6cf8a550d40db8bbceb5c12d7ceb083de0351563e0c9260223741f (matches the dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.
Severity: BLOCKER (cannot proceed), WARNING (rework needed; blocks this gate), OBS (worth noting).

## Findings (most severe first)

W1. WARNING (confidence medium). "Moved HEAD ... not prevented" contradicts the document's own prevention layers.
Location, line 9: "Three things are detected after the fact and not prevented. They are a file created at a location the sandbox does not list, a moved HEAD in the clone or staging copy, and, for runs, any change that matches no contract glob."
Defect: the same document says the git directory is a sandbox write deny (line 151), a protected glob (line 136) and that `git commit` is a denied prefix (line 271). A moved HEAD is therefore prevented by three layers and also detected by a backstop; only the unlisted-file and no-glob cases are prevention gaps.
Evidence: src/domain/invocation-scope.ts:366 (`RUN_ALWAYS_PROTECTED` has `.git/**`), :481 (`deny.add(at('.git'))`), :146-148 (`git push`, `git commit` denied prefixes); src/app/run-stages/item.ts:354 calls a moved HEAD "containment did not hold", i.e. a backstop.
Fix: reword line 9 to name two prevention gaps (unlisted file, no-glob change) and say a moved HEAD is prevented but also checked after the work as a backstop. Keep the Layers row for "Staging and clone checks" consistent.

W2. WARNING (confidence high). The opening promises a recovery label the body never uses.
Location, line 5: "which of those controls prevent, detect or only recover". The Layers table has only "Prevents" and "Detects"; no layer is labeled recovery, and the limits section says "detects, or does not reach".
Fix: drop "or only recover", or add the recovery controls the code has (orphan charge on the next reservation, session-ID reaping, clone discard in runs.md) as rows labeled recovery.
Evidence: src/app/budget.ts chargeOrphans; src/adapters/host-claude/claude-host.ts:375 reapBySessionId; src/app/run-stages/discard.ts.

W3. WARNING (confidence high). The Layers row for gates G2 and G4 says "finding recorded" for both; G4 records none.
Location, line 28: "gates G2 and G4 over the clone's changes | AVARICE after the work | Detects: onboarding or run blocks, finding recorded".
Evidence: src/app/run-stages/finish.ts:242-250 (a G4 failure blocks with reason `decision` and no `finding`); G2 records `containment.finding` (src/app/run-stages/item.ts:644-650, scope rules only, reason `enforcement_failure`). Lines 385-386 of the document are correct; only the table row overstates.
Fix: "G2 scope failure blocks with enforcement_failure and a finding; G4 blocks with decision and records no finding".

W4. WARNING (confidence medium). The Safe git row claims filter prevention for every git call.
Location, line 27: "No repository hook, fsmonitor, filter, prompt or caller config override runs".
Evidence: filter blanking is per call (`neutralizeFilters`, src/adapters/git/safe-git.ts:48, :171) and the contained host's git calls inherit only the SAFE_GIT_ENV variables (src/adapters/host-claude/env.ts:21; no filter entry). Lines 359 and 371 state this correctly; the summary row does not.
Fix: "No repository hook, fsmonitor or prompt runs; filter drivers are blanked only on AVARICE's own status, diff, checkout, worktree and clone-commit calls".

W5. WARNING (confidence medium). "Network. None, except the install's one proxied loopback port" omits validation's loopback port.
Location, line 354 (under "Commands AVARICE runs for checks", whose intro covers validation).
Evidence: src/app/check-validation.ts:91 gives validation `allowLoopbackPorts: [proxy.port]` in front of an empty-allowlist proxy (document lines 345 and 416 say so).
Fix: "None, except one loopback port: the install's proxy allows registry hosts; validation's proxy allows nothing and records".

W6. WARNING (confidence medium; depends on how the list exemption is read). Sentences over the 35-word cap in narrative bullets and numbered rules.
Count: 14 over the cap with a period/colon/semicolon split (line:words): 151:40, 257:53, 258:49, 261:39, 265:37 and 42, 287:37, 351:43, 384:45 and 43, 385:39, 386:43, 413:37, 414:36. With a period-only split two more list items exceed (149:59, 150:81, the "Allow:" and "Deny:" reference bullets); I treat those as the reference-list carve-out and do not count them.
Fix: split each at its natural semicolon or "and" joint. Lines 351, 384 to 386, 413 and 414 are narrative bullets, not reference lists, so the exemption does not cover them.

## OBS

O1. OBS (confidence high). Line 351: "Nothing is inherited from AVARICE. The command gets a `PATH` (the directory of the running node, then AVARICE's own `PATH`)". The first sentence contradicts the second. Evidence: src/app/checks.ts:117 (`process.env['PATH']`). Fix: "No variable is inherited except PATH, which is the running node's directory followed by AVARICE's PATH".

O2. OBS (confidence low). Line 219: "read roots and re-allowed roots are not glob-checked". The code checks the secret globs for any path under the working copy, so a read root that lies inside it is glob-checked. Evidence: src/domain/hook-decision.ts:262. Fix: "the glob applies to paths below the working copy, wherever they came from".

O3. OBS (confidence medium). Line 439 ends "Whether a check can then read its clone was not tested." The gap has no named owner or place to close it. Evidence: validation passes `denyReadPaths` and no `allowReadPaths` (src/app/check-validation.ts:84-91) while the clone lies under the default work parent. Fix: name the role who tests it, or keep it in unknowns.md only.

## Verified and deliberately not flagged

- Hook-rule count: the coverage command (coverage.md:27) run at HEAD prints 33; 6 allow rules (write-set, read-set, subagent-type, meta, shell-identity, agent-command), 28 deny rules, subagent-type on both; all 33 IDs appear in the document; `budget_exhausted` and `budget:subagentsConcurrent` are decided in src/hook/pre-tool-use.ts as stated.
- Stated limits: unlisted files in the clone (lines 155, 413: match invocation-scope.ts:455-481 and the run-workspace ignored-entry handling); profile roots outside the default parents (line 415: denyRead is own data root, work root and `defaultAvariceParents`, invocation-scope.ts:521 and checks.ts:120; moved config home and other profiles correctly stated as uncovered); network detection in validation (line 416: matches check-validation.ts:47-110, including the no-proxy fallback, non-zero exit not rejected, verdict `active`). All three present and accurate.
- Launch preflight: nine keys, hook checks, order, reason strings, self-test condition, probe env, 10 s timeouts, admitted list of four (launch-preflight.ts:22-293). Launch-argument refusals match launch-args.ts. Outcome rules 1-7 match outcome.ts. Reservation, settlement (killed = larger of reported and reservation), orphan charge and events match budget.ts and invocation.ts. Run blocking by host-error kind matches item.ts:639 and map.ts:62.
- Hook: fail-closed list, transaction, read-before-edit, loop limits (presets 3 and 25, 0 off), subagent concurrency, events, ConfigChange always refused (pre-tool-use.ts). Command identity rules, 11 admitted commands, 16 denied prefixes, 10 find actions, git option refusals, 9 refused contract-command words, GSD option and operand lists (7 config keys), verb counts (11, 14, 14).
- Settings generator, run scope, protected globs, scratch, denied tools, npm/npx exemption, env allowlist, Seatbelt profile order, executor kill grace (5 s) and probe retry, proxy status codes, install allowlist (host:443), install timeout 15 min, safe-git refusals and allowlists, commit identity, hand-off, root rules, local-mount rule, narrowing limits (256, 50, 64, 1024, 64 KiB), activation scope rule.
- House rules: no em dash, en dash or ` -- `; no file path, function name, line number or delivery history in prose (paths only in the opening list; system paths such as /usr/bin in line 171); no home path or secret; sentence-case headings; quirks section present; alive/dormant stated (narrow and hook-allow strategies, line 163; no caller-supplied extra PATH, line 171); cross-links resolve (each linked file exists).
- Embedded instructions: none.
- Not read in depth: the stream-json parser internals and the prepare.ts verify-enforcement action beyond the lines cited; live-run evidence files (the document makes no runtime claim).

## Version-control sweep

`git status --porcelain` after the run:
?? .planning/config.json
?? .planning/milestone.lock
(identical to the status at the start; no tracked file touched; the only file written is this report, outside the repository.)

## Answers

Applied: W1 to W6 and O1, O2. W6: the narrative bullets and the numbered rules were split; the Allow and Deny bullets (the hook read rules) are reference lists and stay. O3 (the validation read gap has no owner): left in the Quirks section and in unknowns.md, where the open question belongs; the document names no role.
