# Round 1, group C: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator with only the documents, the code and the house rules. Documents: docs/system/checks-and-evidence.md, docs/system/containment.md. Diff base fc15fea, HEAD fe577bf.

---

VERDICT: NEEDS CHANGES. Both documents carry code-behaviour WARNINGs, so the campaign rules force a fix and a full new round. There are no BLOCKERs.

Reviewed at HEAD in /Users/aphan/avarice/.claude/worktrees/phase-03 against `git diff fc15fea`, with every behavioural claim checked against src/. Digests reviewed:
- docs/system/checks-and-evidence.md sha256 8c1dd98fff6f77d9a6de5e1a1f33db64c163e4689683a83372a02972283a7889
- docs/system/containment.md sha256 334bb6b4346a9839d8fba996ad615b296c6a06293ec54d836331994fa23a3a1e

Severity terms: BLOCKER cannot proceed. WARNING is likely rework. OBS is worth noting. A WARNING is tagged (behaviour) when the claim is about code, and (wording) otherwise.

## checks-and-evidence.md

### W1 WARNING (behaviour): the G1 plan-size rule is wrong and contradicts itself
- **Location:** "Gate G1", first paragraph.
- **Quote:** "reads every quick PLAN record ... each cut to 64 KiB ... A file over the limit counts as no plan."
- **Evidence:**
  - `src/app/run-stages/item.ts:1585` and `:1599-1606` read each file with a 64 KiB maximum.
  - `src/adapters/git/staging-base.ts:143` returns `invalid` when the size exceeds the maximum, so nothing is cut.
  - `readPlan` then returns `plan: null` for the whole merged plan, even when other PLAN files were readable.
  - A path that is not a regular file does the same.
  - The 64 KiB cut in `src/domain/quick-record.ts` (`parseQuickPlan`) is never reached for an oversized file.
- **Fix:** Replace the sentence with: "A PLAN file over 64 KiB, or one that is not a regular file, makes the merged plan absent, and `plan-present` fails."

### W2 WARNING (behaviour): the "Otherwise" in "Repair and gate G3" misroutes every non-checks failure
- **Location:** "Repair and gate G3", second paragraph.
- **Quote:** "Otherwise the item goes straight to a decision of class `repeated_failure`".
- **Evidence:**
  - `src/app/run-stages/item.ts:1548-1551` gives the `repeated-failure` signal only when `checksOnly || isRepair`. Any other G2 failure gets the `pause` signal.
  - `src/domain/decision-policy.ts:189-192` classifies `pause` as an `acceptance` decision.
  - A scope or deletion failure is a run-wide `enforcement_failure` (`item.ts:1541`).
  - `docs/system/runs.md` (the G2 failure table) states these routes correctly, so the two documents now disagree.
- **Fix:** Limit the sentence to the checks-only and repair cases, and point to runs.md for the other routes.

### W3 WARNING (behaviour): "sandbox values only" is false for the install command
- **Location:** the sandbox table, "Environment and reads" row.
- **Quote:** "The install command and the list command receive the sandbox values only."
- **Evidence:**
  - `src/app/checks.ts:381` gives the install the sandbox values plus `npm_config_https_proxy`, `npm_config_proxy`, `HTTPS_PROXY`, `npm_config_update_notifier` and `npm_config_ignore_scripts`.
  - The list command (`checks.ts:453`) does get the sandbox values only.
- **Fix:** Write "receive no check `env`", and say the install adds its proxy, notifier and ignore-scripts variables.

### W4 WARNING (behaviour): the `repair:reproducer` step is written in two cases, not one
- **Location:** "Records these steps write" table.
- **Quote:** "A repair unit is prepared; holds the reproducer of each failing check."
- **Evidence:**
  - `src/app/run-stages/item.ts:1536-1551` calls `recordReproducerStep` whenever a failing check goes to a decision.
  - `src/app/run-stages/repair.ts` (`recordReproducerStep`) writes the step then too, with an empty `repairFor`.
- **Fix:** Add "or a failing check goes to a decision without a repair".

### W5 WARNING (wording): sentences over the 35-word hard cap in new text
My splitter only breaks on a full stop, so semicolon and colon fragments may be shorter than counted. The sentences below are over the cap by a margin, and the first one is not a reference list.
- "A check's environment reaches two places": the sentence beginning "The unit's own list..." is about 43 words, and "The names the check sandbox sets itself..." is about 41. Of the sentences beginning "The host keeps...", the first is also about 41 words.
- "A declared check that is neither required nor a target...": about 43 and 48 words.
- Baseline, "The unit is told": about 54 words for "The prompt says that...".
- Gate G1, first paragraph: about 41 words.
- Repair offered-conditions sentence ("The repair is offered when every failure..."): about 38 words.
- **Fix:** Split each into one claim per sentence.

### W6 WARNING (wording): indirect-question heading
- **Location:** "### What each item starts from".
- **Rule:** the style rule banning indirect-question headings ("What X means") in `references/style.md`.
- **Fix:** Use a noun phrase, for example "Item start reference".
- **Confidence:** medium. The heading does name its content.

### OBS
- **Reproducer `diff.paths`.** The doc says "changed since the last state where the check passed". The code measures `changedSince(clone, base)` against the item's base (`repair.ts` `reproducerFor`). The doc states the intent, not the mechanism.
- **Repair count.** It resets after an answered decision (`repair.ts` `repairsOf`). "It is never repaired again" omits that. runs.md has it, so a pointer would do.
- **PATH.** "a `PATH` that starts with the gsd-core directory" is that directory's `bin` (`env.ts:42`).

### Claims checked and verified, not flagged
- **Gates and rules:**
  - G1: six rules and their order, `plan-present` judged alone, the advisory-only `plan-cites-acceptance` and its code switch, and the path-normalisation rules (`gates.ts`).
  - The plan parser's inputs and shapes (`quick-record.ts`), and the PLAN-since-attempt and not-deleted selection (`item.ts:1596`).
  - G3: three rules, the always-empty authorized list (`item.ts:1786`), and its own-snapshot scope.
  - The five integrity gates and their mapping, and that advisories never count (`gates.ts` `INTEGRITY_GATE_RULES` and `integrityFailures`).
  - G2 reading the item's start, and the G3-before-G2 order and double row (`item.ts:1380-1560`).
- **Repair and reproducer:**
  - Reproducer fields and caps: 20 paths, 20 names, 200 and 1000 characters, output digest only. Failing-test shapes: vitest, TAP `not ok` with TODO/SKIP exclusion, and the spec-reporter cross. Inventory-ID resolution by equality or ` > ` suffix (`reproducer.ts`, `repair.ts`).
  - Repair mechanics: offer conditions, the one-repair-per-check preset limit, the invocations-budget check, and the attempt, checkpoint and state moves (`repair.ts`, `item.ts:1808`).
- **Baseline and delta:**
  - Item-start composition for statuses and inventory (`repair.ts` `itemStartStatuses` and `itemStartInventory`).
  - Pre-existing list semantics (`evidence.ts` `preExistingAtStart` via `baselineDelta`) and the prompt wording (`run-gsd-config.ts:115-130`).
  - G4 reading the pin baseline, and the `no-stale-or-inconclusive` rule using the final pass's own rows.
- **Stale rows and not-run checks:**
  - Stale rows: only `check`-kind rows for a required-checks change, rows with acceptance for an acceptance change, and the gate row copying the latest work item and revision (`amendment.ts:349-409`, `ledger.ts:1017-1066`).
  - A stale head status read as `not-conclusive` (`evidence.ts:93`).
  - The `not run: not required` report (`checks.ts:104`), its three surfaces and the JSON key (`run-view.ts`, `run-status.ts`), and the exclusion of such checks from the command list (`run-contract.ts:678`).
  - An amendment adding the command (`amendment.ts:236`).
- **Environment and commands:**
  - Listing of check env as sorted `NAME=value` words, minus the six sandbox names (`run-contract.ts` `checkAgentCommand`, `conventions.ts` `SUPERVISOR_CHECK_ENV_NAMES`).
  - Host environment contrasts: forwarded HOME, no CI, TMPDIR under scratch (`env.ts`, `gsd-tools.ts:22`).
  - The quirk about `shell-not-allowed` for a reordered assignment.
- **Style and cross-references:** no banned dashes, no delivery history, and no paths or function names after the opening. Links and anchors in the section "Cross-references" below all resolve.

## containment.md

### W7 WARNING (behaviour): the ancestry rule is overstated as a control a run cannot evade
- **Location:** "Owner commands and the terminal identity rule", the paragraph beginning "The chain is read with `/bin/ps`...".
- **Quote:** "...which is the one fact a run cannot hide ... the process tree is the control that matters."
- **Evidence:**
  - `src/adapters/proc/ancestry.ts:62-71` walks parent pointers to PID 1 and matches the supervisor signature on the chain.
  - A descendant reparented to PID 1 (for example by a double fork) has no supervisor on its chain.
  - Nothing in src/ or the tests establishes that a run cannot produce such a process.
  - The sentence reads as a verified security property and is only a design comment copied from `ancestry.ts:2-4`.
- **Fix:** State what the code does (it walks the parent chain and fails closed when the chain is unreadable). Drop "cannot hide" and "the control that matters", or say the property is untested. The last sentence of the section, calling it a "second barrier" behind the hook and the sandbox, is accurate.
- **Confidence:** medium.

### W8 WARNING (behaviour): the agents-file description omits the verifier note and misstates the ordering
- **Location:** "How a launch is assembled", the agents-file bullet.
- **Quote:** "every agent's prompt ends with a note stating the same shell rules ... The executor ... then also carries ... The map and intel agents carry neither note."
- **Evidence:**
  - `src/adapters/gsd/agents-json.ts:53-57` appends the shell note to the four run agents, then the executor note to `gsd-executor`, then `AVARICE_VERIFIER_ADDENDUM` to `gsd-verifier`.
  - So the executor and verifier prompts do not end with the shell note, and the verifier note is not mentioned here.
  - The verifier note is described in checks-and-evidence.md.
- **Fix:** Say the run agents carry the shell note as their first closing note, then name the executor note and the verifier note, with a pointer to checks-and-evidence.md for the latter.

### W9 WARNING (wording): sentences over the 35-word cap in new text
- **Locations (approximate word counts):**
  - the agents-file bullet (about 37);
  - the cross-item attribution sentence in "Outcome classification" (about 58);
  - the run-scope drop-rule paragraph (about 38 and 43);
  - the subagent-limits paragraph "Across items..." (about 65, with three claims);
  - the ownership-refusal sentence "Once the profile is open..." (about 46);
  - the `hook.decision` bullet (about 38).
- **Fix:** One claim per sentence. For the 65-word sentence, split into the shared-balance claim, the per-item total with its arithmetic, and the survives-kills claim.

### OBS
- **Malformed-policy list is incomplete.** The text lists "a reserved variable or ... a value that is not a plain word, or ... no program word". `assignmentRefusal` (`conventions.ts:225`) also refuses a name that does not match `[A-Z_][A-Z0-9_]*`, so a lowercase assignment name is malformed too.
- **Owner-command recording.** "What an owner command records is the operating system user as `owner:<name>`" fits `decide` and `contract amend`. `schedule` records nothing.
- **Missing worklist row.** The worklist row for question capture lists containment.md. The built behaviour is that the unit's final-text tail (2000 characters) travels only in the outcome's `question` field and in no event or log (`claude-host.ts:258`, `stream-json.ts:76`). The document does not mention it.

### Claims checked and verified, not flagged
- **Hook command identity with leading assignments:**
  - Admission needs the exact leading assignment words in order, and an unlisted leading assignment gives `shell-not-allowed`, because denied-prefix and read-only matching see `words[0]`, which is the assignment (`hook-decision.ts:455-500`, `:688-700`).
  - The never-granted check judges the first word after the assignments, by last path segment and lower-cased (`conventions.ts:230-235`, `hook-decision.ts:462`).
  - Scope drop rules and the `npm`/`npx` lift keyed to the program word (`invocation-scope.ts:455-463`, `:519-522`).
  - A malformed policy fails closed with exit 2 (`hook-decision.ts:166-215`, `hook/pre-tool-use.ts:36`).
  - Refusal reasons are fixed text plus policy command names, and the rule recorded does not change (`run-shell-rules.ts`, `hook-decision.ts:742-752`).
- **Launch line and host:**
  - Launch line shape with `--allowedTools Glob,Grep`, and resume swapping only the final pair (`launch-args.ts`).
  - Argument-judgment refusals: the `=` form, a second `--allowedTools`, any other value, and `--allowed-tools` (`launch-args.ts:97-133`).
  - A UUID check on the resume ID before any write (`claude-host.ts:140-145`).
  - Reaping by `--(session-id|resume) <uuid>` (`claude-host.ts:386`).
  - Five admitted host versions (`launch-preflight.ts:24`).
- **Owner commands:**
  - Order of the three identity checks and the exact reason strings (`identity.ts:25-30`).
  - Ancestry reading: `/bin/ps`, lazily after the first two checks, 64 hops, 400-character cut keeping head and tail, fail closed on an unreadable or looping chain (`ancestry.ts`).
  - Usage run before the profile is opened, so a refusal creates nothing (`main.ts:103-112`).
  - Ownership refusals with exit 64 for `decide`, `cancel` and `schedule`; `contract amend` has no ownership check and relies on the store's own ownership refusal (`db.ts:112-128`).
  - `digest` refusing only inside a run (`digest.ts:15`).
- **Budgets and attribution:**
  - Cross-item numbered-choice attribution: verified unit, exactly one other owning item with an owner choice, doubt keeps the pause (`outcome.ts:151-171`).
  - Subagent budget: 10 per item (5 x 2 rounds), a concurrent cap of 2, and a ledger-backed total (`run-contract.ts` `scaledBudgetLimits`).
- **Style and cross-references:** no banned dashes, no delivery history or plan IDs, no paths in the body after the opening, and the new opening module list matches the code touched. Links and anchors resolve as listed below.

## Cross-references
- **Anchors that resolve:**
  - runs.md `#the-unit-running`, `#answer-and-resume` and `#amendments-and-contract-versions`.
  - config-reference.md `#run-conventions-reader-schema-1` and `#environment-variables-avarice-sets-for-child-processes`.
  - integrations.md `#direction-and-invocation`.
  - autonomy-and-decisions.md `#response-checks`.
  - containment.md `#secret-redaction`.
- **Contradiction with runs.md:** `docs/system/runs.md` "Gate G1, gate G2 and the commit" carries a G2 failure-to-decision table that contradicts checks-and-evidence.md's "Otherwise... repeated_failure" sentence (W2).

## Read-only sweep
`git status --short` shows `?? .planning/milestone.lock` (present at the start) and `?? .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-1-E.md`. The second file is not mine. I wrote nothing in the repository and only read files; my scratch files were under /tmp.

## Verdicts
- docs/system/checks-and-evidence.md: needs-changes (W1, W2, W3, W4 are behaviour; W5, W6 are wording).
- docs/system/containment.md: needs-changes (W7, W8 are behaviour; W9 is wording).
