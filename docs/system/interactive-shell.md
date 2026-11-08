# Interactive shell

Bare `avarice`, typed in a terminal, opens a full-screen menu over the runs and onboardings of the profile. The shell is a presentation layer: every action runs the same command the one-shot CLI runs, in the same process, and the shell re-reads the ledger for each view. This document describes the dispatch gate and the shell (`src/cli/main.ts`, `src/cli/shell/`), the shared text renderers it prints through (`src/cli/render/`) and the read-only event query it adds to the ledger (`src/adapters/sqlite/ledger.ts`). The flags, exit codes and output of the commands the shell runs are in [cli-reference.md](cli-reference.md). The run lifecycle and the interrupted state are in [runs.md](runs.md).

## When the shell opens

The shell opens when `avarice` has no arguments, standard input and standard output are both terminals, and `AVARICE_RUN` is unset. In every other no-argument case the dispatcher prints `avarice: no command given` and the usage text on stderr, and exits 64. That covers redirected input or output, and `AVARICE_RUN` set to any value, including an empty one. Standard error is not checked.

`TERM` takes no part in that decision. It only selects the input mode once the shell is open. The shell code loads only on this path, so no one-shot command pays for it.

A second refusal sits inside the shell. When `AVARICE_RUN` is set it prints `avarice: the interactive shell does not open inside a run (AVARICE_RUN is set)` and returns 64. The dispatcher is the only caller and has already checked the variable, so from the command line this message is never reached. It is wired as a second gate and does not run in practice. Inside a contained run, bare `avarice` therefore gets the usage text, and the shell cannot become a route to any command. Both gates prevent: the shell never opens.

## Two input modes

| Mode | Chosen when | Input | Output |
|---|---|---|---|
| Full screen | `TERM` is anything but `dumb`, including unset | Raw key presses | The alternate screen buffer, redrawn whole on every key and on resize |
| Line | `TERM` is `dumb` | Whole lines | Plain text with no escape characters |

Both modes feed one consumer interface, so the menu, the prompts and the live views are written once. On exit the shell turns raw mode off and returns to the main screen. Input that arrives while an action is working, or between two prompts, is queued and replayed in order, as a terminal does with type-ahead. End of input ends the shell with exit 0.

Colour is used only when standard output is a terminal, `NO_COLOR` is unset and `TERM` is not `dumb`. It marks the selected menu row in reverse video and prints the "store unavailable" line in red. Line mode never uses colour.

## What the shell shows

### Home view

The first screen, and the view the shell returns to after every action, shows the items below. With an unavailable store only the first two print, with no table and no decisions count.

1. `shell: <profile>`, the profile name.
2. `store: ok`, or `store: unavailable (<detail>)` when the ledger could not be opened or read. The detail names the failing query or error, is flattened to one line and is cut to 300 characters. An unavailable store does not close the shell.
3. A table with the columns KIND, ID, STATE, LAST CHECKPOINT and SPEND. Runs come first, in the status ordering (interrupted runs, then runs blocked on a decision, then the rest), then one row per onboarding. With no rows it prints `no runs or onboardings`.
4. `open decisions: N`, the sum of the open decisions of the listed runs.

The state column is the ledger's own word with its reason in parentheses, the same words `status` prints. A run that stopped while nobody holds its lease is presented as `paused` with the interruption reason. That is presentation only: the ledger state is unchanged (see [runs.md](runs.md)). An interrupted onboarding row shows its next action in the checkpoint column, and any other onboarding row shows `-`. The spend column is `used USD of limit USD` for the run's cost budget, and `-` when the run has none or the row is an onboarding.

The shell reads the ledger when it starts and again whenever an action ends. It holds no connection between reads, and it does not refresh the home view on a timer.

### Watch view

The watch view follows one run and is the only view that polls. It shows:

- the result line `run <id>: <state>` with its reason, and the run title;
- `continue with: avarice resume <id>` when the run is interrupted;
- `spend: ...` when the run has a cost budget;
- the latest four checkpoints, oldest first, each as `#seq next action (local time, relative time)`;
- the latest six events of the run, oldest first, each as `#seq type` followed by up to four scalar entries of the event data as `name=value`, each value cut to 28 characters. Nested objects and arrays in the event data are not shown, and an event whose data cannot be parsed shows no data.

The view reads the ledger again every second. No setting changes that interval. It ends by itself when the run is in `ready_for_review`, `blocked_on_decision`, `failed`, `cancelled` or `closed` and is not presented as interrupted. An interrupted run is watched on, because another terminal may resume it. The user ends the view with `q`, Escape, Ctrl-C or Ctrl-D (in line mode, `q` and Enter). The run is not touched: it keeps going, and the last frame stays on screen. The watch action accepts only a listed run ID. If a listed run vanishes between the listing and the read, the view ends at once with `run <id>: not found`. A failed read shows `store: unavailable (...)` and polling continues.

Table rows are cut to the terminal width with an ellipsis, but an ID or a state is never cut, so a narrow terminal makes a table overflow instead. The width is the stream's reported column count, or 100 when it reports none.

## Actions

The menu has seven items: six numbered and `q`. In full-screen mode the arrow keys move the selection and Enter activates it. A number, `:` or `q` activates its item directly. Ctrl-C or Ctrl-D at the menu quits.

| Key | Action | What it does |
|---|---|---|
| `1` | Start a run | Shows the policy `routine`, asks `brief path:`, and runs `start --brief <path> --policy routine`. An empty answer cancels. |
| `2` | Watch a run | Lists the runs of the profile (number, kind, ID, state, title), asks for a number or a listed ID, and opens the watch view. |
| `3` | Resume a run | Lists interrupted runs and interrupted onboardings, asks for a number or an ID, and runs `resume <id>`. |
| `4` | Status | Runs `status`. |
| `5` | Inbox | Runs `inbox`. |
| `6` or `:` | Command line | Asks `avarice> ` with history and completion, then runs the line as a command. |
| `q` | Quit | Leaves the shell with exit 0. |

Start passes no `--project`, no `--budget` and no `--wait`. The command spawns the detached supervisor and returns, the shell shows its output, and progress is followed with the watch action. Resume likewise returns once the supervisor is spawned.

Watch with no runs shows `no runs to watch`. Resume with nothing interrupted shows `nothing to resume: no interrupted run or onboarding`. An answer that matches no entry shows `no run matches "<entry>"` (watch) or `no run or onboarding matches "<entry>"` (resume). In resume, an ID that is not on the list but starts with `run_` or `onb_` goes to the resume command anyway, which checks it and says why it cannot be resumed. In watch, only a listed ID is accepted. A cancelled prompt (Escape, Ctrl-C or an empty answer) returns to the menu and runs nothing.

Every command the shell runs goes through the one-shot dispatcher, in this process, with its output captured and shown in the pane under the menu. The dispatcher receives the same overrides the shell received, except the terminal streams. A non-zero exit code is appended as `exit N`. A command that throws instead of returning shows `avarice <command>: failed: <message>` and `exit 70`. In full-screen mode, while it works, the screen shows `running <command> ...`. Line mode prints nothing until the command ends. The shell holds no child process and sends no signal to any process, so a supervisor started from the shell keeps running after the shell exits.

### The command line

The command-line action takes one line in the one-shot grammar without the program name, such as `status --json` or `resume run_123`. Words are split on whitespace. Single and double quotes group words and are dropped; there are no escapes, and an unterminated quote is an error that runs nothing. A leading `avarice` word is ignored. The words `quit` and `exit` alone leave the shell. An empty line runs nothing.

Line mode lists the same menu, including the command-line item. A line that is not a menu key (`1` to `6`, `:` or `q`, case-insensitive) is also taken as a command-line entry directly, without the prompt. A blank line redraws the menu.

Everything printed from a command, a ledger row or a model is stripped of the characters listed under [output style](cli-reference.md#output-style) before it is drawn. A recorded title that carries an escape sequence cannot rewrite the terminal. The strip prevents it at the display; it does not change what is stored.

## Line editing and completion

The prompt of the command-line action is an editor over key presses:

| Keys | Effect |
|---|---|
| Printable characters | Insert at the cursor. Pasted control characters and escape sequences are removed first. |
| Left, Right, Home, End, Ctrl-A, Ctrl-E | Move the cursor. |
| Backspace, Delete | Delete before or at the cursor. |
| Ctrl-U, Ctrl-K, Ctrl-W | Delete to the start of the line, to the end of the line, and the word before the cursor. |
| Up, Down | Recall earlier command lines, newest first. Down returns toward the line being typed, which is kept as a draft. |
| Tab | Complete the first word against the command names. |
| Enter | Submit. |
| Escape, Ctrl-C | Cancel. Ctrl-D cancels on an empty line and otherwise deletes the character at the cursor. |

Other Ctrl combinations are ignored. Completion works only on the first word, and only with the cursor at the end of the line. One match completes with a trailing space. Several matches extend to their common prefix and are listed above the line until the next key. Only the ten command names are offered, never flags or IDs. Line mode has no editing, history recall or completion beyond what the terminal gives.

## Command history

Each command-line entry that runs is recorded in `shell-history` in the data root, at the data root that [config-reference.md](config-reference.md) names. The file holds one entry per line, oldest first. It is created with mode 0600, and an existing file is tightened to 0600 on the next write, because a line can name a brief path or a run ID.

- An entry is stored with escape sequences and every control character removed, and trimmed. An entry empty after that is not stored.
- The cap is 1000 lines. A write that would pass the cap rewrites the file without its oldest lines through a temporary file in the same directory and renames it over the original, so a crash leaves the old file or the new one. A file longer than the cap is read as its last 1000 lines.
- The up arrow recalls the entries loaded at start plus those added in this session.
- Entries are not deduplicated, and a line is stored as typed, including a leading `avarice`.
- Only command-line entries are recorded. Menu choices (start, resume, status, inbox, watch) are not, and neither are `quit` and `exit`.
- History is a convenience. A missing, unreadable or unwritable file gives an empty history or a skipped entry and never stops the shell or reports an error. When the profile cannot be resolved at start, nothing is read or written.

## How the shell reads the ledger

Every view opens the ledger read-only, reads and closes it. The one ledger query added for the shell is the event listing: the latest N events of a run, returned oldest first, with no side effect. The shell asks for six. The other reads are the run row read of the watch view and the status, run-status and checkpoint reads that `status` and `inbox` already use. The shell never writes to the ledger itself; writes happen only inside the commands it runs.

## Shared renderers

The shell and the one-shot commands print through the same functions, so they use the same words. The shared forms are the result line (`subject: state (reason)`) and the error line (`avarice <command>: <message>`). They also include state words, money as `1.25 USD`, durations (`1 h 5 min`) and aligned tables. Local time has a relative form (`14:02, 3 min ago`, with the date first when not today). The status and run views are shared too. The functions are pure: callers pass in the time and the width, and the `--json` output never goes through them.

Tables follow fixed rules. They have a header row, columns in the order given, control characters removed from every cell, and each row cut to the width with an ellipsis. Columns holding a subject (an ID, a state) are never cut. A column marked to keep its text is cut only after the other columns are at their minimum of four characters. A repository path is cut from its start so its tail stays visible. Widths are counted in code points, which is exact for ASCII and Latin text and approximate for wide East Asian characters.

## Quirks

- The "read-only" ledger open is not purely a read. If the profile directories or the ledger file do not exist, opening creates them. If migrations are pending, the open applies them on a write connection and then reopens read-only. The shell can therefore create or migrate the ledger just by showing the home view.
- In full-screen mode the shell reads Ctrl-C as a key press and queues it while an action works. It reaches the menu or prompt only after the action ends. How a terminal signal behaves outside that path was not run.
- In line mode, typing `status` runs the command and is recorded in history, but typing `4` runs the same menu item and is not. A start made through the menu leaves no history entry, so the up arrow cannot recall it.
- `AVARICE_RUN` set to an empty string still counts as set and blocks the shell.
- Inside a run, the user sees the generic "no command given" message, not the shell's own refusal text.
