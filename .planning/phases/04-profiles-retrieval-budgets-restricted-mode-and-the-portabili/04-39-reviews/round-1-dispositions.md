# Round 1 dispositions

Every BLOCKER and WARNING was checked against the code at HEAD before the document changed. "Fixed" means the document now states what the code does; "rebutted" carries the code evidence. NITs are fixed where cheap and otherwise deferred with the reason. Nothing is marked reviewed by this file; the next round decides.

## Group A

| Id | Severity | Disposition | Note |
|---|---|---|---|
| W1 | WARNING | Fixed (the report holds) | `run-start.ts` redacts the brief and `manual-inputs.ts` redacts the printed comment with `deps.redact`, which `composition.ts` wires to the seeded process redactor; check output is redacted by pattern and then again with seeds by the redacting artifact store (`check-output` is on its list). The redaction table row now says the seeded redactor serves briefs and the printed comment, and the quirk is deleted. |
| W2 | WARNING | Fixed | The `init.ts:15` line in `findings.md` now says "No longer holds at bb93b18"; the usage line has no phase text. |
| W3 | WARNING | Fixed in part, rebutted in part | `pre-tool-use.ts:134` now carries "now at :162 and :178". The `activate.ts:209` line already says "No longer holds at 2703b34" and names `activate.ts:220` as the current location, so it needs no change. A one-in-four drift rate over all unmarked cites was not re-verified line by line: the ledger is working material, and the file's opening now says a line's cite is where it was made when logged and the code at HEAD is the authority. A full re-pointing pass stays with the ledger owner. |
| W4 | WARNING | Fixed | The four long sentences are split (`profiles-and-credentials.md` roots, `policy-and-approvals.md` grant expiry, hook paragraph, classifier list). |
| N1 | NIT | Fixed | Keychain outcomes: exit 44 no item, other exits unavailable, over 16 KiB invalid, timeout recorded as unavailable. |
| N2 | NIT | Fixed | "the one callback the handle accepts". |
| N3 | NIT | Fixed | Exit 3 for a personal selection of an enterprise-claimed repository (`main.ts`, `EXIT_PROFILE_REFUSED`). |
| N4 | NIT | Fixed | The `policy` row states the `organizationFile` shape rule (enterprise profiles only, as the code reads it). |
| N5 | NIT | Fixed | "Of the three rows that name host limitations, two are marked as claimed by no profile." |
| N6 | NIT | Fixed | The host limitation numbers are dropped; each row states its claim in place. |
| N7 | NIT | Fixed | "the run's generated hook policy". |
| N8 | NIT | Fixed | "the profiles migration"; the two proposal comparisons are removed. |

Group A fixes are in commit 88a2994.

## Group B (commit 30edf0b)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| B1 | BLOCKER | Fixed | `portability.md` now states the property (the proof's own commits are found by subject and change no file under the source directory; the check skips when the history lacks the range) and no longer names the delivery plan. |
| W1 | WARNING | Fixed | `overview.md` says doctor writes nothing except the profile's directories and configuration file on a first run, and the orphan cleanup under `--repair`. Holds against `doctor-deps.ts` and the probes. |
| W2 | WARNING | Fixed | The sentence that stated the admission policy as enforced is gone from `doctor.md`; `containment.md` owns it and says the code checks membership only. |
| W3 | WARNING | Fixed | The probe lists only entries named `avarice-`; the Extensions paragraph and the findings row say AVARICE skills. |
| W4 | WARNING | Fixed | (a) The verified list, required flags and refusal rules are removed from `doctor.md` and linked to `containment.md`. (b) The four Quirks bullets that restated the body are deleted. |
| W5 | WARNING | Fixed | The `agent-host` row states each adapter's capabilities and values (`claude-code`, restricted, `unavailable`) and the `mode` attribute; verified against `claude-host.ts` and `unavailable-host.ts`. |
| W6 | WARNING | Fixed | All ten sentences split. |
| W7 | WARNING | Fixed | `AVARICE_TEST_REMOTE` takes effect only when it equals `1` (`test-cli.ts`); the row says so. |
| W8 | WARNING | Fixed | The host section answers whether the host side could start; the `gsd` section is named for the GSD side. `composition.ts` also needs the GSD preamble, which `doctor.ts` does not judge. |
| N1 | NIT | Fixed | "except the online authentication check". |
| N2 | NIT | Fixed | `host-version-unknown` cannot arise in doctor (`VERSION_OUTPUT` pre-filter); the launch preflight reports it. |
| N3 | NIT | Fixed | The two proposals are named with a link. |
| N4 | NIT | Fixed | The executor and host descriptors are built when first read. |
| N5 | NIT | Fixed | The latency ranges are stated once, under "Limits of the proof". |
| N6 | NIT | Fixed | Headings renamed "Reads and writes" and "Limits of the proof". |
| N7 | NIT | Fixed | The counts leave `overview.md` and `integrations.md`; `portability.md` owns them. |
| N8 | NIT | Fixed | The ADR-014 and `extensions.md` rows of the README name `doctor.md` for admission labels and `--extensions`. |
| N9 | NIT | Deferred | `coverage.md` is the documentation plan's file; every document changed in this round is `drafted` again until a fresh reviewer passes it. |

## Group C (commit c2e2823)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| W1 | WARNING | Fixed | The nine caps are `indexEntries`, `returnedBytes`, `searchHits`, `queryTimeoutMs`, `snippetLines`, `snippets`, `fullReads`, `fullReadBytes` and `maxPages`; two are counted for a run and the contract adds `searches` and `broadDiscovery`. `containment.md` now agrees with `config-reference.md`. |
| W2 | WARNING | Fixed | The second capability sentence of `integrations.md` is gone as a duplicate and the remaining list (`map-paths` and `adopt-map` true) matches `gsd-onboarding.ts`. |
| W3 | WARNING | Fixed, one point for the next reviewer | The dated live-run sentence is removed from `containment.md` and moved to `unknowns.md` as an unverified observation. In `integrations.md` the Glob and Grep removal is kept as "recorded as", with "no test checks this": the claim is the code comment above the launch line's allowed-tools constant, not a live run, and its dates are gone. |
| W4 | WARNING | Fixed | The figures seven files and 56 KB are replaced by the mechanism (three seed specs, their closure, refusal above 32 files or 512 KiB), from `restricted-specs.ts`. |
| W5 | WARNING | Fixed | The migration parentheticals are deleted; the counts stay. |
| W6 | WARNING | Fixed | All counted sentences are split (lists became bullets); the module list of the opening is a bullet list. A scan with code spans counted as one word each finds none over 35 in the three documents. |
| W7 | WARNING | Fixed | `integrations.md` links to `containment.md` for the launch refusals, the host environment, the outcome rules, the kill sequence, the admitted versions and checks, the signalling of reaped processes, the git safety rules, the hand-off rules and the Seatbelt rule order; it keeps the external command lines, timeouts and exit codes. |
| N1 | NIT | Fixed | See W6. |

## Group D (commit f33d27a)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| B1 | BLOCKER | Fixed (the report holds) | `checkRoots` takes the data root and the work root only (`root-rules.ts`, called once in `profile-paths.ts`). The `AVARICE_CONFIG_HOME` row says its placement is not checked; the two root rows point to `profiles-and-credentials.md#roots-and-isolation`. |
| B2 | BLOCKER | Fixed (the report holds) | `startRun` judges the repository preflight, then the retrieval section, then the limits section and `active-runs`, then the contract compile. `cli-reference.md` lists the eleven checks in that order; `config-reference.md` says `active-runs` comes after the preflight rules. |
| W1 | WARNING | Fixed | The message is quoted as `main.ts` prints it. |
| W2 | WARNING | Fixed | The three retrieval names a start accepts are added to the sentence. |
| W3 | WARNING | Fixed | Every listed sentence is split. The `Exit:`, `Side effects:` and `Commands:` enumerations stay, as the report exempts them. |
| W4 | WARNING | Fixed | The "first release" parenthesis is deleted. |
| N1 | NIT | Fixed | Antithesis reworded. |
| N2 | NIT | Deferred | The repeated lease and wait-margin values are consistent with the code; removing the copies restructures three reference tables and is left to the owner. |
| N3 | NIT | Fixed | The partial list of phase-named test variables is replaced by a description of the test-only class. |
| N4 | NIT | Fixed | Width wording. |

## Group E (commit ffbc9dd)

| Id | Severity | Disposition | Note |
|---|---|---|---|
| 1 | BLOCKER | Fixed (the report holds) | `manual-inputs.ts` writes the kinds `ci`, `review` and `manual` and the independence `external`; only `mutation` is never written. The statuses table now lists manual evidence under `inconclusive`. |
| 2 | WARNING | Fixed | All counted sentences outside the module-list openings are split. |
| 3 | WARNING | Fixed | The corpus formula stays in `indexes-and-context.md`; `onboarding.md` links to it, and so does `config-reference.md`. |
| 4 | WARNING | Fixed | "each context source judges a reference" in both documents. |
| 5 | NIT | Fixed | The flow names four cases and points to `runs.md` for the fifth. |
| 6 | NIT | Fixed | A sentence under the diagram index says what the drift anchor is for. |
| (not numbered) | NIT | Deferred | The project record contents list in `onboarding.md` stays one reference sentence, as the report allows. |
