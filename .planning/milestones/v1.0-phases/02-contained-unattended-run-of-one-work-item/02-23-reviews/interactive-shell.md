Reviewed: docs/system/interactive-shell.md sha256 02a7dda355b4335e724570cd4f12bc455fbc557c6ae7db16bb6a22d75c57133e at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 5 WARNING findings (one false statement about line mode, one over-cap sentence, one unverified runtime claim, two imprecise behavior claims) plus 6 OBS. No BLOCKER.

BLOCKED: 5 WARNING findings (one false statement about line mode, one over-cap sentence, one unverified runtime claim, two imprecise behavior claims) plus 6 OBS. No BLOCKER.

Digest reviewed: 02a7dda355b4335e724570cd4f12bc455fbc557c6ae7db16bb6a22d75c57133e (matches dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.
Severity: BLOCKER = cannot proceed; WARNING = fix, and blocks under this gate; OBS = worth noting.

## Findings

1. WARNING (high). Line 79: "Line mode has no separate command-line item." False against the code: the line-mode menu prints every action, including `6  Command line` (src/cli/shell/shell.ts paintMenu maps this.actions), and typing `6` or `:` opens the `avarice> ` prompt (src/cli/shell/actions.ts commandLine, keys ['6', ':']; shell.ts prompt() writes the label in line mode). What is true: a non-menu line is also taken directly as a command. Fix: "Line mode lists the same menu. A line that is not a menu key ... is also taken as a command-line entry directly, without the prompt."
2. WARNING (high). Line 117, 50 words in running prose (cap 35): "These are the result line (...), ... and the status and run views." Fix: make it a bullet list or split into two sentences.
3. WARNING (medium). Line 124: "Ctrl-C arrives as a key, not as a signal". Stated as fact, but unknowns.md:109 records that signal behavior was not run and says "The document states only the queueing and the key path". The code proves only the key path (shell.ts start(): setRawMode(true), keypress handler; run()/command() set consumer null so input queues). Fix: "In full-screen mode the shell reads Ctrl-C as a key press and queues it while an action works, so it reaches the menu or prompt only after the action ends." Drop "not as a signal" and "does not interrupt a running command", or record them as unverified.
4. WARNING (high). Line 73: "While it works, the screen shows `running <command> ...`." Only full-screen mode does this (shell.ts command(): `if (this.full) { this.output = 'running ...' ... }`); line mode prints nothing until the command ends. Fix: "In full-screen mode, while it works, ...".
5. WARNING (high). Line 51: "A run ID that does not exist ends the view at once with `run <id>: not found`." The watch action accepts only a listed ID (actions.ts pick(); doc line 71 says so), so a nonexistent ID cannot be entered. The result appears only when a listed run vanishes between listing and read (actions.ts readWatch returns undefined; watchFrame sets done:true). Fix: say that, or drop the sentence.
6. OBS (high). Line 51: the view also ends on Ctrl-D (shell.ts live() key handler accepts `c` or `d` with ctrl); the doc lists "`q`, Escape or Ctrl-C".
7. OBS (high). Line 113: "The other reads are the status, run-status and checkpoint reads that `status` and `inbox` already use." The watch view also reads the run row (getRun, actions.ts readWatch), which status does not use (src/cli/commands/status.ts calls getStatus only). Add the run row read.
8. OBS (medium). Line 81: "stripped of escape sequences and control characters". stripControl keeps newline and tab (src/cli/render/style.ts CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/); tables flatten them separately (table.ts cleaned). Say "control characters other than newline and tab".
9. OBS (medium). Lines 30-35: the home view is described as always four items; with an unavailable store only `shell: <profile>` and the store line print, no table and no decisions count (src/cli/shell/home-view.ts renderHome early return). Make the list conditional.
10. OBS (medium). Line 102: repeats the default data root `~/.local/share/avarice/personal-local`; config-reference.md owns it (one fact, one home). Code agrees (src/adapters/fs/profile-paths.ts:63). Link rather than restate.
11. OBS (low). The output pane is cut to the terminal rows with an "... N earlier lines" note (shell.ts outputLines); not described. Optional.

## Checked and deliberately not flagged
- Dispatch gate (src/cli/main.ts:55-57, shell.ts runShell): stdin and stdout TTY, AVARICE_RUN undefined; empty string counts as set; stderr unchecked; exit 64; message `avarice: no command given`; shell lazy-loaded. Inner refusal text and unreachability correct, consistent with findings.md:212. AVARICE_RUN is set for contained runs (src/adapters/host-claude/env.ts:44). Prevention label correct; no enforcement overclaim.
- Two modes, colour rules (style.ts colourEnabled; reverse video; red unavailable line), queueing, EOF exit 0, raw mode off and screen restore.
- Home view columns, ordering (src/app/run-status.ts:206), 300-character detail cut, paused presentation, onboarding checkpoint column, spend format.
- Watch: four checkpoints, six events, four scalar entries, 28-character cut, unparseable data shows none (ledger.ts toRunEvent), 1 s poll, stop states (src/domain/run-lifecycle.ts:109), interrupted run watched on, width fallback 100.
- Menu: seven items, keys, Ctrl-C/D quit, resume and watch pick rules, messages, `exit N`, exit 70, same overrides minus terminal streams, no signals sent.
- Command-line grammar (splitWords, `avarice` prefix, quit/exit), line editor keys, completion rules, ten commands (COMMANDS in main.ts; coverage.md 10 of 10; 7 actions matches 7 of 7).
- History: 0600, tighten on write, atomic rewrite, cap 1000, read last 1000, control stripping, no dedup, only command-line entries, silent failure, nothing read or written when profile unresolved.
- Event query read-only, oldest first; quirk 1 verified (src/cli/composition.ts:151-177 migrates then reopens read-only; profile-paths.ts:88 mkdir). Quirks 3-5 verified. Renderer rules (table.ts MIN_CUT_WIDTH 4, subject never cut, start-cut path, code points).
- Mechanics: no em dash, en dash or " -- "; sentence-case headings; no phase/plan IDs, line numbers or function names in prose; modules named once in the opening (line 5, exempt); no secrets or absolute home paths (`~` form only); links resolve; listed in README.md (23, 48, 50) and coverage.md (46, 69); quirks section present. Sentences of 30+ words: line 49 (32, list), 71 (32), 105 (39, list item, exempt), 117 (50, finding 2). No embedded instructions in the document. No ADR text copied.

## git status --porcelain (after run)
?? .planning/config.json
?? .planning/milestone.lock
(both present in the session-start snapshot; this run modified no repository file)

## Answers

Applied: findings 1 to 5 and OBS 6 to 10. OBS 11 (the output pane is cut to the terminal rows) is left as is; it is a display detail with no contract.
