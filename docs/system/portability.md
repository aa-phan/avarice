# Portability

*drafted, not yet reviewed*

AVARICE's workflows depend on ports, and each adapter says what it can do, so an adapter can be swapped by configuration without changing the code that uses it. This document describes the capability descriptors, the step requirements and their refusal as implemented in the descriptor type, the requirement table and the composition check (`src/ports/capability.ts`, `src/domain/capability-requirements.ts`, `src/app/capabilities.ts`). It also describes the test support that proves the swap: the fake-remote adapters and their seeded fault source, the contract suite and the workflow proof (`test/helpers/fake-remote-executor.ts`, `test/helpers/fake-remote-artifact-store.ts`, `test/helpers/seeded-faults.ts`, `test/contract/`, `test/integration/portability-proof.test.ts`).

Only the local adapters ship. The proof establishes less than a remote deployment would. The domain and application code reach the executor and the artifact store only through their ports, and the workflows survive serialization, delay, duplicate responses and calls whose end they never saw. The interfaces and tables the descriptors appear in are in [integrations.md](integrations.md) and [data-model.md](data-model.md), and the refusals surface in [runs.md](runs.md) and [onboarding.md](onboarding.md).

## Capability descriptors

Every adapter publishes a descriptor. The executor and host adapters build theirs when it is first read, because it needs a probe. The descriptor has a port name, an adapter name and a version. It has a map of capabilities that are true or false, optional attributes that are text and optional extensions. It also has a flag for whether the adapter works with no network. Composition records the descriptor of every adapter it builds in the store, so a changed adapter shows up as a changed record.

Fifteen files under the ports directory define the ports. Twelve are adapter ports that declare a descriptor. The other three are the descriptor type itself, the ledger and the diagnostics port, which are not adapters a workflow swaps. A structural test reads the port files, so a new adapter port that forgets its descriptor fails it. The capability table of an adapter is typed over its port's methods where that is possible, so a method added to a port cannot go undeclared.

| Port | Adapters | Capabilities | Attributes |
|---|---|---|---|
| `agent-host` | `claude-code`, `unavailable` | `claude-code`: `contained-invocation` (true only when its readiness checks pass), `headless` (true) and `resume` (false); a restricted host declares `restricted-invocation` (true only when its readiness check passes) in place of the first. `unavailable`: `contained-invocation` (false) only | `enforcement`, and for an enforced host `claudeVersion` and `admission`; `reason` when not enforced; `mode` on a restricted host |
| `executor` | `local-sandbox-exec` | `remote` (false), `cancel`, `process-group-kill` | `enforcement` |
| `artifact-store` | `local-fs` | `put`, `get`, `has`, `contentAddressed` | `redacted` when the store is wrapped by the redactor |
| `staging-workspace` | `clone`, `worktree` | One per method | `strategy` |
| `run-workspace` | `clone` | One per method, and `handoff` | `strategy` |
| `run-source` | `git-objects` | `head`, `conventionsAt`, `staleness`, `hasFile` | `reads` |
| `egress-proxy` | `allowlist` | `start`, `allowlist` | `loopbackOnly`; not offline |
| `graph-tool` | `graphify` | `extract-code`, `cluster`, `knowledge-pass` | `binary` |
| `gsd-onboarding` | `gsd-onboarding` | `init-onboard`, `map-full`, `map-fast`, `map-paths`, `adopt-map`, `stamp`, `verify-drift`, and `ingest-docs` (false) | `gsdVersion`, `packageName`, `gsdCoreDir` |
| `context-source` | `gsd-intel`, `gsd-graph`, `gsd-planning`, `git-files` | `find`, `read`, `refresh`; a source may also declare `paged`, and none does | None |
| `credential` | `keychain`, `cmd`, `delegated` | `delegated` | `helpers` for `cmd` |
| `notifier` | `local-osascript` | `banner`, `push` (false) | `destination` |

The `agent-host` adapter declares `resume` as false although the adapter accepts a session to resume. A step therefore cannot require it, and the step that needs a host requires `contained-invocation` instead.

## Step requirements

A workflow step names what it needs from the adapters, and the check runs before the step starts. A requirement is a port, a capability and a reduced mode: what the owner can do instead. A requirement is met when a descriptor of that port declares the capability true. False and absent are the same answer, and so is an adapter that composition did not supply.

| Step | Needs | Reduced mode |
|---|---|---|
| a unit of a run | `agent-host.contained-invocation` | None: no unit runs without a contained agent host |
| a check of a run | `executor.cancel` and `executor.process-group-kill` | None: checks run only in the OS sandbox with cancellation |
| the hand-off | `run-workspace.handoff` | None: without a hand-off the run leaves no review branch in the source |
| the dependency install | `egress-proxy.allowlist` | Run without the install step by declaring no install check |
| the onboarding stage | `staging-workspace.prepare` | None: onboarding stops until a staging workspace can prepare a copy |
| map `skip` | Nothing | Not applicable |
| map `adopt` | `gsd-onboarding.adopt-map` | A full map in staging |
| map `fast` | `gsd-onboarding.map-fast` | None: onboarding stops until an admitted gsd-core offers the map workflow |
| map `full` | `gsd-onboarding.map-full` | The same |
| map `paths` | `gsd-onboarding.map-paths` | A full map in staging |
| the graph index | `graph-tool.extract-code` and `graph-tool.cluster` | The index is recorded absent |
| planning initialization | `gsd-onboarding.ingest-docs` | Initialize planning attended with `/gsd-new-project`, and AVARICE records the result |

When a requirement is not met, the first unmet one in table order is the refusal. The error is `unsupported`, names the capability as `<port>.<capability>` and carries the reduced mode. The step does not start and nothing is simulated or substituted.

Two steps call the check. The entry gate of a run asks for the unit requirement. A host that already failed enforcement is refused by that check alone, with no second row. A host that enforces containment but does not declare the capability adds a `capability` failure row, and the run blocks with the reason `enforcement_failure`, carrying the capability and the reduced mode in the block data. The onboarding workspace stage asks for the requirement of the chosen mapping mode and blocks with the reason `scope_unavailable`, carrying the same two facts. The GSD adapter declares `ingest-docs` false, so planning initialization is unsupported whenever it is checked, and its reduced mode names the attended command. No stage checks it today.

## Extensions

An adapter's own features are named `<provider>.<feature>`, such as `github.draftPr`: a lower-case provider, a dot, and a feature name. An extension is never a key of the capabilities map, so an adapter's feature cannot widen the map a step is checked against. A test holds every production descriptor to the rule. A provider's own identifiers are kept verbatim. A context reference from the intel index is `<index file>#<key>` and one from the graph is the node's own ID, so an identifier is never rewritten into an AVARICE one.

## Fake-remote adapters

Two adapters stand in for a remote executor and a remote artifact store. They are test support and are never composed in production, which the proof checks: the production entry ignores the variable that selects them, and no file under the source, entry or scripts directories names it.

Both put every call and response through JSON text, give each call a seeded latency (the ranges are under "Limits of the proof"), drop 5% of responses and deliver 2% twice. The commands and blobs behind them are the real local executor and a local store in a directory of its own.

**The executor.** The key of a call is its invocation identifier plus a digest of the call, so two commands that carry one identifier never read each other's answer. The server runs a command at most once. It keeps the response text under the key until the client has it, so a retry of a call whose response was dropped is answered from the stored response. The client retries a dropped response up to six attempts in all and then reports `timeout` with an unknown side effect, because the command may have run. A duplicated response is delivered a second time under the same key and discarded. The descriptor says `remote` is true, with attributes for the transport and the seed.

**The artifact store.** The port is synchronous, because the ledger writes an artifact inside a transaction. The latency is therefore a blocking wait, and a dropped response is retried in a loop of up to three attempts, after which the call is `unavailable`. The retry is safe because the store is content-addressed: a put of bytes the remote already holds is a no-op that returns the same digest.

**The seeded fault source.** One seed fixes every latency, drop and duplicate, so a failure reproduces from its seed. It records an event for each drop, duplicate and run of the real executor, with a call identifier. Four variables, read only by the test command-line entry, select and observe the fakes.

| Variable | Effect |
|---|---|
| `AVARICE_TEST_REMOTE` | When set to `1`, swaps the executor and the artifact store for the fakes; any other value does nothing |
| `AVARICE_TEST_REMOTE_SEED` | The seed; 42 when unset |
| `AVARICE_TEST_REMOTE_LOG` | A file that receives one JSON line per fault event |
| `AVARICE_TEST_REMOTE_ROOT` | The directory that plays the remote store; the data root with `-remote` appended when unset |

The swap goes through the same override seam that tests use for the artifact store, and the swapped store is still wrapped by the redactor, so a replacement cannot bypass redaction.

## The contract suite

The suite holds one list of cases per port and runs it against every implementation of that port. An adapter that passes the list for its port can stand in for the local one. The executor list has 11 cases and the artifact list 10.

| Port | Cases cover | Runs against |
|---|---|---|
| `executor` | A passing command and a failing one with its output; the output cut at its limit; a timeout and an abort and an already-aborted signal; the environment given and nothing else; no network; writes outside the declared roots failing and reads of denied paths failing; a spec that is not runnable refused | The local sandboxed executor, and the fake with three seeds |
| `artifact-store` | The digest and size a put returns; the same bytes giving one blob; empty and distinct content; exact bytes back, including non-text; an unknown digest as not found; a corrupted blob never read as the wrong bytes and repaired by a put; `has`; a malformed digest as invalid; the descriptor | The local store, and the fake with three seeds |

Both runners import the same case modules, so a case cannot pass for one set of adapters and not exist for the other. A case module only defines cases and registers them, and runs nothing when imported, because a bare test run loads every file. A new adapter joins by adding a runner that builds it and calls the runner function for its port with a factory that returns a fresh adapter per case. The artifact runner also needs the adapter's blob count and a way to tamper with a blob, because the port does not expose them. A failing case names a behavior the adapter must change, or a contract line that was only true of the local adapter. A new port adds its own case list.

An adapter reports a command whose end it never saw as an error naming the side effect, `timeout` or `cancelled`, and passes the timeout and abort cases that way. The local adapter reports the same endings on the result as `timed_out` and `cancelled`.

## The workflow proof

The proof runs four workflows twice, once with the local adapters and once with the fakes under two seeds, and compares the end states. The workflows are an onboarding to an active record with its indexes, a run to `ready_for_review`, a discard and retry of a crashed unit, and a kill and resume of a supervisor killed during verification. For a run the comparison covers the run, its items, its attempts, its evidence, its gates and the commit tree handed off. For an onboarding it covers the record, its indexes, its map digests and its snapshot manifest.

The proof also checks that the faults were exercised. Across the workflows each seed dropped at least one response and duplicated at least one. No command ran twice, which the proof reads from the log of calls to the real executor. The swap is measured as a change to nothing under the source. The commits that built the proof are found by their subject line, and the check requires that none of them changes a file under the source directory. The check is skipped in a checkout whose history lacks the commit range it starts from.

## Limits of the proof

The fakes live in the same process as the code they test. They cannot show these.

- Network partitions longer than the retry bound. The fakes retry a bounded number of times and give up, while a real partition lasts minutes.
- Real latency distributions. The fakes draw 5 to 30 ms for the executor and 1 to 5 ms for the store, uniformly. Real links have tails, bursts and head-of-line blocking that change timeouts and lease renewals.
- Remote authentication and transport security. There is no TLS, no credential exchange, no expired token and no revoked key.
- Filesystem and object-store semantics. The remote store is a local directory with the local store's atomic rename, which a network share or an object store does not offer.
- Worker differences and performance. The commands run in this machine's sandbox, and nothing measures throughput.

A real remote adapter needs deployment tests that this proof does not provide. The portability proposal ([deployment-and-portability.md](../deployment-and-portability.md), the staging section) plans them.

## Quirks

- Six of the twelve step requirements are defined and never checked by a stage: the check, the hand-off, the install, the onboarding stage, the graph index and planning initialization. Only the unit requirement and the mapping modes are enforced.
- The requirement for the `adopt` mapping mode names `adopt-map`, which the GSD adapter declares true although adoption is not a GSD workflow: it states what AVARICE does with a map GSD vouches for.
- Several adapters' calls to the GSD and graph tools give separate calls one invocation identifier (`gsd:` and the verb, `graphify:` and an ID), so an adapter that deduplicated by identifier alone would merge them. The fake executor keys on the identifier plus a digest of the call, which hides this.
- The executor descriptor has `remote` false for the local adapter, and no step requires it.
- The contract list for the artifact store has to reach into an adapter's storage to count and tamper with blobs, because the port has no way to.
