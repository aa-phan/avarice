# Round 1, group A: fresh prose review (verbatim report)

Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator and given only the documents, the code and the house rules.
Documents: docs/system/autonomy-and-decisions.md, docs/system/findings.md, docs/system/unknowns.md. Diff base fc15fea, working tree at HEAD fe577bf.

---

VERDICT: NEEDS CHANGES. Group A round 1 has 4 WARNINGs about code behaviour or code citations, so it forces a fix and a full new round. It also has 2 wording-only WARNINGs and 5 OBS. There is no BLOCKER.

Digests reviewed (SHA-256), at HEAD fe577bf, baseline fc15fea:
- docs/system/autonomy-and-decisions.md: b22688d121328536dfce45752ef85239775705dccb94a3a2829ce0488b1c2d75 (125 lines)
- docs/system/findings.md: a50c9b5f4f61ac367466730bb10bc09b43ae692e9f6b070015e6d7d3f2afcc21 (300 lines)
- docs/system/unknowns.md: fcb747b46780a8c85e2d74d43a9285bf286205f2128101f592c1f4022d0b9ce7 (133 lines)

Severity key: BLOCKER = cannot proceed. WARNING = fix; under the round rules, a code-behaviour or citation WARNING forces a new round. OBS = worth noting.

## Findings, most severe first

### W1. WARNING (code behaviour). autonomy-and-decisions.md, Notification, "What it says" (line 101)
- Claim: "The body holds counts, the run ID, at most three decision IDs and the next command ... It holds no decision issue and no text the model wrote."
- Status: partly wrong.
- Evidence:
  - `bannerText` can list up to three IDs (`src/domain/notify-policy.ts:213-225`).
  - No caller ever passes `decisionIds`. The three call sites, `src/app/notify.ts:65`, `src/app/notify.ts:212` and `src/app/digest.ts:48`, pass only kind, runId and count.
  - The digest banner carries no run ID (`digest.ts:48`).
  - Built banners therefore hold counts, the run ID (run banners only) and the next command. They never list decision IDs.
- Fix: drop "at most three decision IDs" and say the digest banner has no run ID. Alternatively, record in findings.md that the policy supports IDs that no caller passes.
- Confidence: high.

### W2. WARNING (code behaviour). autonomy-and-decisions.md, The amendment request (line 80)
- Claim: "If the owner gives an option key for such a record, nothing is applied. An event records that an amendment was requested ..."
- Status: partly wrong.
- Evidence:
  - Such a record lists the option `withdraw`.
  - An answer of `withdraw` passes the option check and is applied as a withdrawal (`src/domain/response-validation.ts:77-79` and the final `kind === 'withdraw'` apply).
  - The amendment-requested path fires only for the check `option-not-listed` (`src/app/decide.ts:134-138`).
  - The document's own Withdraw section says the owner can withdraw such a record.
- Fix: write "an option key that is not listed (any key other than `withdraw`)".
- Confidence: high.

### W3. WARNING (code behaviour or internal contradiction). autonomy-and-decisions.md, Classes and authority (line 47) against the table (line 43)
- Claim: "Budget and permission decisions have authority `prohibited` ... these offer `withdraw` and are answered by an amendment made from outside the run."
- Status: partly wrong, and it contradicts the table.
- Evidence:
  - The table gives `permission` the amend command "None".
  - `amendCommandFor` returns null for `permission` (`src/domain/decision-policy.ts:253-255`, the default branch).
  - So the record offers no amend command, and `decide` cannot print or pre-fill one.
  - `src/app/amend.ts:60` lets an amendment name a permission decision, but only by hand.
- Fix: say that budget decisions are answered by an amendment, and that a permission decision carries no amend command, so its only answer from `decide` is `withdraw`. Alternatively, state that the amendment command can name a permission decision if the owner supplies the flags.
- Confidence: high.

### W4. WARNING (citation). findings.md, From data-model, composition line (line 56)
- Claim: "`src/cli/composition.ts:145` (now at `src/cli/composition.ts:154`): a read-only command migrates ..."
- Status: wrong.
- Evidence:
  - `src/cli/composition.ts:154` is `if (!resolved.ok) return failure(...)`.
  - The migrate-on-read-only code is at `:172-175`: `migrate(...)` is at 175, and the writable-open fallback starts at 172.
  - The shell finding at line 230 (`:164` now `:173`) is right.
- Fix: re-point to `src/cli/composition.ts:175`.
- Coverage note: I spot-checked about 45 of the new "(now at ...)" re-points against the code, and this was the only wrong one. The re-pointing was done by hand, so the author should re-check the full set of 32 hunks.
- Confidence: high.

### W5. WARNING (wording, hard sentence cap of 35 words). autonomy-and-decisions.md
Six sentences exceed the cap. Word counts come from my mechanical sweep; code fences and table rows are excluded.
- Line 5, the opening: 63 words. Split it after "state digest" so the module list does not run on; the paths stay in the opening.
- Line 55, Identity: 49 words. Split it by refusal.
- Line 65, "The service reads the decision once more ...": 36 words.
- Line 82, "The command then shows the amendment preview ...": 46 words.
- Line 110, digest catch-up: 40 words.
- Line 112, schedule install: 41 words.
- Fix: split each into two sentences. The content is unchanged.
- Confidence: high.

### W6. WARNING (wording). findings.md lines 145 and 225
- Quotes: "Resolved with this change: only the checks the run executes are listed ..." and "Resolved with this change; whether a later host keeps the rule is unknown".
- Defect: "this change" has no referent for a cold reader. Neighbouring lines name a commit ("Resolved at 5878368", "Resolved at d16fad6").
- Fix: replace each with "Resolved at <sha>".
- Confidence: high.

### O1. OBS. autonomy-and-decisions.md line 31
The document does not say that numbered choices need at least two choice lines. `parseNumberedOptions` returns none for fewer than two (`src/domain/decision-policy.ts:124`). Add "at least two".

### O2. OBS. autonomy-and-decisions.md line 24, "Urgency: Always blocking"
The ledger also accepts `digest` (`src/adapters/sqlite/ledger.ts:1358`); the run writes only `blocking` (`decision-policy.ts:61`). Say "Always blocking as the run writes it".

### O3. OBS. autonomy-and-decisions.md line 49
"A decision about one item (reason `decision`) stops only that item ..." is loose.
- `blockRun` also uses reason `decision` for three other cases, each of which stops the run, although nothing else is left to run in them:
  - final-proof G4 failure (`src/app/run-stages/finish.ts:244`);
  - hand-off conflict (`finish.ts:284`);
  - preparation failures (`prepare.ts:242`).
- Consider "an item-local block (opened while the units run)".
- Confidence: medium.

### O4. OBS. autonomy-and-decisions.md lines 77-78
The `## The amendment request` heading follows the Withdraw paragraph with no blank line. Add one.

### O5. OBS. findings.md, new section "From autonomy-and-decisions", lines 249 and 254
The house rule is one `file:line` per line. These two lines carry two citations each: `supervise.ts:66` with `notify.ts:47`, and `outcome.ts:116` with `item.ts:390`. Split them or keep only the lead citation. Many older lines do the same, so this is low priority.

## Behaviour claims checked (autonomy-and-decisions.md)

Verified against src:
- **Decision records**
  - ID shape: `dec_` plus a 26-character ULID (`ids.ts`).
  - The ledger accepts eight classes and the run writes five (`ledger.ts:126`, `decision-policy.ts:50`).
  - The issue is cut at 1000 characters and the label at 200; at most nine options.
  - States: open, answered, stale, withdrawn.
  - Affected items: the item first, then its transitive dependents.
- **Options and classes**
  - Option sources and rules: a trailing `(Recommended)` on exactly one choice becomes the recommendation.
  - Legacy records with no options read as withdraw-only.
  - Withdraw-only classes, and the `1` to `9` keys.
  - The signals per class in the class table match the callers in `item.ts`, `finish.ts`, `prepare.ts` and `discard.ts`.
  - The amend commands in the class table match `amendCommandFor`.
  - Authority: no caller raises the auto-select or delegated signals, so every stored decision is `human` or `prohibited`.
- **Blocking**
  - An item-local block stops only that item and its dependents; a run-wide reason stops the run.
  - Withdrawn items stay blocked, and the run ends `failed`, naming the undelivered items and the withdrawn decisions (`work-items.ts`, `blocked.ts` moveOn).
  - The enforcement-check block opens no decision (`prepare.ts:407`).
- **Response checks**
  - The order of the five checks.
  - Free-text limits: 1 to 2000 characters, with no control characters except tab and line feed.
  - Duplicate handling, and the withdraw exemption from the digest check.
  - A missing digest never matches.
  - Digest inputs: contract version, base revision, policy revision and ticket revisions.
  - An unreadable process table counts as inside a run (`ancestry.ts`).
- **Recording and identity**
  - Refusals are recorded, except at the identity check (`decide.ts`).
  - The retry-once-then-conflict rule.
  - Identity refusals made before the profile opens.
- **Answers, stale re-open and withdraw**
  - Release of items on an answer (`ledger.ts` `releaseItems`).
  - The stale re-open copies the listed fields and adds the `contract:v` reference; the old row keeps the answer, who and channel.
  - Exit 3 for stale and for amendment-requested.
  - Cancel withdraws in decision-ID order (`cancel.ts`).
- **Amendments**
  - The prompt `amend` chain and the `amended:v` marker (`ledger.ts:1008`).
  - The amendable classes (`amend.ts:60`).
- **Supervisor pickup**
  - The supervisor re-reads after releasing its lease (`run-service.ts`).
  - The continuable rule, and `resume` applying the same rule.
  - Spawn goes through the one path, and `--wait` follows only a supervisor this command started.
  - The host config directory refusal at exit 3, before any write.
  - A supervisor started this way runs under the recorded directory (`spawn-supervisor.ts`).
- **Notifications**
  - Batching starts from the oldest queued notice, with a flush at item boundaries (`item.ts:1302`).
  - Destinations are narrowed by the contract.
  - The title is `AVARICE`, the body is at most 200 characters, and the retry delays are 0, 10 and 60 seconds.
  - The row states.
  - The half-open quiet range, which wraps midnight.
- **Digest**
  - It writes nothing when nothing waits.
  - It reuses one held row in quiet hours.
  - It marks covered rows delivered.
  - It neither reads nor writes a decision.
- **LaunchAgent**
  - No RunAtLoad or KeepAlive.
  - The refusals, including the empty digest-times refusal.
- **Quirks**
  - The resume prompt carries the answer without the question.
  - The parked waiting file, or `human_needed`, reads as paused again.
  - An answer to an ended run is still recorded.

Wrong: W1, W2 and W3 above.

Unverifiable (not run, and not read in the code):
- Whether launchd fires the agent and a banner shows on a real desktop.
- Whether every admitted host version honours `--resume`.
- The exact contents of the "evidence references" rows, beyond the gate tags.
The unknowns.md additions already record the first two as unknowns.

## findings.md and unknowns.md claims checked

- **findings.md, "From autonomy-and-decisions":** all 10 lines verified:
  - continuable only for reason `decision`;
  - `decide --wait` with a live supervisor;
  - `decide` reads no run state;
  - the killed-supervisor notice stays pending;
  - the resume prompt carries the answer only;
  - the resumed unit reads as paused again;
  - the non-UUID session ID;
  - G3 is given an empty authorized-path list;
  - the `human_needed` pre-existing failure;
  - `contract amend` has no owner check, while `decide`, `cancel` and `schedule` do (`decide.ts:197`, `cancel.ts:98`, `schedule.ts:59`; `contract.ts` has none).
  Also verified: the `bootout` result is unread (`launchd.ts:263`); `schedule` refuses every flag (`schedule.ts:33`); `osascriptPath` is read once (`composition.ts:290`); the digest returns `failed` on any failed destination (`digest.ts:94`).
- **findings.md, "Proposal drift" lines on autonomy:** lines 291, 292, 294, 296 and 300 match the code (`notify.ts:114`, `decide.ts:136`, `decision-policy.ts:205` and `:50`, `blocked.ts:226`).
- **findings.md spot checks:**
  - Line 197: `ledger.ts:1412`, `:1462`, `:1506` and `:1354` are right.
  - Line 124: `prepare.ts:407` is right.
  - Line 127: `failed` and `cancelled` are entered (`cancel.ts:41`, `blocked.ts:226`).
  - Line 129: `schedule.ts:37` is right.
  - Lines 143, 144 and 180: the evidence files exist (`test/containment/live-attended-phase2.jsonl`, `03-65-parity.json`). I did not recount the "1 of 4" and "0 of 3" session tallies.
- **Re-points checked, all correct except W4:**
  - ledger 237, 509, 531, 603 and 763;
  - `main.ts` 68, 71, 75-78, 107, 113 and 18;
  - `shell.ts:547`, `claude-host.ts:387`, `hook-decision.ts:839`, `item.ts:1891`, `run-contract.ts:703`, `finish.ts:246`, `gates.ts:76`, `supervise.ts:48`, `budget.ts:115` and `outcome.ts:117`;
  - `resume.ts:22` and `:28`, `run-status.ts:215`, `invocation.ts:177` and `:414`, and `launch-args.ts:63`;
  - a handful in `conventions.ts` and `checks.ts`.
- **unknowns.md changes, all verified:**
  - five admitted host versions (`launch-preflight.ts:24`);
  - eight PlantUML sources (`ls diagrams`);
  - the 27-point run fault suite (`RUN_KILL_POINTS`, 27 entries);
  - `failed` and `cancelled` are now entered;
  - every decision state is written (`answerDecision`, `reopenStaleDecision`, `withdrawDecision`);
  - `avarice contract amend` is built and `avarice budget` is not;
  - the three new autonomy unknowns have the file's "Checked / not determined" form.

## Mechanical sweep
- autonomy-and-decisions.md has no em dash, en dash or ` -- `. In findings.md and unknowns.md the only ` -- ` hits are inside backtick code spans (a `pgrep -f --` command and a `git diff ... --stat -- src` command), which are exempt.
- The autonomy-and-decisions.md prose has no phase, plan, threat or decision IDs, and no changelog or last-updated field.
- Source paths appear only in the opening paragraph, apart from link targets.
- Headings are sentence case, and none is a question.
- These link targets exist: `runs.md`, `data-model.md`, `cli-reference.md`, `config-reference.md`, `integrations.md`, `processes.md` and `diagrams/run-amend-stale.puml`.
- The routed content exists in the targets: the notify keys in config-reference (line 78), the launchd and osascript rows in integrations (lines 21-24), and amendments in runs (line 374).
- README and coverage list the new document.

## Left alone
- The quirks list repeats items that also sit in findings.md. They do different jobs, owner-decision lines versus reader warnings, so I did not flag a one-fact-one-home breach.
- The dense bold-label bullets in Notification are lists, not prose.
- The commit SHAs inside findings.md lines are claim evidence, which is permitted.
- "From from review" in findings.md is a pre-existing heading oddity, outside this change.

## Read-only proof
After my run, `git status --short` shows only `?? .planning/milestone.lock`, which was in the starting snapshot. `git diff --stat` is empty; I modified nothing. The only file I wrote, outside the repository, is `/tmp/fdiff.txt`.

## Per-document verdicts
- docs/system/autonomy-and-decisions.md: needs-changes (W1, W2 and W3 force a new round; W5 is wording)
- docs/system/findings.md: needs-changes (W4 is a wrong citation; W6 is wording; O5)
- docs/system/unknowns.md: pass
