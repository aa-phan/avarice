# Round 5, group A: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator. It read the round 4 report only after its own review. Document: findings.md. HEAD 8e2edc6.

---

Verdict: pass-with-nits. Round 5 of docs/system/findings.md has 0 BLOCKERs and 0 WARNINGs, so nothing goes to the owner as an open item.

SHA-256 reviewed: 388470a328af9a289bd27fc57333e651158f00150bce9fe884dfa973f0818a7e
Document: /Users/aphan/avarice/.claude/worktrees/phase-03/docs/system/findings.md, 303 lines, HEAD 8e2edc6.

Severity key: BLOCKER = cannot proceed. WARNING = a wrong claim or citation. OBS = worth noting. Line numbers are findings.md lines.

## Part 1: lines touched by `git diff 6b82bb6`
All eight changed hunks hold at HEAD.
- L25, `profile-paths.ts:91`: line 91 is `writeFileSync(configPathFor(...), ..., {flag:'wx'})`, the actual creation. Lines 87-89 are the `mkdirSync` calls. Resolved.
- L49, `map.ts:107`: the claim is true.
  - `outcome.ts:69` returns `paused` only when `pauseSignal === true`.
  - The only classifier call on the onboarding path, `claude-host.ts:227-242`, passes no `pauseSignal`.
  - `item.ts:407` is where the run item stage sets it.
  - Nit: the wording says "no onboarding stage passes" it, but the call is in the host adapter. The effect described is right.
- L78, `launch-preflight.ts:24`: the list is `['2.1.312','2.1.316','2.1.317','2.1.318','2.1.319']`. `existing-tooling-assessment.md:24` records only 2.1.312 and 2.1.316. Correct.
- L89: `seatbelt-profile.ts:84` emits `(allow network-outbound (remote ip "localhost:${port}"))`. The "From containment (run slice)" section exists (L182) and carries the matching line at L186. Correct.
- L168: `composition.ts:51` is `EXIT_INTERNAL = 70`, and `main.ts:18` is `EXIT_USAGE = 64`.
  - The 3s are per-command constants: `onboard.ts:13`, `repo.ts:13`, `resume.ts:22`, `context.ts:11`.
  - Correct.
- L106: the heading now reads "From review".
- L282: the "pass's code state" clause is gone.
- L297: `autonomy-and-decisions.md:40` names `scope_expansion` or `architecture`. `decision-policy.ts:50` has five classes, and `architecture` is not among them. The `:54`, `contracts-and-state.md:169` and `run-contract.ts:108` claims are unchanged and still hold.

## Part 2: independent sample
I read about 95 other lines' claims and citations, more than the 40 required, spread across all sections. I read the surrounding code, not only the cited line. Every target lands and every claim is true of the code or proposal text.
- Code behaviour checked:
  - `item.ts:390`, `item.ts:594`, `item.ts:608`, `item.ts:634`, `item.ts:1156`, `item.ts:1191` and `item.ts:1786`.
  - `outcome.ts:117`, `finish.ts:208`, `settings.ts:133` and `ledger.ts:940` and `:951`.
  - `launchd.ts:263` and `:267`, and the `main.ts:107`/`:113` try-block claim.
  - `ancestry.ts` (the chain walk stops at process 1) and `check-validation.ts:50`.
  - `hook/pre-tool-use.ts:100` and `:134`, where the only indexes are `events_run` and `evidence_attempt`.
  - `check-boundaries.ts:340`, `schedule.ts:33`, `composition.ts:173-175` and `supervise.ts:48`.
  - `events.ts:64`, `claude-host.ts:244` and `launch-args.ts:63`.
  - `register.ts:54`, `preflight.ts:50` and `:101`, and `mapping.ts:56`.
  - `project-record.ts:198`, `activate.ts:209`, `contract.ts:58`, `shared.ts:123` and `package.json:7`.
- docs/ targets and inline "(line N)" numbers checked:
  - `repository-onboarding.md:272` and `:285`.
  - `extensions.md:35`, `:43`, `:54`, `:56` and `:215`.
  - `contracts-and-state.md:126`, `:158`, `:169`, `:194`, `:566` and `:600`.
  - `autonomy-and-decisions.md:40`, `:54`, `:68`, `:75`, `:87`, `:91`, `:98` and `:167`.
  - `containment.md:3`, `:85`, `:108`, `:115`, `:133` and `:148`.
  - `existing-tooling-assessment.md:24`, `:103` and `:193`.
  - Cross-references inside findings.md at `:89` and `:91`.
- Pinned hashes all resolve with `git cat-file`: 304e551, d6bd6f6, bc2294d, 3fb6ae4, d16fad6, f1a4d8c, 5878368, 72a86b1 and 3d5bb44. The COMMANDS list at `main.ts:17` contains `contract`.

## Part 3: doctrine and ./CLAUDE.md
- There are no em or en dashes. The two ` -- ` hits, at L74 and L216, are inside code spans.
- Headings are in sentence case.
- Apart from the pinned hashes, the file has no delivery history in running prose. The hashes appear only as claim evidence.
- Sentence length: the scan found one 46-word segment, at L164. It is `;`-joined, unchanged since round 4, and is a list inside a `file:line` entry. Not flagged.
- `file:line` citations are by design for this file.
- Code and proposals are not edited to match each other, and the entries record disagreements.

## Nits (OBS, optional)
- L89, "one loopback port": `seatbelt-profile.ts:72-84` accepts a list of ports. The wording matches L186, and the built behaviour is one port. Say "loopback ports" or leave it.
- L49 wording: "no onboarding stage passes a `pauseSignal`". The classifier call is in `claude-host.ts:227`, so "the host adapter's classifier call passes none" would be more exact.
- Round 4 O-4, carried over: L74 and L216 duplicate the reaping fact, and L69/L213 and L73/L215 are duplicated too. L74 acknowledges its repeat, and L69, L73, L213 and L215 do not. This is acceptable.

## Round-4-A follow-up
| Item | Status | Evidence |
|---|---|---|
| W-A | Resolved | L49 is reworded and accurate (see Part 1). |
| W-B | Resolved | L78 lists 2.1.317, 2.1.318 and 2.1.319. |
| W-C | Resolved | L89 carries the loopback-port caveat and a pointer to L186. |
| W-D | Resolved | L297 now says only `architecture` differs, citing `autonomy-and-decisions.md:40`. |
| W-E | Resolved | L25 cites `profile-paths.ts:91`. |
| O-1 | Resolved | L168 also cites `composition.ts:51`. |
| O-2 | Resolved | The "pass's" clause is removed. |
| O-3 | Resolved | The heading is "From review". |

## Read-only proof
I made no edits. `git status --short` after my run shows only `?? .planning/milestone.lock`, which was there before I started.

Verdict: pass-with-nits.
