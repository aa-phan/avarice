Verdict: PASS

The checks found no BLOCKER and no WARNING. I read the code under `src/` directly and did not rely on the code diff alone. Severity: **BLOCKER** means it cannot ship, **WARNING** means rework is needed, **OBS** means worth noting.

**Verified against the code (containment.md)**
- **Rule 12:** the as-written match from two bases, `.` and `..` handled on the string alone, and a name that climbs above `/` giving `outside-read-set`. The symlink over-deny and the claim that `cd`, `git -C` and `git -c` are not admitted also hold (hook-decision.ts:508-541, normalized-root.ts:12-24, invocation-scope.ts:85-97).
- **Rule 13 step 5 and the `git status -M HEAD:.env` example:** step 5 runs before rule 13 (hook-decision.ts:705-706), and `git status` has no value letter in rule 11 (hook-decision.ts:354).
- **Corrective-reason paragraph** (hook-decision.ts:594-599, 751; pre-tool-use.ts:334).
- **Settlement paragraph:**
  - a crash with no result counts as killed (invocation.ts:149-160);
  - both settlement and orphan conversion are one transaction (budget.ts:112, 211; ledger.ts:679-682);
  - an orphan's wall clock is not charged (budget.ts:115-116);
  - a spawn failure is `unavailable` with cost 0 (claude-host.ts:288, 343).
- **Credential locations:** the list of twelve is at invocation-scope.ts:387-400. It feeds the onboarding and run scopes (291, 542), run write denials (511-514), checks (checks.ts:121), validation (check-validation.ts:90), graphify (graphify.ts:92) and GSD (gsd-onboarding.ts:106).
- **Check output redaction:** checks.ts:228. Only check output is stored; install and validation output are not.
- **Proxy bullets:** the address ranges, the IPv4-mapped and NAT64 handling, 403 for a name with no address, 502 recorded as allowed, and dialling the first checked address (allowlist-proxy.ts:78-121, 181-196). The registry host refusals hold (conventions.ts:224-243).
- **Run lease abort:**
  - the abort fires on a lost lease (run-service.ts:127-161);
  - the run unit is passed only that signal (item.ts:526);
  - an abort goes through the same SIGTERM-then-SIGKILL path and sets `timedOut`, so the invocation is charged its reservation (claude-host.ts:311-319).
- All link anchors resolve.

**Verified (findings.md)**
- **New lines** all hold:
  - finish.ts:206 (substring match);
  - map.ts:57, index-intel.ts:69 and index-knowledge.ts:163;
  - supervise.ts:35 (the CLI installs no SIGTERM handler);
  - settings.ts:109 (`Read(<path>/**)`);
  - allowlist-proxy.ts:91 and conventions.ts:224;
  - checks.ts:219 and :228;
  - run-start.test.ts:23 (`after`) and shell-supervisor.test.ts:111.
- **`(now at …)` annotations:** I spot-checked about 35 and all are correct:
  - hook-decision.ts:238, 260, 267, 527, 656, 790, 820;
  - ledger.ts:213, 469, 485, 507, 579, 719, 739, 759, 916, 954, 1043, 1119, 1197, 1271;
  - checks.ts:91, 121, 156, 159, 201, 206, 235;
  - budget.ts:115 and 130;
  - item.ts:573, 629, 644, 657, 837, 866;
  - invocation.ts:405, conventions.ts:249, graphify.ts:96 and 138, gsd-onboarding.ts:43, onboard.ts:13 and 31;
  - run-workspace.ts:202, 247, 417; run-source.ts:55.
  - The self-references to findings.md:89 and :91 still point at the right lines.
- **Removed lines:** none is needed any more. The proxy now checks addresses, check output is redacted, and the symlink exception is closed by the as-written match.

**OBS**
1. **containment.md, Settlement:** "A host the adapter cannot start is charged its invocation unit and no cost." It is also charged the time between reservation and the failure (invocation.ts:180). Fix: "…its invocation unit, the elapsed time and no cost." Confidence: high.
2. **containment.md, Settlement:** "A host process that starts and exits without a result is therefore charged a full cost reservation." This repeats the crash rule two sentences earlier, and the paragraph now runs to about 20 sentences. Fix: delete the sentence, and consider splitting the paragraph into settlement, transaction and orphan paragraphs. Confidence: medium.
3. **containment.md, opening module list:** the changed prose now describes code in the run supervisor and run item stage, the graph and GSD adapters, and the conventions reader's registry host rule, but the opening does not name them. Fix: add them to the opening list. Confidence: medium.
4. **containment.md, Output bullet and Secret redaction:** the check-output redaction is stated in both places. The bullet links to the section, which is acceptable, but the bullet could be cut to the link alone. Separately, integrations.md:189 restates the proxy's resolve-and-connect behaviour that containment.md now owns. Confidence: low.
5. **containment.md, Sandbox filesystem bullet:** it says one list serves the hook's read denials, but the host permission-deny layer turns each entry into `Read(<path>/**)`. That rule misses the four file entries (findings.md, settings.ts:109). The document does not mention this. Fix: one clause in the Deny bullet or a quirk linking to findings.md. Confidence: medium.
6. **findings.md, `src/app/stages/map.ts:57` line:** "is also aborted when the supervisor loses the run lease" reads as if the run unit also gets a timeout signal. It gets only the lease signal (item.ts:526), and the adapter's own timer enforces the wall clock. Fix: "is aborted when the supervisor loses the run lease instead". Confidence: medium.
7. **findings.md, `src/domain/invocation-scope.ts:477 (now at …:500)`:** line 500 is the loop. The skip for a glob with no prefix is at :502. Confidence: high.

**Not checked:** I could not run git, the tests or any shell command. So I could not confirm the load-sensitive test claims, that the diff matches the committed tree, or the SHA-256 digest the prose-review command asks the verdict to bind to. I also did not check how the Claude Code host's own sandbox treats a file path in `denyRead`, or the claim at finish.ts:206 that a whole-ID match would break existing briefs.

Several passages read well: rule 12 now states its cost plainly, the egress proxy bullets are precise and match the code range for range, and the new Limits bullets name both the gap and why it stays open.
