# Autonomy and decisions

*drafted, not yet reviewed*

A run asks the owner a question only when it cannot finish a piece of work inside its contract, and it never takes silence for an answer. This document describes the decision subsystem as implemented in the decision policy, the response checks and the state digest (`src/domain/decision-policy.ts`, `src/domain/response-validation.ts`, `src/domain/state-digest.ts`). The block and scheduling stages open and read decisions (`src/app/run-stages/blocked.ts`, `src/app/run-stages/schedule.ts`, `src/domain/work-items.ts`), and the answer service and its command answer them (`src/app/decide.ts`, `src/cli/commands/decide.ts`, `src/cli/identity.ts`). The notification and check-in modules (`src/domain/notify-policy.ts`, `src/app/notify.ts`, `src/app/digest.ts`, `src/adapters/notify/local-notifier.ts`, `src/adapters/schedule/launchd.ts`) and the ledger methods that move a decision (`src/adapters/sqlite/ledger.ts`) complete the set.

A decision is a record the run writes when one work item stops to ask or when the whole run must stop. The owner answers it from a terminal, and an answer that was given on a state that has since moved is never applied. Notifications tell the owner that something waits; they carry no answer. The run keeps going with the work the open decision does not touch, so one question does not stop independent items. The flows are drawn in [processes.md](processes.md), the run side in [runs.md](runs.md) and the tables in [data-model.md](data-model.md). Command flags and exit codes are in [cli-reference.md](cli-reference.md).

## Decision records

A decision belongs to one run and carries these parts.

| Part | Meaning |
|---|---|
| ID | `dec_` and 26 characters, so IDs sort by creation time. |
| Class | One of five written by the run (below). The ledger accepts eight. |
| Issue | What the owner reads. AVARICE's own words, or the unit's question stored as data. Control, zero-width and bidirectional characters are removed and the text is cut to 1000 characters. |
| Options | The ways to answer, at most nine. A `choice` has a key (`1` to `9`, or an ID the unit's plan gave) and a label of at most 200 characters. A `text` option, key `text`, takes free text. A `withdraw` option, key `withdraw`, takes the question back. |
| Recommendation | The option the unit marked, kept as data. It is never a default. |
| Consequences | One sentence per option saying what happens to the item, plus the amend command where an amendment would answer the decision. |
| Affected items | The item the decision is about, first, then every item that depends on it directly or through a chain. |
| Evidence references | The evidence rows, checks, output digests and test names the decision cites, and tags saying which gate opened it. |
| Contract version and state digest | The contract version the decision was opened on and a digest of the state it was asked in. |
| Urgency | Always blocking, as the run writes it. The ledger also accepts `digest`. |
| Supersedes | The earlier decision this one re-opened, when the owner answered a decision on a state that had moved. |
| State | `open`, `answered`, `stale` or `withdrawn`. |
| Answer, who, when, channel | Set when the decision leaves `open` through an answer. The channel is always the terminal, and who is `owner:` and the operating system user name. |

An open decision lists the items it blocks. An item is ready to run only when no open decision lists it or anything it depends on, so the list is what keeps dependent work from being built on a choice nobody made. Answered, stale and withdrawn decisions block nothing.

Options come from what was measured, not from what the model claims. A unit that stops with a question line ending in a question mark followed by at least two choice lines numbered from 1 gives the choices in order, at most nine. A trailing `(Recommended)` on exactly one choice becomes the recommendation. A pause with no parsable choices, a plan checkpoint without a given option, and a choice the brief left to the owner are answered in free text. A decision that is not a pause offers only `withdraw`. A record written before options existed stored none, and reads as offering `withdraw` only, so no decision is left that cannot be closed.

Every transition of a decision is one ledger transaction under the run's lock, and the ledger refuses it when the decision is no longer open. Event data carries identifiers, a channel, a count or a check name, never the answer or the question.

## Classes and authority

The run writes five classes. The signal that opens one is something AVARICE measured: a waiting file, a verification status, the numbered-choice shape of the final text, a gate verdict, a spent budget or a denied call.

| Class | Opened when | Offers | Amend command |
|---|---|---|---|
| `acceptance` | The unit paused to ask; the plan holds a decision checkpoint with no preselected option; a criterion that names an owner choice was not asked; a gate other than the checks fails; the brief is too long for the prompt. | The unit's numbered choices, the plan's option IDs, or free text | None |
| `scope_expansion` | The plan names a path outside the write set or outside the item's explicit spec; the hand-off branch exists at another commit. | `withdraw` | `--add-write` for the paths the plan named, when it named any |
| `permission` | The unit made no in-scope change and was denied; the clone HEAD moved; the write scope was breached; the host refused to launch; a declared check could not be used. | `withdraw` | None |
| `repeated_failure` | No progress; a loop limit; a crash after the one retry; a failed repair; a failing required check; a failed final proof. | `withdraw` | `--budget invocations` raised by one over the limit the run reached |
| `budget` | A budget is spent before or during a unit. | `withdraw` | `--budget` for each spent budget, with the value the run measured |

The authority of a decision says who may settle it. A choice the owner must make has authority `human`. Budget and permission decisions have authority `prohibited`: the run may never widen itself, so these offer `withdraw`. A budget decision is answered by an amendment made from outside the run. A permission decision carries no amend command, so the only answer `decide` offers for it is `withdraw`, although an amendment that names it by hand can still answer it. A class the contract lists with a default would give authority `default`, and a category the contract delegates would be logged as an assumption without opening a decision. The routine contract names no default and the stages never raise the delegated signal, so every stored decision is `human` or `prohibited`.

Whether a block stops one item or the whole run depends on its reason. A block opened for one item's decision while the units run (reason `decision`) stops only that item and the items that depend on it. The run goes on with the rest. Every other block is a state of the whole run: a containment breach, a spent budget, a refused host, a changed source ref. It stops the run, and the item's decision is opened with it. A failed final proof, a hand-off conflict and a failed preparation also carry reason `decision`, but they are not about one item's work, so they stop the run.

## Response checks

An answer is judged by one pure rule over facts the command measured. The first check that fails decides, and the checks run in this order.

1. **Identity.** The responder must be at an interactive terminal on both standard input and output. The responder must not be inside a run (the `AVARICE_RUN` marker is unset) and must not descend from a process a run started. The responder must be the operating system user who owns the profile's data root. An answer from the agent that asked the question fails here, before anything else is read. A process table that cannot be read counts as inside a run. The first three refusals are made before the profile is opened, so a refusal creates nothing. The owner check follows once the profile is open.
2. **Open.** An open decision goes on. An answered one goes on to be told apart from a repeat. A stale one is refused and names the decision that replaced it. A withdrawn or otherwise closed one is refused.
3. **Option.** The answer is exactly one of an option key or free text, never both and never neither. A key must be a listed choice or `withdraw`; a `text` option is answered with text and never by its key. Free text is accepted only where the record lists a `text` option, and then it is 1 to 2000 characters with no control character other than tab and line feed.
4. **Duplicate.** The same answer given to an answered decision is ignored and recorded. A different answer is refused.
5. **State digest.** The digest recomputed now must equal the digest the decision was opened with. Otherwise the verdict is stale, not apply. A `withdraw` is exempt: it applies nothing to the work, so it holds whatever the digest says. A missing digest on either side never matches.

The digest covers the contract version, the base revision, the policy revision and, for requirements that are tickets, each ticket's revision. The manual brief stands for itself through the contract version. Any amendment writes a new contract version, so an amendment makes every decision still open stale on its next answer, unless that amendment answered the decision itself.

The verdicts are `apply`, `stale`, `duplicate` and `reject`. An `apply` needs a responder who passed identity and a matching state. The rule has no clock input: no deadline, delay or silence can produce one.

A refused answer is recorded as an event naming the run, the decision and the check. The responder's text is not recorded. A refusal at the identity check is not recorded either, because it says nothing about the decision. The service reads the decision once more when the ledger refuses a write because the decision or the contract moved between the read and the write. It gives up with a conflict if the decision moves twice.

An applied answer moves the decision to `answered`, and every affected item that no other open decision lists goes from `blocked_on_decision` back to `ready` in the same transaction. The answer does not change a contract field, a budget or the write scope. Widening is the amendment command's work, which runs from the owner's terminal and is described in [runs.md](runs.md).

## The stale re-open

A decision is stale when the state moved after the question was asked. The owner's answer is then not applied. The old decision becomes `stale` and keeps the answer, who gave it and the channel, as context. A new decision opens with the same class, issue, options, consequences, affected items, recommendation and default, on the new digest and contract version, with `supersedes` naming the old one. The new decision's evidence references gain a `contract:v` entry for the version it was reopened on. The affected items keep their state, since the question is still open. The command tells the owner which versions the answer crossed, that the answer was kept as context, and the command that answers the new decision. It exits 3.

Answering the stale decision again is refused with the successor's ID. The flow is drawn in [run-amend-stale.puml](diagrams/run-amend-stale.puml).

## Withdraw

The owner takes a question back with the `withdraw` option, or a cancel withdraws every open decision of the run in decision-ID order. The decision becomes `withdrawn` and the event records whether the owner or a cancel did it. Nothing is applied and the affected items keep their state, so they stay blocked. The scheduler then finds nothing ready and no open decision. The run does not wait: once every other ready item has finished, it ends `failed`, and the event names the items that were not delivered and the decisions withdrawn.

## The amendment request

A decision that offers only `withdraw` and carries an amend command is answered by an amendment, not by an option. If the owner gives an option key that is not listed for such a record, which is any key other than `withdraw`, nothing is applied. An event records that an amendment was requested, and the command prints the amend command, with the decision's own ID in it, and the way to take the question back instead. It exits 3.

At the interactive prompt the owner can type `amend` for such a record. The command then shows the amendment preview, pre-filled with what the signal measured (the paths the plan named, the values a budget reached), and asks for confirmation. On `y` it writes contract version n+1 and answers the decision in one transaction, as `amended:v` and the new version. A record that measured nothing to pre-fill prints the command instead and exits 3. A pause is never answered by an amendment; an amendment can answer only `repeated_failure`, `permission`, `budget` and `scope_expansion` decisions of the same run.

## Pickup without polling

Nothing polls for an answer. Two writes are made around an answer, and whichever happens second sees the other.

- The supervisor that blocked the run releases its lease and reads the items and decisions again before it returns. If an answer arrived in that window and made an item ready, the supervisor goes on in the same process.
- The answering command checks, after it writes, whether the run is blocked on an item decision and continuable. A run is continuable when it was blocked with reason `decision`, the block came from `running` (or from `paused` during a resume), and either an item is ready or no decision is open. If it is continuable and no live lease is held, the command starts the detached supervisor through the one spawn path. If a supervisor holds the lease, nothing starts: that supervisor's scheduler takes the answered item next. In every other case nothing starts.

`resume` applies the same rule. It continues a blocked run an answer made continuable when no live lease is held, which covers a supervisor that died right after the run blocked. An answer to a decision of a run in another state starts nothing.

A supervisor started this way, and every supervisor of the run, runs the host under the configuration directory the run recorded at start. When that directory is missing or unreadable, the command refuses an open decision before it writes anything, because the paused session cannot be found anywhere else.

## Notification

The inbox and `status` are the source of truth for what waits. A notification is an announcement of that, and every notification row carries a state the owner can read there.

- **When a banner is raised.** When an item blocks, one notice per decision is queued and no banner goes out yet. At each item boundary, the supervisor delivers the queued notices of the run as one banner once the batch window has passed, counted from the oldest queued notice. When the run stops blocked on decisions, one banner covers every notice still queued. When the run stops ready for review, or blocked for a reason that is not a decision, one banner says so.
- **Where it goes.** A destination is used only if both the contract's list for that kind of event and the profile's list name it. A contract can narrow the profile's destinations and never add one. The one destination built is the local macOS notification.
- **What it says.** The title is `AVARICE`. The body holds counts, the run ID and the next command (`avarice inbox`, or `avarice status` for a blocked run), in at most 200 characters. The digest banner carries no run ID. It holds no decision issue and no text the model wrote.
- **Delivery and failure.** A row is `pending`, `held`, `delivered` or `failed`. The raising process tries up to three times, at once and then after 10 and 60 seconds. Every attempt is recorded with a short error code. After the third failure the row is `failed`, and the next check-in tries again. A notifier that throws is recorded as a failed attempt with a generic code. Whether a banner arrives never changes an exit code or what a run does.
- **Quiet hours.** The profile can name a quiet range of local time. The range is half-open, so it includes its start and excludes its end, and it wraps past midnight. During it, no banner is posted. The rows are held, and the inbox still shows everything.
- **No notification answers a decision.** A banner, a hold, a failure, a digest and the time that passes are not inputs to any decision.

The profile settings are keys in the profile's config file, listed in [config-reference.md](config-reference.md).

## Check-ins

`avarice digest` is a scheduled check-in. When open decisions or runs ready for review exist, it posts one batched banner with the counts and writes one `digest` notification row. When nothing waits, it posts nothing and writes nothing. It also catches up on banners that did not arrive. Pending, held and failed rows about decisions still open or runs still waiting are marked delivered when this digest's banner is delivered, since its count already includes them. Earlier digest rows left held or failed are marked the same way. When the banner is not delivered, those rows keep their state and the next digest tries again. In quiet hours the digest holds one reused row. The command refuses inside a run, needs no terminal and never reads or writes a decision.

`avarice schedule install` writes one user LaunchAgent for the owner's profile. The agent runs `avarice digest` at the profile's digest times, and `schedule remove` takes it away. launchd waits for the clock; no AVARICE process and no model sits idle between runs. The agent has no run-at-load and no keep-alive. The command works only from a terminal outside a run, for the owner's own profile, and refuses an empty list of digest times. The file formats and exit codes are in [cli-reference.md](cli-reference.md) and [integrations.md](integrations.md).

## Quirks

- The delegated and default paths of the classifier have no caller. The routine contract lists no default, and no stage reports a delegated choice, so no decision is ever opened as `default` and no assumption is ever logged.
- Every amendment, whatever it changes, makes the decisions still open stale. The next answer to such a decision re-opens it instead of applying.
- A withdraw is applied even on a stale state. It is the one answer exempt from the digest.
- A withdrawn decision does not release its items. A withdrawal ends the run `failed` once the other work is done.
- An answer to a decision of a run that has already ended is still recorded, and starts nothing.
- A supervisor killed after it released the lease of a blocked run, and before it raised the banner, leaves the notice pending. The inbox still lists the decision, and the next digest covers it.
- A resumed session is given the answer but not the question, since the session remembers asking. A fresh unit that replaces a failed resume is given both.
- A resumed unit that leaves the parked waiting file in place, or a parked verification that still reads `human_needed`, reads as paused again and opens a new decision.
- `decide --wait` follows only a supervisor that this command started. With a live supervisor already holding the lease there is no process to follow, and the command returns at once.
- A block at the enforcement check, before any unit runs, opens no decision. The run's state and reason are the only trace, so the inbox shows nothing for it and no answer can continue it.
