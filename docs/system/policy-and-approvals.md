# Policy and approvals

*drafted, not yet reviewed*

A privileged action never starts on the agent's say-so. Policy can deny it outright, and otherwise only the owner at a terminal can approve it. This document describes that subsystem as implemented in the approval gate, the approve command, the approval rules and the action table (`src/app/authorize.ts`, `src/cli/commands/approve.ts`, `src/domain/approval.ts`, `src/domain/action-class.ts`). Policy evaluation and the files behind it are in `src/domain/policy.ts` and `src/adapters/fs/policy-sources.ts`. The shell forms that count as privileged are in `src/domain/privileged-commands.ts`, and the hook that refuses them is `src/hook/pre-tool-use.ts`, installed into the owner's own host sessions by `src/adapters/host-claude/attended-hook-install.ts`. The enforcement map is `src/domain/enforcement-map.ts`, and the manual equivalents are `src/app/manual-inputs.ts` with the commands that call them. The approval rows and their guards are in `src/adapters/sqlite/ledger.ts`, `src/adapters/sqlite/approval-rows.ts` and the profiles migration.

An approval authorizes one action with exactly the parameters it was granted for, once, within 30 minutes. A decision answer, a plan, a contract amendment, a deadline and silence approve nothing. The approval flow is drawn in [approve-privileged-action.puml](diagrams/approve-privileged-action.puml). The tables are in [data-model.md](data-model.md), the profile keys in [profiles-and-credentials.md](profiles-and-credentials.md) and [config-reference.md](config-reference.md), and the command flags and exit codes in [cli-reference.md](cli-reference.md).

## Actions and classes

Every action AVARICE can take belongs to one of three classes, and the class lives in one table. A name that is not in the table is privileged, so an action added anywhere in the program starts as the most restricted class until someone classes it.

| Class | Meaning | Actions |
|---|---|---|
| read | Observes the repository, the store or a run's status and changes nothing outside memory | `context.retrieve`, `repo.read`, `status.read` |
| local-write | Writes only inside the profile's roots, the staging copy or a local branch the run owns | `workspace.write`, `staging.write`, `artifact.store`, `handoff.local-branch` |
| privileged | Leaves the machine, changes a shared system, or writes into the owner's repository | `git.push`, `scm.pr.create`, `scm.pr.update`, `scm.pr.merge`, `scm.api.write`, `scm.comment.create`, `tracker.write`, `release.publish`, `deploy`, `export`, `onboarding.promote.copy`, `onboarding.promote.commit`, `net.insecure-transport`, `net.unauthenticated`, `net.egress-unlisted` |

The last three privileged names are the transport rules: a request that is not TLS, a request with no authentication, and a request to a host off the allowlist. The built-in policy denies them, and no file can change that.

Only some of the 22 names are produced by running code. The hook's classifier names `git.push`, the three `scm.pr` actions, `scm.api.write` and `release.publish`, and promotion names the two `onboarding.promote` actions. The remaining names have a class and no call site.

## Policy sources and ranks

Four ranked sources decide whether an action is allowed, denied or needs an approval. Each source is a file the owner or the organization writes, or the built-in table.

| Rank | Source | Where it comes from |
|---|---|---|
| 1 | Organization file | The path in the profile config key `policy.organizationFile`, read only under an enterprise profile and resolved against the profile's own configuration directory |
| 2 | Built-in defaults | The code: reads and local writes allowed, privileged actions need approval, the three transport rules denied |
| 3 | User policy | The rest of the profile config's `policy` section: `schema` and `rules` |
| 4 | Repository policy | `.avarice/policy.json` in the repository, read from the pinned commit |

A policy file is data. It has `schema` 1 and a list of at most 256 rules, in at most 64 KiB, and any other key is refused. A rule has an `id` and an `action`, each of 1 to 64 lower-case letters, digits, dots, underscores and hyphens, starting with a letter or a digit. It has an `effect` of `allow`, `deny` or `require-approval`, and optionally a `when` and, on a require-approval rule only, an `approvalSource`.

A `when` holds 1 to 8 parameter names with non-empty string values of at most 128 characters. The rule applies only when every named parameter is present and equal. A number or a boolean parameter is matched by its text, and any other value has no text to match. Rule IDs are unique within a file, and the prefixes `builtin.` and `sec5.` and the ID `org.invalid-or-missing` are reserved. A file that breaks any of this is refused whole.

The evaluation runs in this order, and the first step that applies decides.

1. The three transport rules are fixed. They decide first and nothing changes them.
2. A broken rank 1 denies every privileged action with the rule `org.invalid-or-missing`, whatever the other ranks say. Rank 1 is broken when a file is expected and unusable: unreadable, a symbolic link, not a regular file, over 64 KiB, not JSON, or not a valid policy. It is also broken when an enterprise profile names no file or names one that does not exist.
3. A rule the organization file states for the action decides at rank 1, and lower ranks can only make the answer stricter. Of several matching rules in one file, the strictest wins, and the first of equals.
4. Otherwise the built-in rule decides. Under a personal profile, a matching user rule replaces it, whether the rule loosens or tightens.
5. Ranks 3 and 4 then replace the answer only with a stricter effect, in the order `allow`, `require-approval`, `deny`. Under an enterprise profile the user policy only tightens. The repository policy only tightens under every profile.

A personal profile never reads `policy.organizationFile`, even when it is set. A policy file accepted by the evaluator must be one that the parser produced for that same source, so a file parsed as a repository policy placed in the user slot is unusable. Under rank 1 that counts as broken, and at ranks 3 and 4 it counts as absent, which leaves the stricter built-in answer in force. Text from a brief, a context item, tool output or model output has no slot to enter, and the evaluator takes no such text as a parameter.

The organization file and the user section are read at the first evaluation of a command and kept, so an edit applies from the next command. The repository policy is read from git objects at the pinned commit, never from the working tree, so an uncommitted edit, or one a run makes in the owner's checkout, cannot change an answer. A repository policy that is a symbolic link, a submodule entry, not a regular file or over 64 KiB is refused, and a pin that is not a full lowercase commit hash is refused.

Policy is evaluated by the approval gate and nowhere else. The run's hook has its own generated policy file, described in [containment.md](containment.md), which is unrelated to these four sources.

## Approvals

An approval has a request, a grant, at most one consumption and an end by expiry or revocation. Each step is a ledger transaction under the profile's store.

**Request.** A request is an event, not a row. The gate or the hook writes `approval.requested` with a request ID (`apr_` and 26 characters), the scope, the action, the parameter digest, a bounded summary of the parameters and the rule that asked for approval. The scope is the run ID, the onboarding ID, or `attended:` and the host session ID for the owner's own session. A retry of the same action with the same parameters names the request that is still waiting and writes no second one. A request stops waiting when an approval answers it.

**Parameters and digest.** The digest is SHA-256 of the canonical JSON of the parameters: keys sorted, no whitespace, so key order never changes it and any changed value does. Parameters with no canonical form, such as a number that is not finite, cannot be approved. The summary shown to the owner lists the parameters as `key=value` in key order, each value cut to 80 characters and the whole to 400, with control characters replaced. The digest is what the approval binds. The summary is for the owner's eyes and is redacted when the event is written.

**Grant.** `avarice approve` takes a request ID, shows the action, the scope, the summary, the digest and the grant it would make, and asks. Only a yes grants. Anything else exits 0 and writes nothing. A grant inserts one approval row (`apv_` and 26 characters) with the request's scope, action and digest, source `local-user`, the granter `owner:` and the operating system user name. The approval expires 30 minutes after the grant. A request is granted once: a second grant of the same request exits 3. An approval cannot be deleted, and its consumption and revocation times are set once and never changed, which database triggers enforce.

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

A policy rule can name an `approvalSource`, but every approval is written with the source `local-user`, so a rule that names another source is satisfied by the owner's approval all the same. The gate has one caller in the built system, the promotion of an onboarding's map into the owner's checkout, which names itself in the contract so that the owner's onboarding command is the authorization. Every other privileged action reaches the owner through the hook. The hook does not evaluate policy rules. It classifies the command and then refuses it or consumes an approval, so a rule's `approvalSource` and a rule that allows the action are not read there.

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

The classifier reads the command as the shell would split it. It looks through a leading assignment and the wrappers `env`, `command`, `exec`, `nohup`, `nice`, `sudo` and `time`. It ignores the program's directory and letter case and reads past git's global options. It splits at the separators `;`, `&&`, `||`, `|`, newlines, parentheses and backticks, and reads command substitutions, also inside double quotes. It runs and expands nothing. A `gh api` call with a field or input option and no method counts as a POST, and `npm publish --dry-run` is classified privileged.

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

## Enforcement map

The enforcement map is a code table of 18 controls: who enforces each one, what AVARICE's part is, how the control can be bypassed, and the test that proves it. The enforcer is `host` (the agent host), `os-sandbox`, `external-platform` or `avarice`. A proof is a tracked test file, or the reason none exists. No command prints the table, and a unit test holds it to its shape.

| Control | Enforcer | AVARICE's part | Limit | Proof |
|---|---|---|---|---|
| `scm-branch-protection`: branch protection, required reviews, required checks | external-platform | Records status | None from AVARICE's side; the platform is the authority | None possible: the platform owns it |
| `ci-gates`: CI and deployment gates | external-platform | Records results | AVARICE cannot loosen or replace them | None possible |
| `identity`: identity, MFA, token lifetime | external-platform | Uses delegated credentials | A run holds no credential of its own | None possible |
| `host-managed-permissions`: host permission rules and managed settings | host | None | Whether managed-only permission rules hold is not established; no profile claims it | Unverified |
| `sandbox-confinement`: shell and child-process confinement | os-sandbox | Generates the sandbox configuration per run and refuses to launch without it | Hooks and local MCP servers run outside the sandbox, and so does the host process | The sandboxed executor containment test |
| `tool-call-decisions`: tool-call decisions in unattended runs | host | Evaluates the run's generated hook policy in the fail-closed PreToolUse hook; the host runs in `dontAsk` mode | Paths the containment document leaves unverified; a removed hook is caught by the launch checks, not by the hook | The hook integration test |
| `budgets`: budgets | avarice | Owns the ledger counts; the host enforces `--max-budget-usd` per invocation | Cost is a client-side estimate reported after each invocation | The budget fault test |
| `privileged-approval`: privileged-command approval in the host | host | Classifies in the PreToolUse hook the host runs | Commands outside the host, obfuscated shell and a removed hook are not seen | None named in the table |
| `approval-single-use`: approval single-use and binding | avarice | Owns the approval ledger and the parameter digest | A user with file access can edit the database | None named in the table |
| `profile-isolation`: profile isolation | avarice | Owns the per-profile roots and the sandbox denial of other profiles | A user can copy files between directories; a profile moved by environment variable is covered only when its configuration is found | The profile isolation integration test |
| `redaction`: redaction before persistence | avarice | Owns the redactor applied at the event and log boundaries | Pattern-based; unknown secret formats can pass | The redaction suite |
| `prompt-injection`: prompt-injection scanning | avarice | Fences retrieved text as data and keeps authority separate from it | Heuristic; authority separation is the control that holds | The context integration test |
| `write-scope`: write scope | os-sandbox | Computes the write scope of each invocation and passes it to the sandbox and the hook | The working directory is always writable to shell commands; a process outside the sandbox is not confined | The run scope unit test |
| `network-scope`: network scope | os-sandbox | Leaves an invocation no network; gives one supervisor step a loopback port to an allowlisting proxy | The proxy checks host names with no TLS inspection; MCP servers and hooks reach the network directly; the host's model traffic is outside the sandbox | The allowlist proxy integration test |
| `credential-denial`: credentials absent from the run | os-sandbox | Rebuilds the environment from an allowlist and denies reads of credential directories | Denial is by path, not content; a credential in an allowed read root is readable; an allowed MCP server with its own credential can act | The invocation scope unit test |
| `organization-policy-fail-closed`: organization policy file, rank 1 | avarice | Reads the file without following a link and denies privileged actions when it is missing or invalid under an enterprise profile | Tamper resistance holds only where managed settings or an external platform deliver the file | The policy precedence unit test |
| `restricted-mode`: restricted mode when a layer is unavailable | avarice | Drops the run to restricted and refuses unattended runs; never substitutes instructions, an unapproved sandbox or an unapproved egress path | A restricted run produces a plan, a patch file and a decision list only, and the host must honor its restricted flag | None named in the table |
| `hook-cost-fields`: finer budget enforcement from token or cost fields in hook input | host | None until the host provides the fields | Whether hook input carries those fields is not established; no profile relies on it | Unverified |

Of the three rows that name host limitations, two are marked as claimed by no profile. The three platform rows have no proof because the platform owns the control. The two host-limitation rows are unverified because the question is open. The three rows with no test named say in the table that the proving test does not exist, although the suites that exercise them are tracked.

## Manual equivalents

Every integration has a manual route for an organization that prohibits it. The routes need no network and no host, and they write only the ledger and the artifact store.

| Integration | Manual route |
|---|---|
| Tracker read | `avarice start --brief <file>` with the ticket text in the file |
| Tracker write | `avarice comment --print --run <run>` prints a comment for the owner to paste |
| Documentation retrieval | `avarice context add --file <file> --source "<title> rev <n>" --run <run>` |
| CI results | `avarice evidence add --kind ci --file <file> [--ref <url>] --run <run>` |
| Pull request creation | The owner opens the pull request in the web UI, then `avarice pr record <url> --run <run>` |
| Approvals | `avarice approve <request>` in an interactive terminal |
| Audit sink | No command: `avarice export` does not exist |

The four commands that record something refuse inside a run and from a run's process tree, with exit 64 before the profile resolves, and they need no terminal. Their flags and exit codes are in [cli-reference.md](cli-reference.md).

**Context add.** The file is one pack's worth of text: non-empty, valid UTF-8, at most 16,000 bytes. The `--source` text is at most 200 characters, with no control characters, and is kept verbatim as the reference's identity. The text is stored redacted and offered to the run's next context pack as an untrusted item. Adding the same file under the same source again records nothing, and a new file under the same source replaces the earlier one.

**Evidence add.** The kind is `ci`, `review` or `manual`, and the file is at most 2 MiB of UTF-8 text. AVARICE did not measure the content, so the row is `inconclusive`, independent of the run, and sits on a revision that no gate judges. It satisfies no gate and replaces no earlier row, and a second add is a second row. It attaches to the run's latest attempt, so a run with no attempt has nothing to attach it to.

**Pr record.** The URL must be `http` or `https` with the path `/<owner>/<repository>/pull/<number>` and no credentials. Nothing is fetched, so nothing says whether the pull request exists or what state it is in. A query and a fragment are dropped. The same URL twice records once.

**Comment print.** The comment is built from ledger rows only: the run, its state, its items' states, the checks that passed with the revision each passed at, and the open decisions. It writes nothing, posts nothing and passes through the redactor.

## Quirks

- An approval is tied to a scope and to parameters, not to who or what asks. Any process of the same scope that presents the same action and parameters within 30 minutes uses it.
- An attended approval leaves an `action.started` event with no `action.finished`, because only the pre-tool-use entry is installed. Nothing reconciles an attended scope, so the dangling start is never reported to the owner.
- The attended entry has a 5-second timeout and blocks on failure, so a slow or failing hook blocks the owner's own shell call.
