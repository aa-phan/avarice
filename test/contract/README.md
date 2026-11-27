# Adapter contract suite

One list of cases per port, run against every implementation of that port. An adapter that passes the list for its port can stand in for the local one.

| Port | Cases | Runs against |
|---|---|---|
| `CommandExecutor` | `command-executor.cases.ts` | `SandboxedExecutor` (`local.test.ts`), `FakeRemoteExecutor` with three seeds (`fake-remote.test.ts`) |
| `ArtifactStore` | `artifact-store.cases.ts` | `LocalArtifactStore` (`local.test.ts`), `FakeRemoteArtifactStore` with three seeds (`fake-remote.test.ts`) |

Both runners import the same case modules, so a case cannot pass for one set of adapters and not exist for the other. A case module only defines cases and a registration function; it runs nothing when imported, because a bare `node --test` loads every file under `test/`.

## What the suite is for

The fake-remote adapters (`test/helpers/fake-remote-executor.ts`, `test/helpers/fake-remote-artifact-store.ts`) put every call and response through JSON text, add latency, drop 5% of responses and deliver 2% twice, all from a seeded random source (`test/helpers/seeded-faults.ts`). The contract cases show that a transport with those faults still gives the port's behaviour. The workflow proof in `test/integration/portability-proof.test.ts` then runs onboarding, a run to `ready_for_review`, a discard and retry, and a kill and resume against the same fakes, selected by `AVARICE_TEST_REMOTE=1` in the test CLI, and compares the end states with the local run. It also checks that the plan's commits change nothing under `src/` (AC-7).

The fakes absorb the faults the way a real remote adapter has to:

- The executor runs a command at most once. A retry of a call whose response was dropped is answered by invocation key from the stored response; a duplicated response is discarded. If every attempt loses its response, the call ends `timeout` with `sideEffect: 'unknown'`.
- The artifact store is content-addressed, so a put of bytes the remote already holds is a no-op that returns the same digest. A dropped put response is retried by digest, at most three attempts, and then the call is `unavailable`.

A failure reproduces from its seed: set `AVARICE_TEST_REMOTE_SEED` (default 42) and, to read what the fakes did, `AVARICE_TEST_REMOTE_LOG=<file>`, which receives one JSON line per drop, duplicate and run of the real executor.

## How a Phase 7 adapter joins

1. Write a runner next to `local.test.ts` that builds the adapter and calls `runExecutorContract(make, cleanup)` or `runArtifactContract(make)` with a factory that returns a fresh adapter per case. The artifact runner also needs the adapter's `blobCount()` and `tamper(digest)`, which reach into its storage because the port does not expose it.
2. Run it. A case that fails names a behaviour the adapter must change, or a contract line that was only true of the local adapter and needs discussing.
3. Add the adapter to the table above. For a new port (`ContextSource` and the others), add a `<port>.cases.ts` and register it the same way.

An adapter that reports a command it could not see the end of as an error naming the side effect (`timeout` or `cancelled` with `sideEffect`) passes the timeout and abort cases; a local adapter reports the same endings as `timed_out` and `cancelled` on the result.

## What this proof does not show

The proof shows that domain code depends only on the ports and that the workflows handle serialization, delay, duplicates and unknown side effects as specified. A fake in the same process cannot show:

- **Network partitions longer than the retry bound.** The fakes retry a bounded number of times and then give up; a real partition lasts minutes (Wi-Fi drop, laptop sleep) and the proof never holds one open.
- **Real latency distributions.** The fakes draw 5 to 30 ms (1 to 5 ms for the store) uniformly. Real links have tails, bursts and head-of-line blocking that change timeouts and lease renewals.
- **Remote authentication and transport security.** There is no TLS, no credential exchange, no expired token and no revoked key. Profile isolation of remote secrets is a Phase 7 test.
- **Filesystem and object-store semantics.** The "remote" store is a local directory with the local store's atomic rename. A NAS, an SMB share or an S3 bucket has its own consistency, ordering and partial-write behaviour.
- **Worker differences and performance.** The commands run on this machine's sandbox. A remote worker on another OS, with other limits and other process-group behaviour, is not exercised, and nothing here measures throughput.

Those need the real deployment tests named in `docs/deployment-and-portability.md` (slices 6a to 6d).
