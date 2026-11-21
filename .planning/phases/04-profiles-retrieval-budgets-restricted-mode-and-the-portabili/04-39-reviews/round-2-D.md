# Round 2, group D: cli-reference.md, config-reference.md, interactive-shell.md

Reviewed at HEAD 5a3f648. SHA-256 of the reviewed files:

- docs/system/cli-reference.md d33adcfbf272894034c8e34a9b95b5731057cdb3aa9c758bdc4bdfeddb0b0ec1
- docs/system/config-reference.md 1caf43885fdb3e7be969c9839ca00514a574577256a5ba18761b811457633116
- docs/system/interactive-shell.md db03b0b5c4393d577cb073e7940ded007d2cf4429aff7b19720c825c6f36627b

Severity: BLOCKER = a claim the code contradicts or a hard-rule violation; WARNING = quoted text that differs from the code, an incomplete claim or a style-rule breach needing rework; NIT = polish.

Result: 0 BLOCKER, 0 WARNING, 2 NIT.

## Round 1 status

- B1 (config home placement): resolved. The `AVARICE_CONFIG_HOME` row says its placement is not checked; cli-reference.md:65 agrees; checkRoots takes only the two roots.
- B2 (start check order): resolved. cli-reference.md:225-235 lists the eleven checks in the order of `startRun` (policy, GSD, brief, project and record, record compatibility, restricted record, preflight, retrieval and limits sections, active runs, contract compile); config-reference.md:340 says `active-runs` comes after the preflight rules.
- W1 (remote refusal message): resolved; cli-reference.md:82 matches src/cli/main.ts:156.
- W2 (budget names): resolved; config-reference.md:294 names the three retrieval names.
- W3 (long sentences): resolved. A scan (code spans as one word, tables, headings and fences excluded) finds only `Exit:` and `Side effects:` enumerations, which the doctrine exempts as reference lists, and one bullet (N1).
- W4 (delivery history in interactive-shell.md): resolved; the "first release" parenthesis is gone.
- N1, N3, N4: resolved. N2: deferred by the author (see N2 below).

## NIT

### N1. One bullet at the sentence cap

- cli-reference.md:726 (schedule, environment of the LaunchAgent): the bullet "an environment of four variables, ..." counts 36 words with each code span as one word. Fix: move "because a LaunchAgent has no repository to read a binding from" into its own sentence. Confidence: low (depends on how code spans are counted).

### N2. Repeated constants (carried over from round 1 N2)

- config-reference.md: the lease time-to-live (180000 ms) appears in the `AVARICE_LEASE_TTL_MS` row and again in the Run limits and Timeouts tables; cli-reference.md:205 restates it as 180 seconds. One fact, one home: keep it in one table and link the rest. The values agree with the code, so this is duplication risk only. Confidence: high.

## Checked and not flagged

- Mechanical: no em dash, en dash or ` -- ` in the three files; headings in sentence case; no phase numbers, plan IDs, threat IDs or file paths in prose outside the opening paragraphs, which name modules once; no changelog or "last updated" text.
- Code checks repeated at HEAD: the twenty command names (src/cli/main.ts:20); the eleven `AVARICE_*` variables read (grep of src and bin); the six `limits` defaults (src/domain/resource-bounds.ts); the table width rule (src/cli/render/table.ts:22, 71); the start check order and refusal codes (src/app/run-start.ts); the enterprise-remote refusal text.
- Not re-verified in depth: the retrieval selection algorithm text, status human-view formats and the repository-side `.avarice/config.json` reader tables, which round 1 covered and which are unchanged apart from the edits listed above.

Verdict: PASS
