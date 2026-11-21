# Round 2, group B: doctor.md, portability.md, overview.md, README.md

Severity: BLOCKER = hard-rule violation or a claim the code contradicts; WARNING = loosely supported claim, one-fact-one-home or sentence-cap defect; NIT = polish.

Reviewed digests (sha256, working tree at HEAD 5a3f648):
- doctor.md 53fc0221362a74f14496917ab86f8332acca426c2e9ecef6a746fcfa031e25d4
- portability.md b02efd3ddc02037880a3a40a97f613f9b38de9331b21ef184620500d44d2c5a2
- overview.md cae4b39c63b5e4c61acb33448912958b6cb60c98429e6a51bf04920aa87bac2c
- README.md b9614888647fc794b9004112814488ec3d5ad6187a91fda6968b61f246072e62

## Round-1 findings

B1, W1 to W8 and N1 to N8: resolved (checked against the current text and code). N9 (coverage.md lists README.md as reviewed though its tables changed) was deferred to the documentation plan and is still open as N-2.

## BLOCKER

None.

## WARNING

None.

## NIT

### N-1. portability.md, Limits of the proof, line 104: store latency presented as the fakes own range
Claim: The fakes draw 5 to 30 ms for the executor and 1 to 5 ms for the store.
Evidence: seeded-faults.ts lines 63-64 default to 5 to 30 ms for any fault source. The 1 to 5 ms for the store is passed by the callers, test-cli.ts line 49. True for every use in the suite, only the default differs.
Fix: say the tests configure 5 to 30 ms for the executor and 1 to 5 ms for the store. Confidence: medium.

### N-2. coverage.md line 80, README.md row: reviewed although README.md changed after review
Evidence: the README tables changed this phase, and coverage.md line 80 still says reviewed. Line 67 marks overview.md correctly as changed after review. The author deferred this to the documentation plan.
Fix: set the README.md row to drafted until this round passes, then reviewed. Confidence: high.

## Checked and not flagged (coverage)

- No em dash, en dash or double-hyphen dash in the four files. No phase, plan, threat IDs, SHAs or ticket keys. No changelog section. Sentence-case headings.
- Sentence length: a scripted sweep found no prose sentence above 35 words in any of the four files.
- Module names appear only in the openings. No function names in the prose.
- doctor.md against code: probe timeouts of 1 s and 8 s, the avarice- skill filter, the .tmp- repair rule, the VERSION_OUTPUT pre-filter (host-version-unknown cannot appear in doctor), enforcement derivation, the 11 finding areas, the push and pull request warning, the 2 s offline test, the record-incompatible refusal in start. The containment.md anchor refusals-before-launch exists and the duplicated admission rules are gone.
- portability.md against code: retries of six and three, drop 5% and duplicate 2%, the four test variables and defaults, agent-host capabilities for the three hosts, ingest-docs false and adopt-map true, the proof commit check states the property and names no delivery plan.
- overview.md: twenty commands, the doctor sentence agrees with doctor.md, the counts live in portability.md, linked anchors exist.
- README.md: the documents table lists every docs/system file, every proposal and ADR link resolves, all 14 proposals appear, and the ADR-014 and extensions rows name doctor.md.

Run hygiene: this review wrote only this file, plus a script in /tmp outside the tree.

Verdict: PASS
