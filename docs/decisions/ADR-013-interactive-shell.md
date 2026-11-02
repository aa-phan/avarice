# ADR-013: Open an interactive shell when `avarice` runs with no arguments

| | |
|---|---|
| **Status** | Proposed; adds FR-27 ([integration](../requirements.md#integration)) and OPS-7 ([operability](../requirements.md#operability)) through requirements.md |
| **Date** | 2026-11-02 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) is a set of one-shot commands. Each `avarice <command>` prints its result and exits with a code from the table in [extensions.md](../extensions.md#1-avarice-cli-and-library-mvp). Work that outlives a command runs in a separate `avarice supervise` process, and there is no permanent daemon ([architecture.md](../architecture.md#process-view)). Today `avarice` with no arguments prints usage and exits 64, and `avarice --help` prints usage and exits 0 (`src/cli/main.ts`).

The commands available today are `init`, `repo`, `onboard`, `status`, `resume` and `context` (the `COMMANDS` allowlist in `src/cli/main.ts`). The documents plan more: `start`, `inbox` and `decide` for an unattended run and its decisions ([architecture.md](../architecture.md#process-view), [autonomy-and-decisions.md](../autonomy-and-decisions.md)). One work item then involves several separate commands, with `status` rerun by hand to follow progress. The user wants one entry point: type the bare command, then act and watch running work from inside it. `claude` and `mo` work this way: `claude --help` (Claude Code 2.1.316) says Claude Code "starts an interactive session by default", and `mo --help` (Mole 1.61.0) lists bare `mo` as "Main menu".

Five constraints bound any answer:

- `contract amend` requires an interactive terminal and refuses when the `AVARICE_RUN` marker is set (CS-11 in [operations-and-testing.md](../operations-and-testing.md), [containment.md](../containment.md)). `approve` requires an interactive terminal ([enterprise-adaptation.md](../enterprise-adaptation.md)). `decide` takes a response from an interactive terminal or from a configured reply channel that authenticates the user.
- A decision response passes identity, open-state and state-digest checks before it applies ([autonomy-and-decisions.md](../autonomy-and-decisions.md#responses)).
- `package.json` declares no runtime dependencies, and `test/unit/footprint.test.ts` fails the build if one appears (NFR-1, [ADR-001](ADR-001-language-and-runtime.md)).
- The [non-goals](../requirements.md#non-goals) exclude a dashboard that needs a server or a listening port in the MVP, and FR-26 states the same constraint. The dashboard is read-only ([ADR-011](ADR-011-static-dashboard.md)).
- A contained invocation's Bash allow list does not include `avarice` ([containment.md](../containment.md)).

## Decision

1. `avarice` with no arguments opens the interactive shell when standard input and standard output are both terminals and `AVARICE_RUN` is unset. In every other case it keeps today's behavior: usage on standard error, exit 64. `avarice <command>` stays a one-shot command in every case, including when the shell is open in another terminal.
2. The shell opens on a home view of the profile: store health, runs and onboardings with their state and last checkpoint, the number of open decisions, and spend against budget. Below the home view, an action menu takes arrow keys or a number, and a command line takes the one-shot grammar without the `avarice` prefix (`status --json`, `resume onb_123`). The command line completes command names from the `COMMANDS` allowlist and keeps history in the profile data root with mode `0600`.
3. The shell is a presentation layer under `src/cli/shell/`. Each action calls the same command module the one-shot CLI calls, in the same process, and re-reads the ledger for every action. The shell keeps no state of its own beyond the current view and the history file. A ledger read failure shows the failing query in the view and leaves the shell open. The `app` and `domain` layers do not change for it.
4. Work started from the shell runs in `avarice supervise`, through the same commands that start it on the one-shot path ([process view](../architecture.md#process-view)). The shell starts it detached from its own process. The shell shows progress by reading the ledger's events and checkpoints on a fixed interval of about one second. It opens no socket and uses no other channel to the supervisor. Leaving the shell sends no signal to any supervisor, so runs continue after it exits.
5. `decide`, `approve` and `contract amend` run the same checks inside the shell as on the one-shot path, including their own terminal and marker checks. The shell's own refusal under `AVARICE_RUN` keeps every command it offers out of reach of a run. Before applying any of the three, the shell shows what it is about to apply and asks for an explicit confirmation; for `decide` it also shows the decision's state digest.
6. The shell uses Node built-ins only: `node:readline`, raw-mode key input and ANSI escape sequences. It honors `NO_COLOR`, redraws on terminal resize, and falls back to a line-mode prompt without full-screen redraw when `TERM` is `dumb`. The shell and the one-shot commands render human-readable text through the same functions, in the style that OPS-7 defines.
7. The dashboard stays read-only. ADR-011 is unchanged.

## Consequences

**Positive:**
- One entry point for the whole workflow, and live progress of a run without rerunning `status`.
- Scripts, tests and agents see no change: every one-shot command keeps its output, its `--json` shape and its exit codes.
- The containment boundary is unchanged. The shell refuses under `AVARICE_RUN`, a non-terminal invocation such as a Bash tool call prints usage, and `avarice` stays outside every contained allow list.

**Negative:**
- The shell is a second presentation surface beside the one-shot commands, and every new command needs an entry in its menu or command line.
- Without a terminal UI library, full-screen rendering, key handling and resize are hand-written code. Tests drive the shell through an injected input stream and output sink, because Node has no built-in pseudo-terminal. Rendering defects in a real terminal surface only in a manual check.
- Progress in the shell lags the ledger by up to one polling interval, and every interval costs one set of ledger reads while the shell is open.
- A second way to answer a decision is a second place where the confirmation step can regress, so the decision tests run against both paths.

**Neutral:** `avarice` with no arguments exits 64 only outside a terminal or inside a run. In a terminal it no longer exits 64.

## Alternatives considered

**One-shot commands only** - For: the least code, and one rendering path. Against: every action is a typed command, and following a run means rerunning `status`. Why not chosen: it does not meet the user's need for one entry point with live progress.

**Full-screen UI on a terminal library such as `ink` or `blessed`** - For: tested widgets, layout and key handling. Against: a runtime dependency, which the footprint test and NFR-1 forbid. Why not chosen: the shell's needs, a menu, a prompt, tables and a progress view, fit Node built-ins.

**Turn the dashboard into a controller** - For: clickable tables, graphs and links to evidence in a browser. Against: writing to the ledger from a page needs a local server with a listening port, which the non-goals and FR-26 exclude from the MVP. Answering decisions from a page would also need its own authentication. Why not chosen: it conflicts with ADR-011 decision 2 and with the non-goal on served dashboards. A served dashboard remains possible under ADR-010's local-services rules.

**A `status --watch` view without actions** - For: small, and gives live progress. Against: every action still needs a separate command in another terminal. Why not chosen: it covers half of the need.

## Revisit when

- Hand-written rendering cannot keep up with the views that the decision inbox and draft pull request delivery need, which would justify a dependency decision against NFR-1.
- ADR-010's local services or the coordination service exist, which makes a served controller worth comparing again.
- Polling once per second costs measurable time on a store with 1,000 runs, the store size AC-15 uses.

## References

- [ADR-011](ADR-011-static-dashboard.md), whose alternatives rejected a terminal UI as the overview page, not as a command surface
- [ADR-010](ADR-010-serverless-baseline-local-services.md) for the conditions under which a served dashboard could follow
- `src/cli/main.ts` for the `COMMANDS` allowlist and the current no-argument behavior
- `test/unit/footprint.test.ts` for the no-runtime-dependency assertion
