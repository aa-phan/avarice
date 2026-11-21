# Fresh-eyes review, round 2, group A

Reviewed digests (sha256, as read at HEAD 5a3f648):
- docs/system/profiles-and-credentials.md 6ad4ceba2a727c5e9a4b2f5db55a837372817ca7cc269404cccb6eddc62e41ec
- docs/system/policy-and-approvals.md d8dd84cfd7e688b296e27a7c1bbcd8ecc290eb32a9f67a4fc7af3fdd98889991
- docs/system/findings.md 584b244058ccc362ef8e7806be2871cb8de8c6531b18b8e95969da52704d7f96

Severity: BLOCKER (hard-rule violation or a claim the code contradicts), WARNING (structural defect or loosely supported claim), NIT (polish).

## Round-1 items

All round-1 BLOCKERs and WARNINGs of group A are resolved.
- W1 (seeded redaction of brief and printed comment): resolved. The redaction table row now says the process redactor with seeded values serves briefs and the printed comment; the quirk is gone. Matches run-start.ts and manual-inputs.ts wiring through composition.
- W2 (init.ts:15 line): resolved. The line says "No longer holds at bb93b18"; src/cli/commands/init.ts:15 is the usage signature.
- W3 (cite drift): resolved for the named cites. pre-tool-use.ts:134 carries "now at :162 and :178" and both lines query events by invocation_id. The activate.ts:209 line already named its new home. The opening of findings.md now states that a cite is where the line was logged and HEAD is the authority. Only two lines of findings.md changed since round 1. I sampled 25 cites of the group's own section and all land on the code described (list under Coverage).
- W4 (sentences over 35 words): resolved. A mechanical scan (code fences and table rows excluded, bold stripped) finds none over 35 words in either document.
- NITs 1 to 8: all resolved in the text (keychain outcomes, "the one callback", exit 3 for a claimed repository, the policy row, "Of the three rows", host-limitation numbers gone, "the run's generated hook policy", "the profiles migration").

## Findings

### WARNING 1. Quirks sections restate facts that the body already owns (both documents)
- Documents: profiles-and-credentials.md, Quirks (lines 118 to 127); policy-and-approvals.md, Quirks (lines 175 to 183).
- Claim: the Quirks bullets repeat body statements, so one fact lives in two places. Examples in profiles-and-credentials.md: "A keychain failure other than 'no item' is reported as unavailable, unless the value is over 16 KiB" (line 126, owned by line 83); "A helper's output is trimmed on both sides, and a keychain value loses one trailing newline" (line 127, owned by line 83); "An invalid config.json exits 70, while an untrusted binding registry or enterprise configuration exits 3" (line 123, owned by line 32 and the configuration section); "A personal profile that names an organization policy file does not read it" (line 124, owned by policy-and-approvals.md line 46); "workspaceRoots and freshnessWindowHours are accepted ... read by nothing" (line 118, owned by the two table rows). In policy-and-approvals.md: line 175 and 176 restate line 80; line 177 restates line 21; line 181 restates line 110; line 182 restates line 108; line 183 restates line 147.
- Evidence: the body sentences quoted above exist with the same content; the code agrees with both copies (keychain.ts exit 44 and 16 KiB cap; policy.ts evaluatePolicy; pre-tool-use.ts), so no contradiction, only duplication. The same defect was removed from group B documents in round 1.
- Fix: keep only what has no home in the body (profiles: bindings backfill race, the config.json roots snapshot, the two-store lock, the no-network helper; policy: the attended dangling start, the attended 5-second block, the scope-not-actor binding) and delete the rest, or turn the section into links to the owning paragraphs.
- Confidence: medium-high. Whether a Quirks ledger may repeat its owners is a convention call; group B was held to the stricter reading.

### NIT 1. policy-and-approvals.md line 34: rule `id` and `action` pattern
- Claim: "each of 1 to 64 lower-case letters, digits, dots, underscores and hyphens".
- Evidence: src/domain/policy.ts NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/. The first character must be a letter or digit.
- Fix: add "starting with a letter or a digit".

### NIT 2. policy-and-approvals.md line 147: "have no proof by design"
- Claim: "The three platform rows and the two host-limitation rows have no proof by design."
- Evidence: src/domain/enforcement-map.ts gives the platform rows reason PLATFORM_OWNS, but the two host rows (lines 62 and 176) are unverified because the question is unresolved, "not yet resolved by a containment test". That is a gap, not a design.
- Fix: "The three platform rows have no proof because the platform owns the control; the two host-limitation rows are unverified because the question is open."

### NIT 3. policy-and-approvals.md line 5 and profiles-and-credentials.md line 5: dense module openings
- The openings are single paragraphs of 6 to 8 sentences listing modules. They follow the house rule (modules named once in the opening) and are not a defect; a bullet list, as group C did, would read better.

## Coverage (checked against code at HEAD, no finding)

Mechanical sweep: no em dash, en dash or " -- " in either document; no sentence over 35 words; headings in sentence case; no phase, plan, task or threat IDs and no function names in the prose of the two documents; relative links (diagram, six system documents, ADR-015, onboarding.md#refresh) all exist.

profiles-and-credentials.md, verified: profile grammar (1 to 31 org characters, class by prefix, profile.ts); selection order and flag-versus-binding refusal (selectProfile); binding registry limits (64 KiB, 1,000 bindings, mode 0600), remotePatterns limits (64, 256) and normalization examples; config key set (14 keys); limits and retrieval name lists (resource-bounds.ts, retrieval-rules.ts); composition ordering for credentials, retention and adapters sections and the exit 70 for an unlistable profiles directory; keychain (5 s, 16 KiB, exit 44, one trailing newline); credential name grammar (128, not all dots); provider table by class (credential-ref.ts); seeding minimum 8; audit field cap 160; seven secret-pattern kinds; the twelve redacted artifact kinds; supervisor and LaunchAgent carry AVARICE_PROFILE with the three root variables.

policy-and-approvals.md, verified: 22 action names and their classes (action-class.ts); the eight names with call sites (hook six, promotion two); policy file limits (256 rules, 64 KiB, 8 when entries, 128 characters), reserved ids, evaluation order and the personal and enterprise rules (policy.ts); organizationFile shape check and resolution against the configuration directory (composition.ts:150-160); repository policy pin as 40 lowercase hex and link or submodule refusal (policy-sources.ts); approval TTL 30 minutes, apr_ and apv_ prefixes, owner granter, exits 0, 3, 64, 70 (approve.ts); hook forms, wrappers, nesting 8, 65,536 characters, bound parameter names per action (privileged-commands.ts); attended entry (Bash matcher, 5 s, block on failure, session id token of up to 100); enforcement map 18 controls and the not-claimed host rows (enforcement-map.ts).

findings.md, sampled and landing on the code described: pre-tool-use.ts:162, :178, :363, :546, :564; authorize.ts:95, :134, :261; promote.ts:98 (call of the gate); policy.ts:31; enforcement-map.ts:96, :104, :168, :5; result.ts:4; profile.ts:109 and :110; deps.ts:99; capabilities.ts:32; workspace.ts:166; capability-requirements.ts:47; gsd-tools.ts:91; graphify.ts:122; hook-decision.ts:516 and :648 (approximate); init.ts:15. Three cites have drifted in line but still locate the subject (prepare.ts:394 now reads requireCapabilities at that line, prepare.ts:145, hook-decision.ts:516); the opening of the file covers this. Not sampled: the other 600 or so cites.

Deliberately not flagged: the module paths in the openings (house rule allows them there); `.avarice/policy.json`, `config.json` and command names in the prose (product names, not paths into the source); findings.md carries commit hashes, plan numbers and owner rulings by design as a ledger.

Read-only proof: git status shows only the untracked .planning/config.json and .planning/milestone.lock from before the run, plus this report file.

Verdict: FAIL
