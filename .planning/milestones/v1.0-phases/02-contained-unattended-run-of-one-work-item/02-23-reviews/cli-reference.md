Reviewed: docs/system/cli-reference.md sha256 2f4294c1d56008daa836857ce6dee4d30040d5e06324c511806cc164747137b5 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 1 BLOCKER (inbox exit codes contradicted), 4 WARNING, 3 OBS. Digest reviewed 2f4294c1d56008daa836857ce6dee4d30040d5e06324c511806cc164747137b5 (matches dispatch; HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce).

BLOCKED: 1 BLOCKER (inbox exit codes contradicted), 4 WARNING, 3 OBS. Digest reviewed 2f4294c1d56008daa836857ce6dee4d30040d5e06324c511806cc164747137b5 (matches dispatch; HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce).

Severity: BLOCKER = cannot proceed; WARNING = fix, rework likely; OBS = worth noting. The gate is strict: PASS only with nothing above OBS.

## Findings

1. BLOCKER (confidence high). docs/system/cli-reference.md:86 "`status` and `inbox` return only 0 and 70."
   Contradicts the same document (line 83 table row 64 lists `inbox`; line 348 "Exit: 0, 64 for a positional, 70").
   Code: src/cli/commands/inbox.ts:14-16 returns a usage message for any positional; src/cli/main.ts:89-92 turns it into exit 64.
   Fix: "`status` returns only 0 and 70; `inbox` returns 0, 64 (a positional) and 70."

2. WARNING (confidence high). Line 63 "Placement is refused when a root lies under a `~/.claude*` directory or under `CLAUDE_CONFIG_DIR`, when roots are nested..." follows a bullet that lists three roots (config home, data root, work root).
   Code: src/domain/root-rules.ts:35-69 and src/adapters/fs/profile-paths.ts:69-74 judge only the data root and the work root; config home is never checked. A data or work root that would contain the home or Claude config directory is also refused (root-rules.ts:50-55), which the document does not say.
   Fix: name the data root and work root in the rule, add the "would contain" refusal, and state that config home is not checked.

3. WARNING (confidence high). Line 11 "every error and every warning goes to stderr."
   The document's own line 228 says the unreadable-run line of `start --wait` goes "on stdout" (exit 70).
   Code: src/cli/commands/start.ts:69-82 (renderWait returns an errorLine) and 141-142 (io.out); resume.ts:122 reuses it for `resume --wait`.
   Fix: add the exception to line 11 and list it under Quirks.

4. WARNING (confidence high). Line 125 "Otherwise a new project and onboarding are created."
   Code: src/app/stages/register.ts:59 calls registerProject, which returns the existing project for the same root commit and path (src/adapters/sqlite/ledger.ts:247-248). A repository whose earlier onboardings are all stopped gets a new onboarding on the existing project.
   Fix: "Otherwise a new onboarding is created, on the existing project when one is registered for this root commit and path, else on a new project."

5. WARNING (confidence high). Sentence cap of 35 words (code spans counted as one word; tables and fences excluded). Over the cap: line 52 (36 words), 163 (55, the onboard "Exit:" line), 182 (39), 339 (39), 383 (50, "With `--wait` the command polls ..."), 404 (51, "Human output: a header line ..."), 439 (37), 449 (37), 459 (36). The "Exit:" lines are running prose, not list items; with code spans counted by their words more exit lines run over (101, 421, 445).
   Fix: split at the semicolons or colons (163: one sentence per exit code; 383: the wait sentence and the reconcile-failure sentence; 404: header, item and fence sentences).

6. OBS (confidence medium). Line 311 `lastCheckpoint`: "The latest checkpoint that names an action ... Null when there is no checkpoint."
   Code: src/app/run-status.ts:85-91 falls back to the final `none` checkpoint when every checkpoint is `none`, so the value is null only with zero checkpoints and may hold a `none` action.
   Fix: add "else the latest checkpoint".

7. OBS (confidence medium). The opening (line 5) omits src/app/context.ts, src/app/onboarding-service.ts and src/app/run-resume.ts, from which the `context`, `onboard` and `resume` sections draw behavior (unknowns.md admits context.ts was not re-read).
   Fix: name them in the opening, or state that those sections defer to indexes-and-context.md, onboarding.md and runs.md.

8. OBS (confidence low). Line 86 "(see the unknowns)" carries no link; unknowns.md has the entry under "From cli-reference (run slice)". Fix: link [unknowns.md](unknowns.md).

## Checked and not flagged
- Digest; banned dashes (none); prose free of source paths, function names, phase, plan and threat IDs and home paths (paths only in the opening); sentence-case headings; Quirks section present; cross-links resolve (containment, runs, interactive-shell, config-reference, onboarding, indexes-and-context).
- Command list (main.ts:12), dispatch rows and messages (main.ts:49-102), shell dispatch and AVARICE_RUN refusal (main.ts:55-62, shell.ts:532), parser rules (args.ts), boolean flags per command, and every flag of init, repo, onboard, start, supervise, status, inbox, resume, context, install-host.
- Exit codes per command against each command file; the ten start refusal codes, the 25-commit and 14-day limits and the check order (run-preflight.ts, run-start.ts); brief limit 64 KiB; start summary block; wait table and stop states (spawn-supervisor.ts, run-lifecycle.ts:109); 250 ms poll, wall clock + 15 min, 24 h bounds; spawn conditions and environment.
- status and inbox JSON fields, ordering and text forms (run-status.ts, status.ts, status-view.ts, run-view.ts, style.ts, table.ts); install-host rules and skill text (skill-install.ts, avarice-run-skill.ts); profile modes 0700 and 0600; lease 180 s with ttl/3 renewal; repo add list cap 1000 (preflight.ts:55).
- The context section was checked only for constants and selection (src/app/context.ts, outside the packet list). No command was executed.
- Containment: the document makes no enforcement claim beyond routing to containment.md; the skill is stated advisory.
- No embedded instructions in the document.

## Version-control status after the run (porcelain)
?? .planning/config.json
?? .planning/milestone.lock
(both present in the starting snapshot; nothing of mine changed)

## Answers

Applied: the BLOCKER (`inbox` returns 0, 64 and 70) and findings 2 to 5 and OBS 6 to 8. The stdout line of a wait that cannot read the run is now an exception in the streams rule and a Quirks entry. Sentence cap: every over-cap sentence of the running prose was split; the long "Exit:" lines that remain are lists of exit codes, one clause per code.
