# Round 1, group E: fresh prose review (verbatim report)

Reviewer: fresh technical-writer:prose-reviewer, spawned by the orchestrator. It was given only the documents, the code and the house rules.
Documents: docs/system/integrations.md, docs/system/overview.md, docs/system/README.md. Diff base fc15fea, working tree at HEAD fe577bf.

---

VERDICT: BLOCKED. Six behaviour-claim WARNINGs (one in overview.md, five in integrations.md) force a fix and a full new round. No BLOCKERs. README.md has only a wording-level WARNING.

Digests reviewed (working tree at HEAD fe577bf; no digest was supplied):
- docs/system/integrations.md d41fea655e0f75fa75f653740fd7bbe6ea7aeb484d24a3ac18de6229a0adf750
- docs/system/overview.md c110439fd5125c90e7423a2b2053f50823e38b7abac1017b4862731bd7a9bd1f
- docs/system/README.md 5da0c17cb4dbc16c9f866685b75c25a00cfbbae7db159f7eed0c21d246ca770e

Severity key: BLOCKER = cannot proceed; WARNING = likely rework; OBS = worth noting. Under the campaign rule, a code-behaviour WARNING is treated as blocking, the same as a BLOCKER. A wording-only WARNING is fixed and checked by one more round. Paths are relative to /Users/aphan/avarice/.claude/worktrees/phase-03.

## Findings

### W1. WARNING (behaviour, wrong): overview.md, "Layers and the import rule", line 26
- Claim: "At the commit counted in coverage.md it passes over 79 files."
- Evidence:
  - `node scripts/check-boundaries.ts` prints `check-boundaries: ok (99 file(s))`.
  - docs/system/coverage.md:33 records 99.
  - The campaign did not touch the line, so it is stale.
- Fix: write 99, or drop the number and point to coverage.md, which owns the count.
- Confidence: high.

### W2. WARNING (behaviour, wrong and incomplete): integrations.md, "Detached supervisor", lines 305 and 307
- Claim 1: "`start` and `resume` spawn the Node binary ...".
  - `decide` also spawns the supervisor (src/cli/commands/decide.ts:96).
  - overview.md says "`start`, `decide` and `resume`", so the two documents disagree.
- Claim 2: "Its environment is the parent's whole environment plus the three profile roots ..., with the test-runner marker removed."
  - supervisorEnv (src/cli/spawn-supervisor.ts:52-62) also overwrites `CLAUDE_CONFIG_DIR` with the directory the run recorded at start.
  - The Quirks line "The supervisor inherits the user's whole environment" (line 416) shares the gap.
- Fix: name `decide`, add the `CLAUDE_CONFIG_DIR` override, and link runs.md#the-detached-supervisor, which owns it. Line 90 already cites that anchor.
- Confidence: high.

### W3. WARNING (behaviour, wrong): integrations.md, "Agent definitions", line 107
- Claim: "One sentence is appended to the body of `gsd-executor` wherever it is loaded ... Only the run purpose loads it."
- Evidence (src/adapters/gsd/agents-json.ts):
  - `closing[]` appends the run shell-rules addendum (AVARICE_RUN_SHELL_ADDENDUM) to all four run agents: planner, plan-checker, executor and verifier.
  - It appends AVARICE_EXECUTOR_ADDENDUM to the executor.
  - It appends AVARICE_VERIFIER_ADDENDUM to `gsd-verifier`.
  - So the executor gets two notes and the verifier gets two. "One sentence" is wrong.
- Fix: describe the three closing notes by agent. The doc already says the executor note is guidance only and that the hook is the enforcement.
- Confidence: high.

### W4. WARNING (behaviour, wrong): integrations.md, "Outcome classification", line 126
- Claim: "A pause only ever blocks the run on a decision."
- Evidence:
  - src/app/run-stages/item.ts:1092-1094 and 1136-1142: a paused unit goes through `blockThisItem`, which blocks that item. The run goes on with independent items.
  - src/domain/outcome.ts:112 still says "A pause only ever blocks (it routes to a decision)", which is also true. The "blocks the run" wording is the stale part.
- Fix: "A pause routes the item to a decision; the run continues with items it does not touch (runs.md)."
- Confidence: high.

### W5. WARNING (behaviour, omission from a closed list): integrations.md, "git" group table, "Run workspace" row (line 264), and the "Run workspace" bullets (lines 274-280)
- Claim: the row and bullets present the run workspace's complete git surface.
- Evidence: src/adapters/git/run-workspace.ts has new park, unpark and dropPark methods. They use:
  - `commit-tree` and `update-ref` (create and delete) on `refs/avarice/park/<runId>/<itemId>` in the run clone;
  - `ls-tree -z` over named paths, in batches;
  - `restore --source=<park tree> --worktree`;
  - `rev-parse --verify --quiet <ref>^{commit}`;
  - `log -1 --format=%T %P`.
  None of these is named, and the bullets omit park, unpark and drop-park entirely.
- Fix:
  - Add the park operations, with the ref namespace and the fact that they write only inside the run clone, or link to the runs.md section that owns them.
  - Add the missing commands to the table row.
- Confidence: high on the omission. Whether this doc or runs.md owns the prose is arguable.

### W6. WARNING (behaviour, omission): integrations.md, "Ledger port", line 63
- Claim: "The ledger port also carries the run operations: runs and their lease, checkpoints, contracts, steps, attempts, evidence, gate results, work items, decisions, check validations, run events and the hook's read-before-edit rows."
- Evidence: src/ports/ledger.ts now also has these operations, so notification rows and the cancel request are missing from the list:
  - createNotification, recordNotificationAttempt, setNotificationState and listNotifications;
  - requestRunCancel;
  - amendRunContract;
  - the decision re-open, withdraw and answer operations.
- Fix: add "notifications" and "the cancel request", or reword to "among them".
- Confidence: high.

### W7. WARNING (wording-only): sentences over the 35-word hard cap, introduced or edited in this campaign
Counts exclude links and bold.
- integrations.md:90: two sentences, of 38 and 37 words. They begin "The host looks for a session only in the configuration directory ..." and "A session the host does not know ends as an error result ...".
- integrations.md:342: 45 words, "A banner tells the owner that something waits, and it carries no answer: ...".
- integrations.md:358: 42 words, "It writes one user LaunchAgent, ...".
- integrations.md:31: 42 words. A spawn-site list that this campaign edited; convert it to a list.
- overview.md:40: two sentences, of 38 and 44 words. They begin "The command measures who is asking ..." and "The composition fills that port with the `osascript` adapter ...".
- README.md:3: 59 words, the opening sentence. Split it.
- Not flagged, listed only so the coverage is visible:
  - The long sentences at overview.md:5 and integrations.md:138 and 332 come from the previous text.
  - 138 and 332 are list items.
  - Line 5 was edited only upstream of its long sentence.
- Confidence: high.

### W8. WARNING (wording, one fact one home): integrations.md, "osascript", line 354, and the failure-table row at line 404
- Line 342 says autonomy-and-decisions.md "owns when a banner is raised and how a failure is retried".
- Line 354 then restates the 0 / 10 / 60 second retry schedule and the three owner-visible places. autonomy-and-decisions.md:102 also states the schedule.
- Fix: keep the code table and the adapter facts here, and link the retry and visibility rules to autonomy-and-decisions.md#notification.
- Confidence: medium.

### OBS
- O1. integrations.md:342, "The port is defined so that a push adapter could implement it later." This is design intent with no source; the descriptor only shows `push: false`. Cut it or mark it as intent.
- O2. integrations.md:35 and 412. The notifier has a descriptor (`local-osascript`) that composition never records. The "three run ports" wording is correct, but the quirk could note that the notifier is unrecorded too.
- O3. integrations.md, "osascript". If the profile config is unreadable or invalid, composition silently falls back to `/usr/bin/osascript` (src/cli/composition.ts:290). The doc says only that the path "comes from the profile config".
- O4. integrations.md and overview.md. coverage.md lists both as `drafted`. README.md:9 says drafted documents carry a "drafted, not yet reviewed" mark under the title, but neither has one (autonomy-and-decisions.md does). Either add the mark or reword README.md:9.
- O5. integrations.md:77, the Glob/Grep claim. That the admitted host drops those tools unless a launch flag names them rests on a code comment (src/adapters/host-claude/launch-args.ts:29-32) and cannot be checked offline. The settings-allow half is verified in code. Label the vendor behaviour as observed.

## Behaviour claims checked

Verified against src:
- integrations.md:
  - Admitted versions 2.1.312, 2.1.316, 2.1.317, 2.1.318 and 2.1.319 (launch-preflight.ts:24).
  - `--allowedTools Glob,Grep` on the launch line (launch-args.ts:55).
  - The `--resume` / `--session-id` swap (launch-args.ts:65).
  - The `--allowedTools` refusal rules: the `=` form, another value, a second occurrence and `--allowed-tools` are all refused (launch-args.ts:128-130).
  - The reap pgrep pattern `--(session-id|resume) <uuid>`, with a 10 s timeout (claude-host.ts:387), and `ps -o pgid=`.
  - The stream-json final-text tail: 2000 characters, control characters stripped, and it feeds only the pause question (stream-json.ts:76-96; claude-host.ts, `question`).
  - A resumed session the host does not know is read as a gone session and answered with a fresh unit (item.ts:303, 1160).
  - Spawn sites: a full sweep of src finds exactly these, and no `gh` is spawned:
    - sandbox-exec, git, claude;
    - node (gsd identity, hook self-test, supervisor);
    - pgrep;
    - ps, also used by the ancestry reader;
    - mount, osascript, launchctl, plutil.
  - The ports directory holds 13 files: 12 ports plus the capability descriptor.
  - The notifier:
    - is built only when the composition is not read-only;
    - can be replaced by a test seam;
    - has its path read once at composition (composition.ts:285-292).
    The test-only adapters match.
  - osascript:
    - fixed three `-e` lines, with body and title after `--`;
    - 10 s timeout and SIGKILL;
    - inherited environment;
    - default path `/usr/bin/osascript`;
    - codes `osascript-missing`, `osascript-timeout` and `osascript-failed`, plus the `notifier-error` fallback;
    - backoff 0 / 10 / 60 s;
    - banner body at most 200 characters.
  - The `status` line `notifications: N failed (<code>)` (run-view.ts:82-90).
  - The `inbox` line `banner not delivered (<code>); this list is the record` (run-view.ts:188).
  - `digest` exits 70 with the code on stderr.
  - launchd:
    - plutil `-lint` before the rename (launchd.ts:257);
    - launchctl `bootstrap` and `bootout` on `gui/<uid>`, with a 10 s limit and a 160-character cut of the tool's error;
    - bootout exit 3 or 113 tolerated, in remove only;
    - a first-install bootstrap failure removes the file, and a replacement bootstrap failure leaves it unloaded;
    - the marker line, no symlinks, and the agents directory created only when absent;
    - no RunAtLoad or KeepAlive in the plist template;
    - the log at `logs/digest.log` in the data root;
    - the plist starts `node <entry> digest`;
    - exit 70 on an internal error.
  - An owner command that cannot read the process chain refuses (ancestry.ts `inRunProcessTree` returns true on an unreadable chain).
- overview.md:
  - Fifteen commands (main.ts:17).
  - The four owner commands that refuse inside a run are contract, decide, cancel and schedule (each calls refuseOutsideTerminal).
  - Twelve ports. The LaunchAgent writer and the ancestry reader belong to no port.
  - The answer, amend and cancel services are reached only from CLI commands; cancel also runs from the supervisor under the lease (run-service.ts:18).
  - The footprint test holds these claims: only the proxy imports a network module or listens, and only the supervisor spawn and two adapters detach.
  - Schedule writes under `~/Library/LaunchAgents`.

Wrong:
- the 79-file count (W1);
- "`start` and `resume`" and the supervisor environment (W2);
- the executor-only addendum (W3);
- "pause blocks the run" (W4);
- the closed lists in W5 and W6.

Unverifiable here:
- the host vendor's behaviour (the Glob/Grep removal, O5);
- macOS `launchctl` and `plutil` behaviour beyond what the adapter does with their exit codes, because this host was not a launchd machine under test.

## README.md structure checks (all pass)
- Every `docs/system/*.md` except README.md and coverage.md has a row in the documents table. The rows are autonomy-and-decisions, checks-and-evidence, cli-reference, config-reference, containment, data-model, history, indexes-and-context, integrations, interactive-shell, onboarding, overview, processes, runs, findings and unknowns, and coverage is listed too. The new autonomy-and-decisions row is present.
- Every proposal document in docs/ appears in the counterparts table.
- Every link resolves, `diagrams/` included.
- The autonomy-and-decisions counterpart row now lists autonomy-and-decisions.md, runs.md, cli-reference.md (decide, digest, schedule and cancel have sections) and config-reference.md (the notify keys). All are accurate.
- ADR-006 is still `Proposed`, as the row says.
- The processes.md "eight flows" count is right.

## Mechanical sweep
- No em dash, en dash or ` -- ` in any of the three files.
- No delivery history (phase, plan ID, threat ID) in the prose.
- Source paths appear only in the openings.
- Headings are in sentence case.
- No changelog or "last updated" text.
- A banned-construction scan of the new osascript and launchctl sections found nothing to fix beyond O1.

## Read-only proof
`git status --short` shows only `?? .planning/milestone.lock`, which was in the starting status. I edited nothing.

## Per document
- docs/system/integrations.md: needs-changes (W2 to W6 behaviour; W7 and W8 wording).
- docs/system/overview.md: needs-changes (W1 behaviour; W7 wording).
- docs/system/README.md: pass-with-nits (only the 59-word opening sentence in W7; the tables are complete and accurate).
