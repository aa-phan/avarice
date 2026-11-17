---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 15
subsystem: security
tags: [credentials, broker, keychain, secrets, redaction, sec-2, d-17, adr-009, typescript]

requires:
  - phase: 04-07
    provides: "processRedactor and seedProcessRedactor, MIN_SEEDED_SECRET_LENGTH (the seeded literal a resolved credential becomes)"
  - phase: 04-08
    provides: "AppDeps.profile.class and .config.sections.credentials (the raw section this plan parses)"
  - phase: 04-12
    provides: "children keep their profile; the executor and composition shape this plan extends"
provides:
  - "parseCredentialRef, PROVIDERS_BY_CLASS, providersFor, parseCredentialSection: the reference grammar with the env refusal, the per-profile provider allow-list and the credentials config section (src/domain/credential-ref.ts)"
  - "CredentialProvider and SecretHandle: the broker port, a handle whose value exists only inside use(fn) (src/ports/credential-provider.ts)"
  - "KeychainProvider, CmdProvider, DelegatedProvider (src/adapters/credential/)"
  - "resolveCredential: one value-free credential.resolve event per attempt (src/app/credentials.ts)"
  - "AppDeps.credentials, composed from the providers the profile class allows; an env: reference fails composition with exit 70"
affects: [04-22, 04-25, 04-37, 04-38]

actuals:
  tokens: 19000
  tasks: 3
  commits: 5
plan_head_before: 7a452e28409efe091d9fcede5bf8959ffb30c6a7
plan_head_after: 41e9a92afc0dcac89f6fe7ec13e60e202d7975d9
commits: 5

tech-stack:
  added: []
  patterns:
    - "A handle keeps its value in a private field and answers every string, JSON and inspect form with a fixed placeholder"
    - "A provider calls an onResolved hook (default: seed the process redactor) before it builds the handle, so a value too short to redact is refused rather than handed out"
    - "An audit event is recorded before the value is returned, and a failure to record it withholds the value (fail closed)"
    - "Skeleton-first RED: the planned exports exist with no behavior, so a RED test fails on its assertion and not on a missing import"

key-files:
  created:
    - src/domain/credential-ref.ts
    - src/ports/credential-provider.ts
    - src/adapters/credential/handle.ts
    - src/adapters/credential/keychain.ts
    - src/adapters/credential/cmd.ts
    - src/adapters/credential/delegated.ts
    - src/app/credentials.ts
    - test/unit/credential-ref.test.ts
    - test/integration/credential-broker.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-15-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-15-red-task2.json
  modified:
    - src/app/deps.ts
    - src/cli/composition.ts

key-decisions:
  - "The allow-list is keyed by three credential classes (personal-local, personal-extended, enterprise), not by ProfileClass, because the plan's own reading separates the two personal profiles"
  - "A cmd helper runs with PATH and HOME only (the scrub list), the network denied, no read or write grant, a 5 s timeout and the helper path as the whole argv"
  - "credential.resolve is recorded before the handle is returned, and an event that cannot be recorded withholds the credential"
  - "A credentials section that does not parse (an env: value, a non-reference, a relative helper path) fails composition of every non-read-only command with exit 70, before the store is opened"
  - "The delegated handle carries the CLI name and an empty value and seeds nothing; the keychain and cmd providers seed the process redactor"

patterns-established:
  - "Event data of the credential broker is exactly reference, purpose, module, profile, outcome, durationMs; run and invocation IDs ride on the event columns"

requirements-completed: [SEC-2]

coverage:
  - id: D1
    description: "A keychain:<service> reference resolves from a temporary keychain through the broker; the value reaches the caller only inside use(fn) and appears in no property, string, JSON or inspect form of the handle"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#tracer: a keychain reference resolves through the broker, records a value-free event and seeds the redactor (SEC-2, S-48)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every attempt appends one credential.resolve event with reference, purpose, module, profile, outcome and duration, run and invocation IDs on the columns, and nothing derived from the value (no length, no digest, no key that could hold one); the data root holds no byte of the value"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#tracer: a keychain reference resolves through the broker, records a value-free event and seeds the redactor (SEC-2, S-48)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A resolved value seeds the process redactor before the caller receives it (a later event holding it is stored [REDACTED:seeded]); a value under 8 characters is refused with outcome invalid"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#the cmd provider (SEC-2, T-04-38)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A cmd helper runs only when listed in credentials.helpers, by argv through the sandboxed executor with PATH and HOME alone, no network and a 5 s timeout; its stderr appears in no error or event; verified through the real SandboxedExecutor"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#the cmd provider (SEC-2, T-04-38)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The profile class decides the providers: delegated is denied under personal-local and enterprise profiles and resolves (name only, no value) under personal-extended; env: and every other scheme are refused with outcome invalid in every profile"
    requirement: SEC-2
    verification:
      - kind: unit
        ref: "test/unit/credential-ref.test.ts"
        status: pass
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#the delegated provider and the allow-list of each profile (D-17)"
        status: pass
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#references that are never a source (SEC-2, S-49)"
        status: pass
    human_judgment: false
  - id: D6
    description: "AppDeps.credentials is composed from exactly the providers the profile class allows, each recorded in adapter_configs without a secret; a profile config holding env:GITHUB_TOKEN makes avarice start exit 70 naming it, with no run row and no event created"
    requirement: SEC-2
    verification:
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#AppDeps.credentials in composition (SEC-2, D-17)"
        status: pass
      - kind: integration
        ref: "test/integration/credential-broker.test.ts#a profile with an env reference cannot start a run (S-49, T-04-39)"
        status: pass
    human_judgment: false

duration: 9min
completed: 2026-11-17
status: complete
---

# Phase 4 Plan 15: Credential broker Summary

**A credential is resolved by reference (keychain, an approved cmd helper, or a delegated CLI) from the providers the profile class allows, handed over only inside SecretHandle.use(), audited by a value-free credential.resolve event, seeded into the process redactor, and an env: reference stops a command at composition with exit 70.**

## Performance

- **Duration:** 9 min (11:01 to 11:11 UTC; the unit tier took 75 s of it)
- **Tasks:** 3
- **Files:** 13 (11 created, 2 modified, excluding this summary)

## Accomplishments

- `parseCredentialRef` accepts `keychain:<service>`, `cmd:<helper name>` and `delegated:<cli>` and refuses `env:` (any case) and every other scheme, naming the reference in the reason; names are 1 to 128 of `A-Za-z0-9._-` and never all dots. The reason text of a hostile reference is stripped of control characters and capped.
- `SecretHandle` keeps the value in a private field. `JSON.stringify`, `String()`, `util.inspect` (with `showHidden`) and `Object.getOwnPropertyNames` show nothing of it.
- `KeychainProvider` runs `/usr/bin/security find-generic-password -s <service> -w` by argv with an environment of PATH and HOME and a 5 s timeout; stderr is not piped; exit 44 is `unavailable`. The service name is the only argument that varies, so no secret is in an argument list.
- `CmdProvider` denies a helper that `credentials.helpers` does not list without running anything; a listed helper runs through `deps.executor` with the helper path as the whole argv, network denied, PATH and HOME only (`HELPER_ENV_NAMES`), and its trimmed stdout is the value. A real helper script was run through the real `SandboxedExecutor` in the test.
- `DelegatedProvider` checks the CLI is an executable on PATH and returns a handle with `delegatedTo` and an empty value.
- `resolveCredential` parses, applies the class allow-list (a provider the class does not allow is `denied` even if one is wired), calls the provider, measures the duration and appends `credential.resolve` for every outcome (`resolved`, `unavailable`, `denied`, `invalid`).
- Composition parses `credentials` for non-read-only commands before the store is opened, builds only the allowed providers, records each descriptor as `credential-<provider>` in `adapter_configs`, and exposes `AppDeps.credentials.resolve`.

## Task Commits

1. **Task 1: tracer, a keychain reference resolves through the broker** (RED 4 of 4 failing, `RED_EVIDENCE_OK`)
   - `c98e65a` test: failing tracer, skeleton modules, `04-15-red-task1.json`
   - `37f04b8` feat: grammar, handle, KeychainProvider, resolveCredential
2. **Task 2: cmd and delegated providers, the allow-list and the env refusal** (RED 15 of 27 failing, `RED_EVIDENCE_OK`)
   - `42a902c` test: failing cases, skeleton providers and allow-list, `04-15-red-task2.json`
   - `9e42d9f` feat: CmdProvider, DelegatedProvider, PROVIDERS_BY_CLASS, parseCredentialSection, allow-list in resolveCredential
3. **Task 3: AppDeps.credentials in composition and the gates** (`type="auto"` without `tdd`, tests and code in one commit)
   - `41e9a92` feat: composition, S-49 refusal, composition cases

**Plan metadata:** the commit that adds this summary, STATE.md and ROADMAP.md.

## TDD Gate Compliance

Task 1 RED: the tracer test ran against skeletons (`resolveCredential` answering `internal: not implemented`); all four cases failed on the planned `result.ok` assertion, `RED_EVIDENCE_OK` (`target_test_failed`). Semantic assessment: a real temporary keychain was created and deleted, typecheck was clean, so there is no import, syntax or fixture fault.

Task 2 RED: 15 of 27 failed with `ERR_ASSERTION` (skeleton providers answered `unavailable` where `denied` or a value was planned; the skeleton allow-list permitted everything), `RED_EVIDENCE_OK`. The cases that passed in RED assert Task 1 behavior (grammar, env refusal through `resolveCredential`). No REFACTOR commit.

Tracer gate: the tracer `<verify>` (`test/integration/credential-broker.test.ts`) passed end to end on the proven slice before Task 2 expanded (4 of 4).

## Deviations from Plan

**1. [Process] The plan commit ledger file was not written**
- The sandbox refused a write to the shared git directory (as in plan 04-07), so `plan_head_before` is `git rev-parse HEAD` taken before the first commit. `commits: 5` is `git rev-list --count` over that base.

**2. [Plan wording] `PROVIDERS_BY_CLASS` is keyed by three credential classes**
- The plan names the export `PROVIDERS_BY_CLASS` but its allow-list separates personal-local from personal-extended, which `ProfileClass` (`personal | enterprise`) cannot. The keys are `personal-local`, `personal-extended` and `enterprise`; `credentialClassOf(profile)` and `providersFor(profile)` map a profile name to them.

**3. [Plan wording] No `04-15-red-task2.json` was listed in the plan; one was written**
- Task 2 carries `tdd="true"`, so its RED run was recorded and classified like Task 1's.

**4. [Rule 2 - Missing critical] `credentials.helpers` paths and credentials keys are validated**
- A helper path must be absolute with no `.`, `..`, empty segment or control character; a name or key outside the name grammar, and `__proto__` (an own key from parsed JSON), are refused. Without this a hand-edited config could name a relative helper or poison the result object.

**Total deviations:** 4 (1 process, 2 plan wording, 1 added validation). **Impact:** none on scope.

## Decisions needing owner review

1. **Provider allow-list per profile (D-17).** personal-local: keychain and cmd. personal-extended: keychain, cmd and delegated. enterprise-<org>: keychain and cmd. `env` is in no list. This is the plan's flagged "Claude's reading of D-17"; ADR-009 and contracts-and-state.md call `delegated:gh` "the default for the personal profile", which sits awkwardly with personal-local refusing it. Edit `PROVIDERS_BY_CLASS` in `src/domain/credential-ref.ts` to change it.
2. **A cmd helper has no network.** The plan says `network denied`, so a helper such as `vault kv get` that must reach a server fails with `unavailable` until the owner decides how a helper is allowed a network (a per-helper loopback or host grant would be a new policy surface). A helper also gets no read or write grant beyond the executor defaults and the real HOME, and PATH is the fixed system path, so a helper installed elsewhere must be named by absolute path (it is, in `credentials.helpers`).
3. **Fail closed on audit.** If the `credential.resolve` event cannot be appended (ledger error, or an over-long field that the log refuses), the credential is not handed out and the caller gets an `internal` error. The value was already resolved and seeded into the redactor by then. The plan did not say what to do when the audit write fails.
4. **A bad `credentials` section blocks every non-read-only command, not only `start`.** Composition parses it for all of them (the test uses `init`), so `avarice init` or `repo add` also exit 70 until the config is fixed. Read-only commands (status, context) do not read the section and still work, so the owner can diagnose.
5. **`denied` versus `unavailable`.** A provider the class forbids is `denied` whether or not one is wired; a provider the class allows but composition did not build (a hand-built `CredentialDeps`) is `unavailable`. A keychain exit other than 44 (locked, user interaction refused) is `unavailable`, not `unauthenticated`: nothing in this plan produces `unauthenticated`, and the plan did not ask for it.
6. **`helpers` is a reserved key** of the credentials section: a credential cannot be named `helpers`.
7. **The keychain `-w` value is the whole stdout minus one trailing newline;** a cmd helper's stdout is trimmed on both sides. A multi-line secret from a helper loses surrounding whitespace.

## Issues Encountered

- `security create-keychain` works in this environment with an explicit path and never touches the search list (`security list-keychains` was unchanged before and after every run). The real login keychain was not read.
- No flaky test hit. Unit tier: 2647 of 2647 pass. Related integration and fault files (profile-selection, profile-propagation, event-redaction, init, ledger-status, run-sandbox-other-profiles, migrations, skeleton, install-host): 215 of 215 pass. `credential-broker` 20 of 20 pass, 0 skipped. The full suite is the orchestrator's run.
- No cast of `AppDeps` needed changing: `credentials` is optional, so `scripts/exit-parity.ts` and the test casts still typecheck.

## Known Stubs

None. Phase 4 has no delivery step that consumes a credential; `AppDeps.credentials` is reachable and tested, and the first caller is `doctor --online` (plan 04-25) and Phase 5 delivery.

## Documentation surfaces (for plans 04-37 and 04-38)

`docs/system/` was not edited here; the phase documentation plans own it. The surfaces this plan changes:

- **References:** `keychain:<service>`, `cmd:<helper name>`, `delegated:<cli>`; name grammar `^[A-Za-z0-9._-]{1,128}$`, not all dots. `env:` (any case) and every other scheme are refused in every profile with `credential reference <ref> is refused: ...` (S-49, ADR-009 decision 2).
- **Providers and the allow-list:** personal-local keychain and cmd; personal-extended adds delegated; enterprise profiles keychain and cmd (D-17, owner review item 1). `keychain` runs `/usr/bin/security find-generic-password -s <service> -w` (exit 44 is item not found); `cmd` runs an approved helper through the sandboxed executor (argv alone, PATH and HOME only, no network, 5 s); `delegated` checks the CLI on PATH and returns a handle without a value.
- **External tool:** `/usr/bin/security` (macOS only; the keychain provider is unavailable elsewhere).
- **Event:** `credential.resolve`, level info for `resolved` and warn otherwise; data `reference`, `purpose`, `module`, `profile`, `outcome` (`resolved`, `unavailable`, `denied`, `invalid`) and `durationMs`; `run_id` and `invocation_id` in the event columns when given. Never the value, its length or a digest. Strings over 160 characters are cut.
- **Config keys:** `credentials.<name>` (a reference string), `credentials.helpers.<helper name>` (an absolute path; the allow-list of `cmd:` helpers). A config that holds an `env:` reference, a non-reference, or a bad helper path fails every non-read-only command with exit 70: `profile config credentials.<name>: credential reference env:<NAME> is refused: environment variables are not a credential source (S-49)`.
- **adapter_configs:** rows `credential-keychain`, `credential-cmd`, `credential-delegated` (port `credential`) for the providers the class allows; the cmd descriptor holds only the count of approved helpers.
- **Interfaces:** `AppDeps.credentials.resolve(ref, purpose, { module, runId?, invocationId? })`; `SecretHandle.use(fn)` is the only way to the value; the process redactor is seeded with each keychain and cmd value, so later events, history and artifacts redact it as `[REDACTED:seeded]` (a value under 8 characters is refused as `invalid`).
- **Limits to record:** the seed list is per process (a detached supervisor resolving a credential seeds its own redactor, the hook child does not); a delegated handle holds no value and seeds nothing; a cmd helper cannot reach the network (owner review item 2); the audit is a local hash-chained log, not a tamper-proof one (ADR-009).

## Threat Flags

None beyond the plan's register. T-04-37 (value in an event, artifact or log): value-free event, private-field handle, redactor seeded, data-root dump test. T-04-38 (arbitrary helper execution): listed helpers only, argv, sandboxed executor, PATH and HOME only, timeout; the unlisted case runs nothing. T-04-39 (env or unapproved provider): grammar, class allow-list and the composition refusal tested through `avarice start`. T-04-40 (secret in an argument list): the service name is the only keychain argument and the value arrives on stdout. No package was installed (T-04-SC).

## Next Phase Readiness

Plan 04-22's redaction suite can resolve a credential through `deps.credentials` and assert zero secret patterns in events and artifacts. Plan 04-25 (`doctor --online`) and Phase 5 delivery call the same broker. Plans 04-37 and 04-38 document the surfaces above.

## Self-Check: PASSED

- Files present: `src/domain/credential-ref.ts`, `src/ports/credential-provider.ts`, `src/adapters/credential/{handle,keychain,cmd,delegated}.ts`, `src/app/credentials.ts`, `test/unit/credential-ref.test.ts`, `test/integration/credential-broker.test.ts`, `04-15-red-task1.json`, `04-15-red-task2.json`
- Commits present on this branch: c98e65a, 37f04b8, 42a902c, 9e42d9f, 41e9a92
- Acceptance: `04-15-red-task1.json` has exit code 1 and `RED_EVIDENCE_OK`; the keychain test deletes its temporary keychain in a `finally` block; the cmd test asserts the helper's environment holds only `PATH` and `HOME` and none of this process's variables; every refusal case asserts the event outcome and that no value appears; the S-49 case asserts exit 70, the message naming `env:GITHUB_TOKEN` and no new run or event row
- Plan verification: `credential-ref` and `credential-broker` 47 of 47 (27 plus 20 across both runs of the files), `npm run typecheck` clean, `npm run check:boundaries` ok (113 files), unit tier 2647 of 2647

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-17*
