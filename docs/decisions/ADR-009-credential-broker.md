# ADR-009: Resolve credentials through a broker port over existing stores

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-30 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) needs credentials only for its own privileged steps outside the contained run: pushing a branch, opening a PR, writing to a tracker. The contained run holds none. Its environment is rebuilt without tokens, the sandbox denies reads of credential stores, and the network allowlist excludes SCM APIs ([containment.md](../containment.md#enforcement-coverage-matrix)).

The 3dmk reference system keeps secrets in HashiCorp Vault, a server that issues them at runtime by service identity and policy ([reference-system-comparison.md](../reference-system-comparison.md#component-mapping)). Four considerations bear on whether AVARICE should run a similar server:

- NFR-1 rules out an always-on server for the baseline, and AC-1 expects installation without admin rights.
- SEC-2 requires credentials from an approved provider, and the enterprise profile must not replace or bypass company secret systems ([non-goals](../requirements.md#non-goals)).
- The personal profile's secrets already live in vendor CLIs (`gh`) and the macOS Keychain.
- A server would protect secrets more strongly while stored, but the contained run already reaches none, so it would not shrink the agent's reach.

## Decision

1. `CredentialProvider` is a broker. It resolves a reference at the moment of use and stores no secret value. AVARICE runs no secrets server.
2. The accepted references are `delegated:<cli>`, `keychain:<service>` and `cmd:<approved helper>`. `env:` is not an accepted reference type in any profile. AVARICE may still pass a resolved value into the environment of one of its own privileged subprocesses; an environment variable is never a source.
3. Every resolution attempt is recorded as a `credential.resolve` event (SEC-8). The event holds the reference, the stated purpose, the calling module, the profile, the run and invocation IDs, the outcome (`resolved`, `denied`, `unavailable`) and the duration. It never holds the value, its length or any digest of it. Failed attempts are recorded too.
4. A server-backed store (Vault, OpenBao, 1Password) is added, when needed, as one more adapter behind the same port, for example `vault:<mount>/<path>#<field>` ([contracts-and-state.md](../contracts-and-state.md#credentialprovider)). It must emit the same event. Until then, Vault is reachable through `cmd:` with an approved helper such as `vault kv get -field=<field> <path>`.

## Consequences

**Positive:**
- No service to run, unseal or back up.
- Enterprise profiles use the company's own broker or vault unchanged.
- Secrets are never copied into an AVARICE store.
- Every lookup is visible in `avarice export --events` and in the audit sink.

**Negative:**
- Rotation, versioning and storage strength vary by underlying store.
- There is no per-identity policy beyond "the agent gets nothing; privileged steps get what the contract names".
- No dynamic, short-lived credentials.
- The local event log detects casual edits but not a deliberate rewrite ([operations-and-testing.md](../operations-and-testing.md#observability)), so its audit is weaker than Vault's.
- Tokens kept in environment variables must live in the Keychain or behind a `cmd:` helper instead; a profile that references `env:` fails `doctor`.

**Neutral:** On Linux the `keychain:` type needs a Secret Service backend, which is unspecified until Linux becomes a supported platform.

## Alternatives considered

**Run a secrets server (Vault or OpenBao) for every profile** - For: encrypted storage, per-identity policy, leases, rotation and a built-in audit log; the same service names on every host, as in 3dmk. Against: an always-on service on day one; admin and bootstrap steps; a second store competing with company systems; every secret copied into it. Why not chosen: violates NFR-1 and the enterprise rule, with no reduction in what the agent can reach.

**An encrypted secrets file inside AVARICE (for example `age`)** - For: no server, one portable file. Against: AVARICE would own key management and encryption, and every secret would be copied again. Why not chosen: a new store with weaker guarantees than the Keychain it would duplicate.

**Accept `env:` in personal profiles** - For: convenient for tools that read tokens only from the environment. Against: environment variables leak to child processes, crash reports and shell history, which is the `.env` pattern 3dmk's author warns against. Why not chosen: decision 2 covers those tools by injecting a resolved value into one subprocess.

## Revisit when

- The personal-extended profile has more than one machine or a remote worker that needs the same secrets ([deployment-and-portability.md](../deployment-and-portability.md#migration-matrix)).
- An employer mandates Vault or another server-backed store.
- A workflow needs dynamic, short-lived credentials.

## References

- [contracts-and-state.md](../contracts-and-state.md#credentialprovider)
- [enterprise-adaptation.md](../enterprise-adaptation.md)
- [reference-system-comparison.md](../reference-system-comparison.md)
- https://3dmk.com/ (chapter 12, Vault)
