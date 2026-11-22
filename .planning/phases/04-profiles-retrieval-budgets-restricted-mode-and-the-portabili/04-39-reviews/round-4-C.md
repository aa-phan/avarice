# Round 4, group C: containment.md, data-model.md, integrations.md

Reviewed digests (sha256, computed at review time):
- docs/system/containment.md 6c604f8a7a42cb2b9fd1efaacb028c3378d3cb97afeee6c18e49cd23384b1094
- docs/system/data-model.md 65f171c312db5d2ee693d10866538cbe9a806d3b050345b5518d4b831d504f65
- docs/system/integrations.md c75b7a21ab8e18a3b0b482110d3bcb55a6799bdd7fd6a34a6d7fc223d936546b

Severity: BLOCKER (hard-rule violation or a claim the code contradicts, with no qualifier that saves it), WARNING (loosely supported or contradicted claim, internal contradiction, hard-cap breach, structural defect), NIT (polish).

## Earlier WARNINGs

- Round 1 C-W1 to C-W7: stay resolved (no text in those areas changed since round 3).
- Round 2 F1 and N1 to N3: resolved.
- Round 3 W1 (Node version comparison): resolved. integrations.md now scopes it to the ledger open and says `doctor` is the one place; src/app/doctor.ts `nodeSatisfies` judges only `>=x.y.z` and returns true for any other rule shape or an unparsable version, as the text says.
- Round 3 W2 (36-word sentence): resolved. The mechanical sweep below finds no sentence over 35 words.
- Round 3 W3 (retrieval "counted"): resolved. containment.md now says the two rows have a row in the ledger that nothing spends, consistent with the "created and never spent" paragraph and Quirks.
- Round 3 N1 (SQLite thresholds in two places): resolved for integrations.md, which now links to data-model.md. N2 (Glob/Grep comment twice): resolved.

## Findings

### W1 (WARNING, high confidence) integrations.md, "Claude Code" > "Direction and invocation", paragraph "The session ID is chosen by the caller..."

- Claim: "The ID must be a UUID, and the adapter generates one otherwise."
- Evidence: src/adapters/host-claude/claude-host.ts:180-181 take `req.resumeSessionId ?? req.sessionId ?? randomUUID()`, then refuse a session ID that is not a UUID with `invalid`. The adapter generates a UUID only when the caller gives none; a caller-supplied non-UUID is refused, not replaced. containment.md "Session ID" says the adapter refuses (`invalid`) a session ID that is not a UUID, so the two documents contradict each other, and "otherwise" reads as "when it is not a UUID".
- Fix: "A caller-supplied ID must be a UUID, or the adapter refuses it as invalid; the adapter generates one only when the caller gives none." Or drop the sentence and link to containment.md#session-id (one fact, one home).

### N1 (NIT) containment.md, "Purposes and their scopes" table, intel row, Shell column

- Claim: "as map, plus three intel-writing GSD verbs".
- Evidence: the three added verbs are `intel patch-meta`, `intel validate`, `intel snapshot` (src/domain/invocation-scope.ts:132). integrations.md's verb table says `intel validate` writes nothing.
- Fix: "plus three intel GSD verbs".

### N2 (NIT) data-model.md, "The ledger file", Runtime gate

- The rule lists 3.44.6, 3.50.7, 3.51.3, any line above 3.51 and refuses 3.45 to 3.49, but never says lines below 3.44 are refused (src/domain/runtime-support.ts: a version below 3.44, or major below 3, falls to `unsupported`). Add "and anything older than 3.44.6".

## Checked against code and found correct (not findings)

- Mechanical sweep, scripted over the three files (code fences and table rows excluded, code spans counted as one word): no em dash, en dash or spaced double hyphen outside code spans (the two `--` hits in integrations.md are inside code spans); no sentence over 35 words; no phase, plan, threat or ADR IDs in prose (the "SHA-256" hits are the hash name); every relative link and anchor in the three files resolves; headings in sentence case; no changelog or last-updated text; each opening names its modules once.
- Changes since round 3 (git diff a11725f..HEAD): one containment.md sentence and two integrations.md paragraphs; all checked against code. data-model.md is unchanged (same digest as round 3).
- containment.md: launch line and refusals (src/adapters/host-claude/launch-args.ts: widening flags, the `Glob,Grep` pair, restricted flag list and refused set, optional plugin/agents pair for an onboarding); `launch-args:` prefix rewritten from `launch_args:` (claude-host.ts:245); 38 rule IDs by the coverage command (re-run: 38); command cap 16,384 characters, hook input cap 1 MiB, digest cap 8 MiB, hook timeout 5 s, GSD guard timeout 10 s, hook busy wait 4 s; restricted spec closure caps 32 files and 512 KiB and the three seeds (src/domain/restricted-specs.ts:14-18); GSD verbs per purpose (invocation-scope.ts:117-145); the seven run `config-set` values (run-gsd-config.ts:33-41); sandbox-exec failure codes 65 and 71; pgrep 10 s.
- data-model.md: SQLite gate thresholds (runtime-support.ts), 5 s CLI busy wait (db.ts:165); 24-table and migration counts were re-checked in round 3 and the file is unchanged.
- integrations.md: staging `config-set` keys (src/app/stages/workspace.ts:27-32); graphify command lines and timeouts 300 s and 120 s; osascript three `-e` lines, `--`, 10 s; launchctl and plutil paths, 10 s, 160-character cut; conventions file cap 256 KiB and 500 candidates; skill-install cap 256 KiB and hook settings cap 1 MiB; hook matcher `Read|Grep|Bash` for the GSD guard; plugin directory name `avarice-run-skills`; GSD preamble cap 1 MiB; owner and invocation ID pattern.
- Not verified line by line this round: the full event-kind table, option rules 11 to 13 of the Bash identity section, the proxy IPv6 range list, the git command table rows, and the credential-location list; round 3 verified most of these and their text has not changed.

Verdict: FAIL
