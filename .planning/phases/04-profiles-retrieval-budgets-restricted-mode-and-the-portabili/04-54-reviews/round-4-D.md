**Round 4 report, group D (scoped)**

- Group: D
- Round: 4, scoped
- Base: f19ae4e..1987922
- Reviewer: fresh (I did not read 04-54-reviews/)
- Date: 2026-11-23
- sha256 as read. All three match the dispatch.
  - docs/system/runs.md: 3c3e26baa6a405f99fc54f0a9fd5655cac65a6a4c06bd010c02fa4909ac0be51
  - docs/system/onboarding.md: c4d534ba77c0097f61e957bca1cb2aee5f202d1f869ae7c81a937a4f27346c15
  - docs/system/indexes-and-context.md: 3852e2442bfcb0e4ebc96819080b804682e3decacdfc2cf1af0b877c0642cf59

**Findings in scope: none.**

Severity scale: BLOCKER = factual error against the code. WARNING = misleading or unsupported claim, contradiction, or doctrine violation. NIT = polish.

**Checked and deliberately not flagged**

runs.md, order of checks (lines 43-44, 52):
- The new order matches `src/app/run-start.ts`.
  - Preflight comes before profile limits.
  - When history descends from the pin, `conventionsAt` is read first, and an invalid file is `conventions-invalid` (lines 257-263).
  - `judgeRunPreflight` then judges (268-280).
  - `parseConventions` runs again after the preflight, with the same refusal (282-283).
  - Profile limits come after that: `retrieval` (286), `limits` and `active-runs` (289-302).
  - Contract compile follows.
- The routing sentence lists the seven refusals that come from the numbered checks, and the last six rows of the table are the preflight rules, in the order of `src/domain/run-preflight.ts`.
- The table holds 13 rows, which agrees with the unchanged "thirteen refusal codes" quirk.

runs.md, records written by a start (line 56):
- `createRunWithContract` (run-start.ts:326-330) is the transaction. It holds the run, the contract, the budget rows and the work items.
- `recordTaskRefs` (334) is a second write, after the transaction.
- A failure of `recordTaskRefs` returns `internal` (337), which is exit 70, and the message says the run is stored.
- A start killed before that write leaves a run with no brief reference. The ordering of the contract-file write after it also matches (341-345).

runs.md, line 163:
- `deletion-scope` is a G2 rule (`src/domain/gates.ts:105`, `G2:deletion-scope` at 360).
- "A rename arrives as a deletion plus an addition" matches gates.ts:38.

runs.md, line 77:
- Both links resolve. config-reference.md and containment.md exist, and the same anchor was already in use.

runs.md, line 106:
- "required and target" matches `checksToRun` and `runsCheck` (`src/app/checks.ts:90-101`). `markInterruptedChecks` iterates `checksToRun` (`src/app/run-resume.ts:197`).

runs.md, Launch split:
- I joined the new Launch paragraphs, from "Launch." up to "Before the host starts", with whitespace normalised.
- The result is character-identical to the old single paragraph (5990 characters each). No fact was lost.

runs.md, deleted Quirks. Each fact still has a home.

| Deleted quirk | Where the fact now lives |
|---|---|
| Parked delta lives only under a ref in the run clone; not fetched into the source; dropped when the item commits | "Park and unpark" (line 250): the ref is never fetched into the source, and it is dropped on host launch for an answer and again when the item commits. |
| An amendment makes every open decision stale; the next answer re-opens the decision | "What a stale answer does" (line 433), with a link to autonomy-and-decisions.md. |
| A hand-recorded reference is never refreshed, so a pasted excerpt or pull request URL cannot block a run | Line 464: such a reference "stays as recorded". |
| A run blocked by a changed, deleted or revoked reference is final | Line 475: "A run blocked for this reason is final". |

onboarding.md, line 162 (`mapping:plan` refusals):
- Loading the plan refuses an entry that is not a string, as `invalid` on `mapping:plan` (`src/app/stages/shared.ts:104-105`).
- Preparing the invocation refuses a scope that is empty or has any path failing `isScopePath`, as `invalid` on `mapping:plan` (`src/app/invocation.ts:109-110`).
- The map stage refuses no path, more than 50 paths, or a bad path, as `internal` (`src/app/stages/map.ts:22,26-27`).
- This agrees with the unchanged "not launched, nothing reserved or recorded" text.

indexes-and-context.md, line 244:
- The regex `PHASE_FILE = /(?:^|-)(?:CONTEXT|LEARNINGS)\.md$|-PLAN\.md$/` (`src/adapters/context/gsd-planning.ts:32`) matches context and learnings files, and `-PLAN.md` files.
- A bare `PLAN.md` is not matched, so the new wording is correct.
- The old wording, "`PLAN.md`", was wrong.
- No other doc in docs/system/ contradicts the new wording.

Doctrine sweep over the added lines of all three files:
- No em dash, en dash or ` -- `.
- No delivery history in the prose. G0 and G2 are functional gate names.
- Headings are unchanged.
- I split sentences on full stops (table rows and code fences excluded). The longest changed sentences are 35 words, in runs.md at the retrieval-budget sentence (line 171) and at "Paragraphs are separated by blank lines..." (Launch). That is at the cap, not over it.

**Observations outside scope** (not counted in the verdict)
- None.
- The 35-word sentences are in text that was moved or retained, and they are at the cap.

**Read-only proof:** `git status --short` after the run shows only the two untracked `.planning/` files that were there before my run (`.planning/config.json`, `.planning/milestone.lock`). I modified no tracked file.

**VERDICT: PASS.** In scope: 0 BLOCKER, 0 WARNING, 0 NIT.
