# Round 1, group D: fresh prose review (verbatim report). Reviewer: a fresh technical-writer:prose-reviewer, spawned by the orchestrator with only the documents, the code and the house rules. Documents: docs/system/cli-reference.md, docs/system/interactive-shell.md, docs/system/config-reference.md. Diff base fc15fea, HEAD fe577bf.

---

VERDICT: NEEDS CHANGES. A new round is forced. There are 3 behaviour-claim WARNINGs plus 1 contradiction-class WARNING, and 4 more wording WARNINGs. No BLOCKER, no banned dash, no delivery history, no pasted-in instruction.

Bound artifacts (SHA-256 of the files reviewed, HEAD of branch worktree-phase-03):
- docs/system/cli-reference.md b1a3072748e5984d6c02baa63ec10ad41582fddfbd3055335f960f042b8cb13d
- docs/system/interactive-shell.md e3a8c3a54f99b866e94ebffd6cbbdc0b8f8c21c11de8a61fa7bdf59279f80bed
- docs/system/config-reference.md b0d64f72f9f9d91800eaa398412a91a6e21647290133880429e8a90151fe2702

Severity key: BLOCKER = hard-rule violation or a claim the source contradicts or cannot support. WARNING = fix required by this gate. OBS = worth noting. Per your round rules, a WARNING about a code-behaviour claim forces a full new round. A wording-only WARNING needs one confirming round.

## Findings, most severe first

### W1. WARNING (behaviour, wrong). cli-reference.md, `contract amend`, argument table row `--add-write`. Also config-reference.md, "Limits that surface to an operator", row "Amendment".
- Claim: "the ten-glob cap" (cli-reference) and "at most ten added write globs" (config-reference).
- Evidence: `src/domain/amendment.ts:323` calls `amendWrite`, which checks `raw.length > BRIEF_LIMITS.listItems`. `BRIEF_LIMITS.listItems` is 128 (`src/domain/brief.ts:61`). The error text is "at most 128 globs". I found no 10-glob limit anywhere in the amendment path.
- Fix: say "at most 128 globs" in both documents.
- Confidence: high.

### W2. WARNING (behaviour, wrong). cli-reference.md, `start`, Side effects (line ~237).
- Claim: "writes the run, its first contract version, its budget rows and its single work item in one transaction".
- Evidence: `src/app/run-start.ts:256` writes `workItems: contract.intent.workItems.map(...)`, one row per item. The briefs allow up to 20 items (`BRIEF_LIMITS.items`). The same document prints one `item` line per work item and says so under Output. The file's own `start` Output section therefore contradicts "single".
- Fix: "its work items".
- Confidence: high.

### W3. WARNING (behaviour, wrong, internal contradiction). cli-reference.md, Quirks, bullet "The `avarice-run` skill names two owner commands, `contract amend` and `budget`."
- Evidence: `src/adapters/host-claude/avarice-run-skill.ts:37` names three: `avarice contract amend`, `avarice budget` and `avarice install-host`. The `install-host` section of the same document (line ~468) says "names `avarice contract amend`, `avarice budget` and `avarice install-host`", so the two passages disagree.
- Fix: "names three owner commands; `contract amend` and `install-host` are commands, `budget` is not, and dispatch treats it as an unknown command".
- Confidence: high.

### W4. WARNING (behaviour, wrong, stale). cli-reference.md, Quirks, bullet "`--json` on `onboard` ... The same holds for `--wait` on any command other than `start` and `resume`."
- Evidence: `--wait` is declared boolean for four commands: `start`, `resume`, `decide` and `cancel` (`src/cli/commands/decide.ts:54`, `cancel.ts:29`). The Argument parsing section of the same document says exactly that.
- Fix: "other than `start`, `resume`, `decide` and `cancel`".
- Confidence: high.

### W5. WARNING (behaviour, omission). cli-reference.md, `supervise`, Output and Exit.
- Evidence: `src/cli/commands/supervise.ts` ends with `notifyRunStop(...)`. When that fails it prints `avarice supervise: no notification raised for run <id>: <reason>` on stderr, with no effect on the exit code.
- The section's Output, Exit and Side effects do not list this line.
- Neither do the Streams bullet in the Summary and the Network bullet. The Network bullet says only `digest` and `schedule` run local tools. The supervisor's stop banner also runs `osascript` and is not mentioned.
- A reference document must be exhaustive.
- Fix: add the stderr line, and add a note that the supervisor may post a banner through `osascript` at a stop.
- Confidence: medium-high.

### W6. WARNING (behaviour, incomplete). cli-reference.md, `status`, the `notifications:` line (line ~288).
- Claim: the line is "`N delivered, N pending, N held, N failed (<code>)`", and the code is that of the latest delivery that did not arrive.
- Evidence: `src/cli/render/run-view.ts` `notificationsLine` appends `, last error <code>` when no banner has failed but a pending or held row carries an error (`notificationsOfRun` in `src/app/run-status.ts:248` takes any non-delivered row with an error). The documented form is incomplete.
- Fix: add "when a pending or held banner carries an error and none failed, the line ends `last error <code>`".
- Confidence: medium. It needs a retried-but-not-failed row, which the code allows.

### W7. WARNING (wording, structure). config-reference.md, "Notes and quirks", last two bullets (line 387).
- Quote: "...unlike an unknown flag on the command line.- The install proxy admits only port-443 targets...".
- Two bullets are glued with no newline, so Markdown renders one run-on bullet. The `notify` bullet and the install-proxy bullet need separate lines. This looks like an editing slip, not a content loss.
- Fix: put a line break before "- The install proxy".
- Confidence: high.

### W8. WARNING (wording, hard cap of 35 words).
These are prose sentences over the cap that were added or changed in this campaign. My counts include words inside inline code spans, so a few are borderline.
- cli-reference.md, by line:
  - 3: 50 words, the opening list of modules.
  - 53: 40.
  - 218: two sentences at 50 each.
  - 220: 46.
  - 254: 55.
  - 355: 37.
  - 396: 56.
  - 398: 67.
  - 402: 42.
  - 502: 36.
  - 504: 38.
  - 508: 36.
  - 524: 37.
  - 526: 62.
  - 555: 36.
  - 591: 37.
  - 623: 39.
- interactive-shell.md: line 86 (42).
- config-reference.md:
  - 3: 42.
  - 9: 42.
  - 39: 40.
  - 162: 38.
  - 163: 36.
  - 165: 40.
  - 386: 36.
- Not counted: `Exit:` lines and table rows. The review rule exempts reference lists, and I took those as lists.
- Fix: split each sentence. The worst are cli 398, 526, 396, 254, 218 and 220.
- Confidence: high on the cap, medium on the exact counts.

### W9. WARNING (wording, history narrative). cli-reference.md, `status` JSON section (line 336).
- Quote: "every key above them keeps its name, order and value. A reader of the earlier output ignores the added keys."
- This describes the previous output, which the hard rule forbids ("describe current behavior, never the previous behavior").
- Fix: state only the current guarantee, for example "`items`, `decisions` and `notifications` are always present; `cancelRequestedAt` and `checksNotRun` are optional and `checksNotRun` is the last key."
- Confidence: high.

### OBS
- O1. cli-reference.md, `decide`, Output and pick-up (line ~567). The `--wait` text gives exit 0 or 3, but `src/cli/commands/decide.ts` `startSupervisor` returns 70 when the wait ends in `error`. This is stated for `start` and `resume` but not here.
- O2. cli-reference.md, `start`, index notes. The code uses a pluralised form (`1 file`, `1 symbol`), and the doc shows "N files, M symbols". A minor shorthand.
- O3. cli-reference.md, `decide` pick-up table. The code also prints "a running supervisor continues the run" when the decision names no item, not only after a withdrawal.

## Behaviour claims checked (all against src at HEAD)

### Verified
- Dispatch, covering all of the following:
  - the fifteen command names and the unknown-command, not-available, cannot-load and no-`run()` rows
  - the shell gate (stdin and stdout TTY, `AVARICE_RUN` undefined) and its exit codes
  - the help forms
- The shared argument parser: `--` handling, last value wins, repeatable flags via `repeated`, and single-dash words as positionals.
- Boolean flags: `--json` for `status`, `inbox` and `context`; `--wait` for the four commands in W4.
- `identity.ts`: the three-check order, the data-root owner check, and which commands have a `usage` check. `onboard`, `resume` and `status` have none.
- `start`:
  - flags and their validation
  - all ten refusal codes
  - the order of checks
  - the exact stdout block, including the `index:` strings
  - `item` lines and the 4-entry cut
  - the `host:config-dir` step and its source labels
  - the `supervisor:spawn` step and the wait budget (wall clock plus 15 min, 250 ms poll)
  - the result-block rows
  - the exit codes
- `supervise`: the recorded-directory mismatch, exit 70 and message text.
- `resume`:
  - the stopped-state and blocked-decision pick-up
  - the host-directory refusal
  - the 24 h wait and the reconcile-failure exit 70
  - the `supervisor:resume` step
- `status` and `inbox`: the detail lines, item and decision lines, budget order, the interrupted rule (`isRunResumable` is the four states), the blocked reason list, key order and optional keys, the review rows, and the banner lines.
- `contract amend`:
  - the usage checks and error texts
  - the 500-character reason
  - the decision classes
  - the `+name` effect, which adds the command to the agent list (`amendChecks`)
  - preview lines, prompt and answers
  - the exit mapping, with `unavailable` conventions giving 70
- `decide`:
  - argument checks
  - the prompt format
  - the `amend` chain
  - the rejection, stale and duplicate texts and their exits
  - the pick-up lines and the `supervisor:decide` step
  - the 2000-character text rule
  - the host-directory refusal
  - the record renderer
- `cancel`:
  - the 4 to 64 character ID rule
  - the 200 ms poll and 24 h wait
  - the 60 s lease ceiling
  - the output lines
  - the exit codes
- `digest`: refusal inside a run, no terminal needed, the output line, the exit-70 stderr line, the error codes, the quiet-hours hold and nothing-to-say behaviour.
- `schedule`:
  - label and path
  - the 6-time cap
  - `plutil` and `launchctl` invocations
  - the bootout exits 3 and 113
  - the 64 KiB and 160-character cuts
  - the 10 s tool limit
  - the macOS-only refusal
  - the "any flag is a usage error" rule
- `install-host` and the skill text, apart from W3.
- interactive-shell.md: the eight menu items and their keys, the Decide action (columns, prompts, messages), line-mode key handling, the completion count of fifteen, the history menu-choice list, the `contract amend` prompt routing, and the second gate's message.
- config-reference.md:
  - the `AVARICE_*` read and constant counts (9 and 8, by grep of src)
  - the `notify` section (keys, defaults, limits, sorting and de-duplication, rejection of unknown keys, the 64 KiB and symlink-refusing read, once-at-start `osascriptPath`)
  - the `AVARICE_RUN` readers
  - the budget presets (120 min, `2n+1`, `400n`, `10n`, 10.0 USD, repair 1)
  - the retry and repair rule
  - banner limits (200 characters, delays 0, 10 and 60 s)
  - the admitted host versions including 2.1.319
  - the agent-command assignment rules and the plain-word pattern
  - the `NODE_TEST_CONTEXT` and `CLAUDE_CONFIG_DIR` supervisor overrides
  - the decision-list "recorded only" versus "yes" entries
- Every cross-reference anchor cited from the three documents resolves to a real heading (checked: autonomy-and-decisions `#quirks`, `#check-ins` and `#notification`; the containment, checks-and-evidence and runs anchors; and in-file `#decide` and `#contract-amend`).

### Wrong
- The four behaviour claims in W1 to W4.
- The two incomplete claims in W5 and W6.

### Unverifiable
- The unrun claim in interactive-shell.md Quirks, "How a terminal signal behaves outside that path was not run", is already marked as unverified in the document. I did not flag it.

## Deliberately not flagged
- Module paths and file names in each opening paragraph (allowed by the campaign rule). I grepped after the opening: the only later `src/` or `bin/` hits were system tool paths (`/usr/bin/plutil`, `/bin/launchctl`), which are documented behaviour and not repository paths.
- No em, en or spaced double-hyphen dashes in any of the three files (grep clean). No plan or phase IDs or threat IDs in prose.
- Headings are in sentence case, with no question headings.
- `Exit:` lines and table rows over 35 words, under the reference-list length carve-out.
- The old "Quirks" items about ledger opens creating profile directories, which are unchanged and still match `composition.ts`.

## Run hygiene
- Read-only claim proven: `git status --short` shows only `?? .planning/milestone.lock`, which was already in the starting snapshot. My scratch files were in `/tmp` and I removed them.

## Per-document verdicts
- docs/system/cli-reference.md: needs-changes (W2 to W6, W8 and W9, plus W1).
- docs/system/interactive-shell.md: pass-with-nits (only the one over-cap sentence at line 86 in W8; every behaviour claim verified).
- docs/system/config-reference.md: needs-changes (W1, W7, W8).
