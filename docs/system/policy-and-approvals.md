# Policy and approvals

*drafted, not yet reviewed*

A privileged action never starts on the agent's say-so. Policy can deny it outright, and otherwise only the owner at a terminal can approve it. This document describes that subsystem as implemented in the approval gate, the approve command, the approval rules and the action table (`src/app/authorize.ts`, `src/cli/commands/approve.ts`, `src/domain/approval.ts`, `src/domain/action-class.ts`). Policy evaluation and the files behind it are in `src/domain/policy.ts` and `src/adapters/fs/policy-sources.ts`. The shell forms that count as privileged are in `src/domain/privileged-commands.ts`, and the hook that refuses them is `src/hook/pre-tool-use.ts`, installed into the owner's own host sessions by `src/adapters/host-claude/attended-hook-install.ts`. The enforcement map is `src/domain/enforcement-map.ts`, and the manual equivalents are `src/app/manual-inputs.ts` with the commands that call them. The approval rows and their guards are in `src/adapters/sqlite/ledger.ts`, `src/adapters/sqlite/approval-rows.ts` and the fourth migration.

An approval authorizes one action with exactly the parameters it was granted for, once, within 30 minutes. A decision answer, a plan, a contract amendment, a deadline and silence approve nothing. The approval flow is drawn in [approve-privileged-action.puml](diagrams/approve-privileged-action.puml). The tables are in [data-model.md](data-model.md), the profile keys in [profiles-and-credentials.md](profiles-and-credentials.md) and [config-reference.md](config-reference.md), and the command flags and exit codes in [cli-reference.md](cli-reference.md).

## Approvals

An approval has a request, a grant, at most one consumption and an end by expiry or revocation. Each step is a ledger transaction under the profile's store.

**Request.** A request is an event, not a row. The gate or the hook writes `approval.requested` with a request ID (`apr_` and 26 characters), the scope, the action, the parameter digest, a bounded summary of the parameters and the rule that asked for approval. The scope is the run ID, the onboarding ID, or `attended:` and the host session ID for the owner's own session. A retry of the same action with the same parameters names the request that is still waiting and writes no second one. A request stops waiting when an approval answers it.

**Parameters and digest.** The digest is SHA-256 of the canonical JSON of the parameters: keys sorted, no whitespace, so key order never changes it and any changed value does. Parameters with no canonical form, such as a number that is not finite, cannot be approved. The summary shown to the owner lists the parameters as `key=value` in key order, each value cut to 80 characters and the whole to 400, with control characters replaced. The digest is what the approval binds. The summary is for the owner's eyes and is redacted when the event is written.

**Grant.** `avarice approve` takes a request ID, shows the action, the scope, the summary, the digest and the grant it would make, and asks. Only a yes grants. Anything else exits 0 and writes nothing. A grant inserts one approval row (`apv_` and 26 characters) with the request's scope, action and digest, source `local-user`, the granter `owner:` and the operating system user name, and an expiry 30 minutes after the grant. A request is granted once: a second grant of the same request exits 3. An approval cannot be deleted, and its consumption and revocation times are set once and never changed, which database triggers enforce.

**Who may grant.** The command refuses inside a run, without a terminal on both standard input and output, and from the process tree of a run. Those refusals happen before the profile is resolved, so a refusal creates nothing. It then refuses a profile whose data root another user owns. The rule is the one `decide` uses and is described in [autonomy-and-decisions.md](autonomy-and-decisions.md). Nothing else writes an approval, so an agent cannot approve its own request: it has no terminal, and its process descends from a run.

**Consumption.** An action starts by consuming a usable approval in the same transaction that records the action's start. Usable means the scope, action and digest match, the approval is neither revoked nor consumed, and its expiry is strictly later than now. Of several, the oldest granted is taken. Two processes racing for one approval cannot both take it, because the transaction takes the store's write lock first and the update re-checks that the approval is still unconsumed. The start event carries the approval ID, so the log shows which approval paid for which action.

**Expiry and revocation.** An approval that is not consumed within 30 minutes is never usable again, to the millisecond. `avarice approve --revoke` takes an approval ID and sets its revocation time. Revoking an approval that is already revoked or already consumed exits 3. A fresh approval after an expiry gets a new row and a new key: the key is SHA-256 of the scope, action, digest and an ordinal that counts the earlier approvals of the same three.

**Exits.** `approve` exits 0 for a grant, a decline and a revocation. It exits 3 for a request already approved, and for an approval already revoked or consumed. It exits 64 for a usage error, an unknown request or approval, and every refusal above. It exits 70 for an internal failure.

## How an action reaches an approval

The approval gate is the one place that says whether a privileged action may start. It runs in this order.

1. Policy is evaluated for the action and its parameters. A deny ends it, and the rule that denied it is returned.
2. An allow lets a read or local-write action through with no record. A privileged action that an explicit rule allows starts with its start recorded and the source `policy`.
3. A require-approval result needs a source. The first source is a contract authorization that names exactly this action and exactly these parameters, which records a start with the source `contract`.
4. The second source is an approval consumed with the start, recorded with the source `approval`.
5. With no source, the action is denied with the rule `approval-required:` and the request ID, and the message names the command the owner runs.

A policy rule can name an `approvalSource`, but every approval is written with the source `local-user`, so a rule that names another source is satisfied by the owner's approval all the same. The gate has one caller in the built system, the promotion of an onboarding's map into the owner's checkout, which names itself in the contract so that the owner's onboarding command is the authorization. Every other privileged action reaches the owner through the hook, which does not evaluate policy rules: it classifies the command and then refuses it or consumes an approval, so a rule's `approvalSource` and a rule that allows the action are not read there.

## Privileged commands in the hook

The hook classifies the shell commands an agent runs. A command that leaves the machine or changes a shared system is a privileged action, named by the action table. The hook recognizes seven forms.

| Command | Action |
|---|---|
| `git push` | `git.push` |
| `gh pr create` | `scm.pr.create` |
| `gh pr merge` | `scm.pr.merge` |
| `gh pr edit` | `scm.pr.update` |
| `gh release create` and `npm publish` | `release.publish` |
| `gh api` with a method other than GET | `scm.api.write` |

The classifier reads the command as the shell would split it. It looks through a leading assignment, `env`, `command`, `exec`, `nohup`, `nice`, `sudo` and `time`, the program's directory and letter case, git's global options, the separators `;`, `&&`, `||`, `|`, newlines, parentheses and backticks, and command substitutions, also inside double quotes. It runs and expands nothing. A `gh api` call with a field or input option and no method counts as a POST, and `npm publish --dry-run` is classified privileged.

An approval binds the target of the effect and the names of the options given, never an option's value. A command line over 65,536 characters is not classified, and a command substitution nested more than eight levels deep is not read.

| Action | Bound parameters |
|---|---|
| `git.push` | `remote`, `refspec`, `repo`, `options` |
| `scm.pr.create` | `base`, `head`, `repo`, `options`, `operands` |
| `scm.pr.merge` and `scm.pr.update` | `selector`, `base`, `repo`, `matchHeadCommit`, `options`, `operands` |
| `release.publish` from `gh` | `tag`, `target`, `repo`, `assets`, `options` |
| `release.publish` from `npm` | `package`, `registry`, `tag`, `access`, `options`, `operands` |
| `scm.api.write` | `endpoint`, `method`, `hostname`, `options`, `operands` |

So `git push --force origin main` needs its own approval, while `gh pr create --title a` and `--title b` share one. The working directory and git's `-C` option are not bound: `git -C other push origin main` shares the approval of `git push origin main`.

**In a run.** Every privileged form is denied with the rule `privileged:` and the action, whatever the run's command set holds. The hook records the request, or names the one still waiting, and the denial in one transaction, and tells the agent which command the owner runs. A run never consumes an approval, so a retry after the owner approves is denied again and records a fresh request, because the earlier one was answered. A privileged form is therefore never delivered from inside a run.

**In an attended session.** The owner's own host session can carry the same hook as a settings entry, installed by `install-host` into the host's settings file. The entry applies to Bash calls only, runs with a 5-second timeout and blocks the call when the hook fails. It enforces privileged approvals and nothing else: a call that is not a privileged form, and every other tool, passes with no decision, no event and no store access. A privileged form consumes one approval of the scope `attended:` and the host's session ID, which must be a plain token of up to 100 letters, digits, dots, underscores and hyphens. With no usable approval the call is denied with the request ID. After the owner approves, the same call in the same session passes once. The hook prints no allow, so the host's own permission rules still apply and an approval never widens what the host asks.

**What the classifier cannot see.** A command name built from a variable or an alias, a script or function that pushes, and `bash -c` over a computed string are not classified. The sandbox, which has no network and no credentials, and the protections of the SCM platform are the controls that hold when the classification is evaded.

## No replay after an interruption

A privileged action whose start is recorded and whose end is not may have taken effect, so it is never run again on its own. The gate finds such an action when the scope resumes and opens one permission decision for each, in the order the starts were recorded. The decision names the action and its parameter summary, cites the start event, and offers only `withdraw`, because nothing can be answered into an approval. The start is marked with an `action.interrupted` event after its decision exists, so a resume that is itself interrupted opens no second decision.

A run that finds such a start stops as blocked on a decision with the reason `enforcement_failure`, not `decision`. With `decision`, the supervisor would treat a run with a ready item as continuable and could run an item beside an open permission decision. The cost is that withdrawing the decision does not release the run, so the owner's way out is `avarice cancel`. An onboarding takes the same decision on its carrier run. An attended session has no decision to attach to: its interrupted starts are marked and returned, and nothing asks the owner about them.

<!-- gsd:write-continue -->
