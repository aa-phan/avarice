# Fresh reviews of the docs/system changes of plan 02-26

Twelve rounds by fresh reviewers that did not write the changes (separate `claude -p` processes using the prose-review skill; the executor has no sub-agent tool). The reviewers had Read, Grep and Glob only, so none could run git or the ledger commands; the executor ran those and the rule count, test-file count and source-line count were taken from its own runs. The reviewed parts were the added lines of `docs/system/containment.md` and `docs/system/findings.md` against `src/domain/hook-decision.ts` and `src/adapters/host-claude/settings.ts`, with `docs/system/coverage.md` checked for consistent counts. The reports are verbatim, including the reviewers' own remarks about how they worked. Round 9's reviewer delegated to sub-reviewers and reported their findings together; its report is kept as it came.

Digests are recorded for the round 12 version and the final version only. Rounds 1 to 11 reviewed the working tree and their digests were not taken at the time; they are not recoverable.

| Round | Report | Verdict | What the round found and what was done |
|---|---|---|---|
| 1 | round-1-containment-and-findings.md | BOUNCE | BLOCKER: `git status -u -v` passed the hook (the hook skipped the word after a bare `-u`; git does not). Fixed in the code, RED first. Two WARNINGs on the check order and an overstated equivalence, 6 OBS applied |
| 2 | round-2-containment-and-findings.md | BOUNCE | 2 WARNING: a colon word after a bare `-u` was not judged as an object name (code fix, RED first); the check order omitted `shell-syntax`. 5 OBS applied |
| 3 | round-3-containment-and-findings.md | BOUNCE | BLOCKER: the stated order inside rule 12 was wrong. WARNING: an absolute claim about option position. Both rewritten; 5 OBS applied |
| 4 | round-4-containment-and-findings.md | BOUNCE | WARNING: the path part is judged on the working copy's file system (symlink gap). Documented in rule 12 and recorded in findings.md. 4 OBS applied |
| 5 | round-5-containment-and-findings.md | BOUNCE | BLOCKER: `:^` is pathspec negation, so `git show :^path` printed HEAD's patch. Fixed in the code, RED first, with a real-git corpus form |
| 6 | round-6-containment-and-findings.md | BOUNCE | BLOCKER: a quoted wildcard after a leading colon is a pathspec for git. Fixed in the code, RED first, real git prints the sentinel. 2 WARNING and OBS applied |
| 7 | round-7-containment-and-findings.md | BOUNCE | 2 WARNING: the proposal finding and the read-rules paragraph overstated the fix. Rewritten |
| 8 | round-8-containment-and-findings.md | BOUNCE | 2 WARNING: the symlink exception covers the file itself, and a contract command is an admitted shell command. Rewritten |
| 9 | round-9-containment-and-findings.md | BOUNCE | 5 WARNING: sentence length (the 35-word cap), an unsourced clone claim, a contradiction with the Limits bullet, a stale count in coverage.md, a long findings line. Split, cited and corrected |
| 10 | round-10-containment-and-findings.md | BOUNCE | WARNING: one sentence of 48 words. OBS on rule 12 wording, the object store and two stale citations applied |
| 11 | round-11-containment-and-findings.md | BOUNCE | WARNING: two long option bullets; the `--pat` example is not accepted by `git log` (checked with real git: `git log --pat` is refused, `git status --verb` is accepted). Example replaced in the document and the code comment. OBS applied |
| 12 | round-12-containment-and-findings.md | PASS | No BLOCKER or WARNING; 6 OBS. OBS 1, 3, 4 and 5 applied after the report; OBS 2 (rule 12 is one long list item) and 6 (placement of the "now at" notes) left: no factual effect |

Digests of the reviewed versions:

- Round 12 reviewed: containment.md sha256 8fe9631bb2ce1baec4d484124e8f0c999b265e2017f356f8c1eeb8ddd1bfc70c, findings.md sha256 c9acb21ca85a7a1c5f1c2c670772e73ce4dbebc7f0b243ec74ca29addf3947fa
- Final, after the round 12 OBS fixes (three phrases in containment.md and one citation in findings.md): containment.md sha256 be339f7ec006cae1b446b8304fa1bafdba2d9c3dad2f1264786926cf5d4e4775, findings.md sha256 c5e99d112c9d71dc6a6383d889ebb45a1824e60ea875025a21e745ad2ea83d5f

Four real defects of the hook, none of them in the plan's corpus, were found by the reviews and fixed with a failing test first: the `-u` word skip, a colon word after a bare `-u`, `:^` pathspec negation and a quoted wildcard after a leading colon. Their RED records are 02-26-red-evidence-task2b.json to task2e.json.

The cost of the review processes is not in the Phase 2 ledger, as for the reviews of plans 02-23 to 02-25: the ledger holds development live cases, containment rehearsals and exit runs.
