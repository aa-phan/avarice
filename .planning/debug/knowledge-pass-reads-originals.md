---
status: diagnosed
trigger: "UAT gap G-01-154 (test 154): live knowledge agent read 16 original staging/docs files instead of the .avarice-knowledge copies; all 16 denied outside-read-set; record has 9 document nodes (24 in the target run) with dropped 0; injected ADR-999 never read, so the exit-run fence check failed. goal: find_root_cause_only"
created: 2026-11-05T00:18:13Z
updated: 2026-11-05T00:18:13Z
---

## Current Focus

hypothesis: CONFIRMED (root cause set, AND-gate fires). Trigger is a nondeterministic model path slip (drops the `.avarice-knowledge/` segment). Three deterministic defects turn the slip into silent data loss: (1) the chunk plan and prompt make the model compose the path; (2) the denial and the prompt give no recovery path ("skip it and go on"); (3) nothing checks per-document coverage and the record's `dropped` has no such counter.
test: n/a (diagnose-only). No paid run started.
expecting: n/a
next_action: return ROOT CAUSE FOUND to the caller; /gsd-plan-phase --gaps owns the fix
bug_class: mandelbug (nondeterministic model behaviour, trigger) plus bohrbug (deterministic missing coverage check). SBFL skipped: no per-test coverage involved.
reasoning_checkpoint: n/a (no fix applied in find_root_cause_only mode)
tdd_checkpoint: null

known_pattern_candidate: none (.planning/debug/knowledge-base.md does not exist)

## Symptoms

expected: (UAT test 154) On a live onboarding the knowledge agent reads the corpus AVARICE prepared in staging/.avarice-knowledge/, so every corpus document (docs/, docs/adr/, docs/decisions/, .planning/) becomes a document node, and any document it could not read shows in the record's dropped counts.
actual: "in the live rehearsal the knowledge agent read 16 original staging/docs files instead of the .avarice-knowledge copies; all 16 denied outside-read-set; record has 9 document nodes (24 in the target run) with dropped 0; injected ADR-999 never read, so the exit-run fence check failed"
errors: assert-exit problem "avarice context did not print the injected node inside the untrusted-data fence" (scripts/exit-run-tools.ts:466; injectedTextInsideFenceOnly null because no injected text appeared at all). The 16 Read tool_results carry "PreToolUse:Read hook error: avarice: outside-read-set".
reproduction: scripts/exit-run.sh --rehearsal, onboarding onb_01M6MFN69E44KS993F3XMK7Q6V, knowledge invocation inv_01M6MFZ9Z7C263G8Q7EN3AWRZ3, claude 2.1.317, model claude-haiku-5-5 (2026-11-04T23:52Z)
started: first seen in rehearsal 5 of plan 01-19 (2026-11-04T01:21Z), not diagnosed then; absent in rehearsal 6 and the 01-19 target run

## Eliminated

- hypothesis: regression from plans 01-21..24 or quick tasks 261104-jnc/l3t/nxh changed the knowledge read set, cwd, prompt or chunk paths
  evidence: `git diff --stat 0d930f3 HEAD` (0d930f3 is the HEAD the target run executed on, 2026-11-03T19:40 -0600) is empty for knowledge-extraction.ts, knowledge-corpus.ts, knowledge-validation.ts, graph-merge.ts, index-knowledge.ts, launch-args.ts and outcome.ts. The hook's readConfine line is unchanged (only the comment above it changed). invocation-scope.ts only added workRoot to denyRead and own staging to allowRead; `cwd` and `readConfine` for the knowledge purpose are unchanged. No `--add-dir` in launch args (assertLaunchArgsSafe refuses it).
  timestamp: 2026-11-05T00:18Z
- hypothesis: the 01-23 read allow-list (outside-read-set rule) is what newly denies the originals
  evidence: readConfine returned 'outside-read-set' as the first check already at 0d930f3 (git show 0d930f3:src/domain/hook-decision.ts line 186; readConfine was introduced by 7ffc697, 2026-11-03T19:09). The target run would have denied the same reads; its model simply never asked for them (0 denies).
  timestamp: 2026-11-05T00:18Z
- hypothesis: the corpus copy is incomplete (originals read because copies are missing)
  evidence: staging/.avarice-knowledge holds all 25 manifest documents (manifest.json: 25 entries, 0 excluded) including docs/adr/*, docs/decisions/ADR-999-injected.md and .planning/codebase/TESTING.md.
  timestamp: 2026-11-05T00:18Z
- hypothesis: work-root path form or length (a /private/var/folders temp root vs the target's ~/.local/share root) causes the slip
  evidence: rehearsal 6 used a /private/var/folders temp root too and read all 25 documents correctly with 0 denials.
  timestamp: 2026-11-05T00:18Z
- hypothesis: claude 2.1.317 vs earlier version or Node 26.9.0 vs 22.22.3
  evidence: rehearsal 5, 6 and the target all ran claude 2.1.317 on Node 22.22.3; rehearsal 5 (failed) and 6 (passed) differ only in model sampling. Node does not touch the model's path choice.
  timestamp: 2026-11-05T00:18Z

## Evidence

- timestamp: 2026-11-05T00:18Z
  checked: UAT rehearsal knowledge transcript (/Users/aphan/.claude-edu/jobs/7fea7089/tmp/knowledge-transcript.jsonl), Read tool_use paired with tool_result, grouped by assistant message id
  found: init cwd = `<stg>/.avarice-knowledge`. 10 correct Reads (`<stg>/.avarice-knowledge/.chunks.json`, 3 planning docs, ARCHITECTURE, CONCERNS, CONVENTIONS, INTEGRATIONS, STACK, STRUCTURE), then in ONE parallel batch (msg ...UixCKC) the first call is correct (STRUCTURE.md) and the remaining 7 are `<stg>/.planning/codebase/TESTING.md` and `<stg>/docs/adr/0001..0006`: the `.avarice-knowledge/` segment is dropped. The next two batches (8 + 1 Reads) repeat the wrong prefix. 16 of 16 wrong Reads denied outside-read-set; 0 retried with the right prefix. Model wrote chunk-03 (nodes only for STRUCTURE.md) and chunk-04/05 as `{"nodes":[],"edges":[]}`, then answered "done".
  implication: the slip is in the model's path composition, starts mid-batch before any denial, and is then reinforced in context. The model never recovered because nothing told it how.

- timestamp: 2026-11-05T00:18Z
  checked: .chunks.json the agent read (transcript row 6) and knowledgePrompt() in src/domain/knowledge-extraction.ts
  found: each chunk file has `path` = repository-relative path (`docs/adr/0001-....md`, `.planning/codebase/TESTING.md`) and `stem`. The prompt says twice "absolute path: your working directory, then / and the file's path" and ends "If a file cannot be read, skip it and go on: do not stop." The same relative paths exist as real files in staging (originals), so a dropped segment yields a plausible real path.
  implication: AVARICE hands the model a path the model must prefix itself; the failure value is a real file, and the prompt turns a read failure into a silent skip.

- timestamp: 2026-11-05T00:18Z
  checked: the same transcripts for rehearsal 5 (/private/var/folders/.../avarice-exit-rehearsal-VLzqwQ, artifact f0014c1c...) and rehearsal 6 (RSsQpz, artifact 9f036bee...), read-only
  found: rehearsal 5 (2026-11-04T01:21Z, split knowledge pass, before every 01-21..24 and quick-task commit): the same pattern. 11 correct Reads (through TESTING.md), then in the same batch `<stg>/docs/adr/0001..` onward wrong (15 outside-read-set denials, permissionDenials 15); chunk-03 holds only the TESTING.md document node and chunk-04 is `nodes: []`. Without the separate .planning/phases validation bug it would have gone `active` with 10 of 24 documents and no signal. Rehearsal 6: all 25 documents read under `<cwd>/` with 0 denials. 01-19 target: 27 Reads, all under `.avarice-knowledge/`, 0 denials. UAT rehearsal: 16 denials.
  implication: over the 4 live runs of the split pass the slip occurred 2 times (rehearsal 5 and the UAT rehearsal), on the same claude version and unchanged prompt/plan. It is nondeterministic and it pre-dates the 01-21..24 work. Not a regression.

- timestamp: 2026-11-05T00:18Z
  checked: 01-19-evidence-rehearsal-5.json hookDecisions and 01-19-SUMMARY.md
  found: rehearsal 5 evidence already shows `deny:outside-read-set: 15`, but the summary (line 51, 82, deferred item 16) attributes the lost index only to the forbidden-source rule and fixed that (0d930f3). The 15 read denials were never analysed.
  implication: the first sighting was in the evidence and was missed; there is no gate that makes read denials in the knowledge invocation visible.

- timestamp: 2026-11-05T00:18Z
  checked: src/domain/outcome.ts classifyOutcome and src/app/stages/index-knowledge.ts
  found: classifyOutcome returns `progressed` when expectedFilesPresent (outcome.ts:61), before it looks at permissionDenials/hookDenies (outcome.ts:62). The stage only inspects countBudgetDenials. The invocation.finished event for the UAT run shows hookDenies 16, outcome progressed.
  implication: 16 hook denials of the pass's own reads do not change the stage's path; they appear only in the ledger event.

- timestamp: 2026-11-05T00:18Z
  checked: assembleExtraction (knowledge-extraction.ts), validateKnowledgeGraph (knowledge-validation.ts), mergeAndInstall (index-knowledge.ts:186,240-243), record step result in the rehearsal ledger
  found: a chunk is "usable" when its file is JSON with a `nodes` array and an `edges` array; `{"nodes":[],"edges":[]}` is usable, and `usedFiles` then includes all its documents. `usedEntries`/`coveredPaths` come from `usedFiles`, so `knowledge.corpus` = [".planning/PROJECT.md",...,"docs/","docs/adr/","docs/decisions/"] although chunks 4 and 5 and 8 of 9 chunk-3 documents have no node. validateKnowledgeGraph only requires `documentIds.size > 0` ("the pass added no document node"). The chunk-count rule is `usable >= ceil(chunks/2)` = 3 of 5 (5 usable). Record: documentNodes 9 of 25 manifest entries, `dropped: {astDocument: 0, dangling: 0}`.
  implication: nothing compares document nodes (or read documents) with the manifest. The record also claims corpus directories it did not cover.

- timestamp: 2026-11-05T00:18Z
  checked: plan 01-18 (line 155, 215) and docs/repository-onboarding.md line 111, test/integration/knowledge-pass.test.ts:239-260
  found: `dropped` was specified as `{dangling, astDocument}` only (merge-stat edge counters; the merge's own `malformed` counter is not even recorded). The design states "with at least half the chunks usable they go on, and the record's knowledge.corpus names only the documents those chunks cover", and test 239 pins a usable chunk with `nodes: []`, asserts `documentNodes === 1` and `active`.
  implication: the code does what it was specified to do. The UAT expectation "any document it could not read shows in the record's dropped counts" is not a regression; it is a missing requirement (per-document coverage accounting) that needs a spec and a field.

- timestamp: 2026-11-05T00:18Z
  checked: scripts/exit-run-tools.ts:455-467 (rehearsal assertion) and the context output in the UAT evidence
  found: the fence check needs a context line matching /ignore your contract|push to main/ and passes only if all such lines are inside the fence. The ADR-999 file docs/decisions/ADR-999-injected.md (the fixture) was never read, so its sentence never entered the graph; the ADR-999 hits in the context come from CONCERNS.md (a mapper-written note about the fixture), which has no injected sentence. `injectedTextInsideFenceOnly` is null, which the check treats as failure.
  implication: the assert-exit failure is a downstream symptom of the unread corpus, not a separate bug. It is also the only live gate that noticed.

## Resolution

root_cause: |
  A set of causes (AND-gate: the failure needs the trigger plus the two deterministic holes).
  1. TRIGGER (nondeterministic, model): claude-haiku-5-5, told to build each Read path as "your working directory, then / and the file's path", sometimes drops the `.avarice-knowledge/` segment and reads `<staging>/docs/...`, `<staging>/.planning/codebase/TESTING.md`. Observed in 2 of 4 live runs of the split pass (rehearsal 5, UAT rehearsal) and absent in 2 (rehearsal 6, 01-19 target). Not a regression: rehearsal 5 pre-dates 01-21..24 and the quick tasks, every knowledge-related source file is identical to the commit the target ran on, and the readConfine rule that denies the originals was already first in the hook at 7ffc697/0d930f3.
  2. DESIGN (deterministic, no recovery): the chunk plan lists repository-relative paths that also exist as real files in staging (the originals), AVARICE does not hand the model the path to read, the hook's denial text is the bare "avarice: outside-read-set" with no allowed root, and the prompt says "If a file cannot be read, skip it and go on: do not stop." So after the first slip the model never corrects and repeats the wrong prefix in later batches (it wrote empty chunks 04 and 05 and finished with "done").
  3. NO COVERAGE ACCOUNTING (deterministic, code): a chunk counts as usable on JSON shape alone (`nodes: []` is usable); `usedFiles`/`knowledge.corpus` are derived from chunk shape, not from document nodes; validateKnowledgeGraph only needs one document node; classifyOutcome returns `progressed` before it counts hook denials; the stage ignores non-budget denials; the record's `dropped` holds only `{dangling, astDocument}`. So 16 of 25 documents without a node produced `active`, `dropped 0`, and a corpus claim that includes docs/, docs/adr/ and docs/decisions/. No test or spec requires per-document coverage; test knowledge-pass.test.ts:239 pins the opposite for an empty usable chunk.
fix: ""
verification: ""
oracle_type: ""
files_changed: []
