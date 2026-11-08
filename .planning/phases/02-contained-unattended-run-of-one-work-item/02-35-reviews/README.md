# Fresh reviews of the docs/system changes of plan 02-35

Each report is the verbatim output of a separate `claude -p` process (read-only: Read, Grep, Glob and Skill; the executor has no sub-agent tool) that loaded the prose-review skill and had not seen any earlier version of the documents. Every round was a new process. The reviewers were given the unified diff of the group's documents against the round base (2ac2b63, the commit before plan 02-27) and the round's code diff, and read the code in `src/` directly. They could not run git, so none computed a digest; the executor took the digests below.

Groups: A containment.md and findings.md; B integrations.md and config-reference.md; C runs.md, processes.md, data-model.md, checks-and-evidence.md and the run-resume diagram; D cli-reference.md and interactive-shell.md (the report files for group D are named cli-reference).

Round budget: no group needed more than 3 full rounds (cap 5), and every group ended on a round with no BLOCKER and no WARNING. Nothing is left open at the cap.

Before round 1 the executor ran a script over the added lines of the changed documents (sentences over 35 words, dash characters) and fixed 17 long sentences, so the reviewers found only a few style items.

| Round | Group | Report | Verdict | What the round found and what was done |
|---|---|---|---|---|
| 1 | A | round-1-containment-and-findings.md | BOUNCE | 6 WARNING. The lease sentence said a run also passes a timeout signal (a run passes only the lease signal); the startup-charge sentence gave the wrong reason and covered a spawn failure (not charged a reservation); the proxy range list claimed more than the code refuses; the IPv4-in-IPv6 sentence covered only two forms; the corrective-reason sentence elsewhere listed too few rules; seven `(now at)` annotations pointed at the wrong code (citations that were already stale before the round, shifted by one without being opened). All fixed from the code evidence; 2 OBS applied |
| 1 | B | round-1-integrations-and-config.md | BOUNCE | 1 BLOCKER: the sentence that a SHA-256 repository is refused at the first read was not true for onboarding (registration runs first). 2 WARNING: the IPv6 wording and one fact stated in three documents. Fixed; OBS on the reserved range wording, a 403 for a name with no address, "the others" and "exit 70" applied |
| 1 | C | round-1-runs-processes-data-model-checks.md | BOUNCE | 2 WARNING: the run-resume diagram still said a host with no reap capability marks the rows interrupted; processes.md put the transcript inside the settlement transaction. Fixed (diagram source and text); 4 OBS applied (one term for the reserved cost, the exit code of a lost lease, the SIGTERM quirk wording, an unreadable sentence) |
| 1 | D | round-1-cli-reference.md | PASS | No BLOCKER or WARNING. OBS 1 (the sentence naming onboard and resume) applied by deletion; OBS 2 (interactive-shell.md lists fewer characters) applied by pointing the sentence at the output-style paragraph; OBS 3 (`context` replaces characters with spaces) is older text and does not contradict the paragraph, left |
| 2 | A | round-2-containment-and-findings.md | BOUNCE | 3 WARNING: "a retry charges each amount once" (no code retries a settlement; the reservation is converted as an orphan); "an invocation that reported a result is charged its reported cost" (not when it was killed); the `git status -M` example did not show which parser supplied the operand. Fixed; 5 OBS applied (the `224/4` range, a DNS sentence, "twice", a repeated Quirks sentence, the intel and knowledge call sites in the abort-signal findings line) |
| 2 | B | round-2-integrations-and-config.md | BOUNCE | 1 WARNING: the test resolver's direction was reversed (the proxy reaches the loopback registry through it). Fixed; OBS applied (the reap sentence, a repeated run-start refusal, "an invalid error", the failure table wording, link anchors, "first checked address") |
| 2 | C | round-2-runs-processes-data-model-checks.md | PASS | No BLOCKER or WARNING; 4 OBS. Applied after the report: a link to the redaction owner in checks-and-evidence.md, and the diagram's host call now labelled "for each launch that can be reaped". Answered: processes.md step 10 lists an ending without a result, a signal or the wall clock, and the unknown-side-effect timeout error is the wall-clock case; the truncation limit of check redaction was added to findings.md as an unverified line |
| 2 | D | round-2-cli-reference.md | PASS | No BLOCKER or WARNING; 3 OBS. Applied after the report: the three marks named in the stripped set. Answered: the shell's typed text and history sentences (interactive-shell.md lines 87 and 102) and data-model.md's history sentence say less than the full list but are not wrong, and were left; the other sanitizers (`context`, the run text) replace characters with spaces by their own rules |
| 3 | A | round-3-containment-and-findings.md | PASS | No BLOCKER or WARNING; 7 OBS. Applied after the report: elapsed time added to the spawn-failure charge, the repeated no-result sentence deleted, the opening module list extended with the run supervisor, the item stage, the conventions reader and the graph and GSD adapters, one Quirks bullet on the host's Read deny rules and the file-shaped credentials, the map.ts findings wording, and the protected-glob annotation moved to line 502. Answered: the check-output redaction is stated in the Output bullet and in Secret redaction, and the Output bullet already links to the section |
| 3 | B | round-3-integrations-and-config.md | PASS | No BLOCKER or WARNING; 3 OBS, all applied after the report: the proxy paragraph in integrations.md cut to one clause with a link to the owner, the onboarding pin refusal reworded (the contract is recorded first), and the second cause of a run resume stop named |

Digests of the final versions (after the OBS fixes applied following the last round of each group):

- containment.md sha256 4661728ec8d6d52b395db42f9cdd9df96e43b4a91384134894e770e859ac5369
- findings.md sha256 8dff01b30960d9d072dd7d30326734babca8c205f0e5832d01a07c4592f41ca0
- integrations.md sha256 f8738275e2cbcce3a276d7496855eaf5956f6acd15485149ca613bba26ab4b34
- config-reference.md sha256 6fe409eaa4c91d807e1ff9f065f0781767b9bb0eea411181dbddd2be0f7ee0cd
- runs.md sha256 c62599508b604968bddc994830a3e5459f442c234410138620a72f4cffaef046
- processes.md sha256 c3f4248151752180768b230799dae7953121123d8758b4462def3b13f2746f41
- data-model.md sha256 634e367447a9911e91eeab99f9613345115cef317b17110e71e6f16ed67c018a
- checks-and-evidence.md sha256 7c76235632c21d9e239705ad4c14bad7b0f8678237a3b7da6a19bcc368ada288
- cli-reference.md sha256 ae5fc722f356deb6a034071f5ba8b470df692bc3ba0a92ca5d1dfd184acd3e39
- interactive-shell.md sha256 6ca8c8bb9f8a566f2c67242a5f26907180cb6ea23d087b8c5a06643858229679
- diagrams/run-resume-after-kill.puml sha256 1b69b65ac2ded34b1b2576b1ce8d1f636e015fdd43b6b042e24fbfce2458d97b

The versions the last rounds reviewed differ from these only by the OBS fixes named in the table. Rounds 1 and 2 reviewed the working tree and no digest was taken for them.

Findings that were code bugs: none. Every WARNING was a claim in the prose that the code contradicted or overstated, and each was corrected in the document; no code changed in this plan.

Reviewer remarks on method are kept in the reports as they came: each reviewer noted that it had no shell and so could not bind its verdict to a digest, and several said they did the review themselves in one pass because the brief gave them three tools.

The cost of the review processes is not in the Phase 2 ledger, as for the reviews of plans 02-23 to 02-26.
