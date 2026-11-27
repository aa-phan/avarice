---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 18
subsystem: security
tags: [redaction, transcript, retention, artifacts, sec-3, d-14, typescript]

requires:
  - phase: 04-07
    provides: "Redactor and processRedactor, the one process redactor"
  - phase: 04-08
    provides: "the raw retention section of the profile config (AppDeps.profile.config.sections.retention)"
  - phase: 04-15
    provides: "composition that parses its profile sections before a store is opened"
provides:
  - "TranscriptCollector: each complete host stdout line is redacted before it is counted against the cap, and the cap cuts at a line boundary (src/adapters/host-claude/transcript-collector.ts)"
  - "A default invocation keeps a transcript-summary artifact and the SHA-256 digest of the redacted transcript; the whole redacted transcript is stored only for retention.transcripts full or AVARICE_DEBUG_TRANSCRIPTS=1"
  - "parseRetentionSection, TranscriptRetention (src/domain/redactor.ts)"
  - "RedactingArtifactStore and REDACTED_TEXT_KINDS, wrapped around the local store by composition (src/adapters/fs/redacting-artifact-store.ts)"
affects: [04-22, 04-27, 04-37, 04-38, 04-39]

actuals:
  tokens: 16100
  tasks: 3
  commits: 5
plan_head_before: 2cf4dbef5c492890ee67407d6b7bd842851073bc
plan_head_after: 0a7cb325a128a91bbf01a2602fc09858746c7f03
commits: 5

tech-stack:
  added: []
  patterns:
    - "Redact each line before counting it against a cap, so a cap can never split a secret"
    - "Compose a decorator over a port at the composition root (RedactingArtifactStore over LocalArtifactStore), so no writer can skip redaction"
    - "A source-scan test lists every artifact kind passed to artifacts.put and fails when a kind is neither a map kind nor in REDACTED_TEXT_KINDS"

key-files:
  created:
    - src/adapters/host-claude/transcript-collector.ts
    - src/adapters/fs/redacting-artifact-store.ts
    - test/integration/transcript-retention.test.ts
    - test/integration/artifact-redaction.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-18-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-18-red-task2.json
  modified:
    - src/adapters/host-claude/claude-host.ts
    - src/adapters/host-claude/stream-json.ts
    - src/app/invocation.ts
    - src/ports/agent-host.ts
    - src/domain/redactor.ts
    - src/cli/composition.ts
    - test/helpers/live-harness.ts
    - test/integration/claude-host.test.ts

key-decisions:
  - "The cap counts redacted bytes and cuts at a line boundary: the first line that does not fit, redacted, ends the kept text; a line longer than the whole cap ends it too"
  - "The summary and the digest are always produced; the whole transcript is stored only on an explicit opt-in (profile retention.transcripts full, or AVARICE_DEBUG_TRANSCRIPTS=1)"
  - "The debug variable is read by the adapter from its own env (default: the process env), unless the debugTranscripts option says otherwise; composition passes the profile value as `transcripts`"
  - "RedactingArtifactStore redacts only the kinds in REDACTED_TEXT_KINDS and only valid UTF-8; the map kinds, non-UTF-8 payloads and unlisted kinds are stored as given"

patterns-established:
  - "The parser keeps tool-use counts by name and nothing of the tool input"

requirements-completed: [SEC-3]

coverage:
  - id: D1
    description: "A token the 20 MiB cap would split is stored as [REDACTED:github-token] on a whole line, no 9-character part of it is stored, and a line that does not fit even redacted is dropped whole"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#redacts a token that the cap would split, and keeps the line it belonged to when the redacted line fits"
        status: pass
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#cuts at a line boundary: a line that does not fit even redacted is dropped whole"
        status: pass
    human_judgment: false
  - id: D2
    description: "By default an invocation stores a transcript-summary (turns, cost, tool-use counts, capped result text, session ID) and records the digest of the redacted transcript; invocation.finished still carries its counts and cost; the transcript is stored for AVARICE_DEBUG_TRANSCRIPTS=1 or retention.transcripts full"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#by default keeps a transcript-summary and the digest of the redacted transcript, and no transcript; the invocation still finishes with its counts"
        status: pass
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#with AVARICE_DEBUG_TRANSCRIPTS=1 stores the redacted transcript too, under the same digest"
        status: pass
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#profile retention (D-14)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every listed text artifact kind is redacted before it is stored and the stored digest is of the redacted bytes; map documents and snapshots stay byte for byte; composition builds the redacting store; a source scan covers every kind the code stores"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/artifact-redaction.test.ts"
        status: pass
    human_judgment: false
  - id: D4
    description: "A retention.transcripts value other than summary or full is refused at composition, naming the key"
    requirement: SEC-3
    verification:
      - kind: integration
        ref: "test/integration/transcript-retention.test.ts#refuses a retention.transcripts value that is not summary or full, naming the key, before a store is opened"
        status: pass
    human_judgment: false

duration: 30min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 18: Transcript and Artifact Redaction Boundaries Summary

**The host transcript is redacted line by line before the 20 MiB cap counts it, a run keeps a redacted summary plus the digest of the redacted transcript by default (the whole transcript only on opt-in), and a redacting decorator over the artifact store redacts every listed text kind before it is stored.**

## Performance

- **Duration:** about 30 min
- **Tasks:** 3 (one tracer, two auto)
- **Files modified:** 14 (8 source and helper files, 4 test files, 2 RED evidence records)

## Accomplishments

- `TranscriptCollector` redacts each newline-terminated line with the process redactor, counts the redacted bytes against the cap and cuts at a line boundary, so a secret split by the cap is never stored. A token whose raw bytes straddle the cap is stored as `[REDACTED:github-token]` when its redacted line fits, and the line is dropped whole when it does not. The old `redactSecrets(ran.transcript)` after the cap is gone. This closes the claude-host findings for lines 75 and 217 of the transcript path.
- The outcome now carries `transcriptDigest` (SHA-256 of the redacted transcript) and `transcriptSummaryArtifact`; `transcriptArtifact` is present only when the whole transcript was stored. The summary JSON holds `sessionId`, `turns`, `costUsd`, `toolUses` by tool name and the capped `resultText`. Status, pause and `invocation.finished` work from the parsed result in both modes. The step result names `transcriptDigest` and `transcriptSummary`; the event carries `transcriptDigest`; both artifacts are recorded in the ledger (`transcript-summary` is a new kind).
- `parseRetentionSection` reads `retention.transcripts` (`summary` default, `full`); composition refuses any other value naming `retention.transcripts`, before a store is opened.
- `RedactingArtifactStore` wraps `LocalArtifactStore` in composition. A source-scan test enumerates every `artifacts.put` call site and fails when a kind is neither a map kind nor in `REDACTED_TEXT_KINDS`.
- The live harness sets `AVARICE_DEBUG_TRANSCRIPTS=1` at module scope; the harness builds every environment from `process.env` and both exit tools import it, so live verdicts and the exit tools still read whole transcripts.

## TDD record

- **Task 1 RED:** `test/integration/transcript-retention.test.ts` (four in-process onboardings through the real adapter and a fake claude). All four failed on the planned assertions (marker for the split token, whole lines, summary-only default, digest on the step result). `RED_EVIDENCE_OK` (`04-18-red-task1.json`, a single-target run). Commit `d479bc6`.
- **Task 1 GREEN:** `0b9bbce`. The tracer gate (auto mode) re-ran the tracer verify: green.
- **Task 2 RED:** `test/integration/artifact-redaction.test.ts` against a skeleton `RedactingArtifactStore` (identity behavior, empty kind list). The target failed on the digest assertion; the kind-list, source-scan and composition cases failed on their planned assertions. `RED_EVIDENCE_OK` (`04-18-red-task2.json`). Commit `85962c9`.
- **Task 2 GREEN:** `207a85b`.
- **Task 3 (not TDD):** `0a7cb32` adds the profile-retention cases and the live-harness opt-in.
- No REFACTOR commit.

## Task Commits

1. **Task 1: tracer** - `d479bc6` (test), `0b9bbce` (feat)
2. **Task 2: redacting artifact store** - `85962c9` (test), `207a85b` (feat)
3. **Task 3: retention opt-in, live harness** - `0a7cb32` (test)

## Decisions Made

See `key-decisions`. The decisions that go past the plan's wording are listed under "Decisions needing owner review".

## Deviations from Plan

**1. [Process] The RED evidence records are single-target runs**
- **Found during:** Tasks 1 and 2
- **Issue:** the full-file TAP report holds whitespace-only diff lines (from `deepEqual` failures) that the RED classifier reads as non-TAP data, so it returned `INVALID_RED (invalid_record)`.
- **Fix:** each record is the real run of the target test alone (`--test-name-pattern`), which the classifier accepts. The full-file runs failed the same tests on their planned assertions; the record's `semanticAssessment` says so.

**2. [Rule 1 - Bug] Two existing tests read a transcript artifact that a default run no longer stores**
- **Found during:** Task 1
- **Issue:** `test/integration/claude-host.test.ts` reads `kind = 'transcript'` in the redaction test and the cap test.
- **Fix:** the first onboards with `AVARICE_DEBUG_TRANSCRIPTS=1`; the second builds the adapter with `debugTranscripts: true`. Their assertions are unchanged.
- **Files modified:** test/integration/claude-host.test.ts
- **Commit:** `0b9bbce`

**3. [Plan wording] The parser counts tool uses**
- **Found during:** Task 1
- **Issue:** the summary needs tool-use counts by name, which `StreamJsonParser` did not keep.
- **Fix:** `ParsedStream.toolUses` (at most 64 names, the rest under `(other)`); tool input and message text are still not read.
- **Files modified:** src/adapters/host-claude/stream-json.ts
- **Commit:** `0b9bbce`

**4. [Plan wording] The debug variable reaches the adapter through its env**
- The plan says composition passes the retention value and the debug variable into the adapter options. Composition passes `transcripts` and `env`; the adapter reads `AVARICE_DEBUG_TRANSCRIPTS` from that env unless `debugTranscripts` is given. The live harness builds adapters directly with an `env`, so this one rule serves composition and the harness.

**5. [Plan wording] The composition wiring of Task 3 landed with Task 2**
- The retention parse and the `transcripts` pass-through are in the composition edit that wraps the store (`207a85b`); Task 3 added the cases that exercise them and the harness opt-in.

**6. [Process] The plan commit ledger file was not written**
- As in plan 04-07, `plan_head_before` was taken from `git rev-parse HEAD` before the first commit; `commits: 5` is `git rev-list --count` over that base.

**Total deviations:** 6, none changing the planned behavior.

## Issues Encountered

None. Run: `transcript-retention` (7 tests), `artifact-redaction` (8), the whole unit suite and the host, staging, killpoint, knowledge, check, gate, repair, ledger and run integration files related to the change: 0 failures. Typecheck and `check:boundaries` are clean. The full `npm test` is left to the orchestrator.

## Known Stubs

None.

## Decisions needing owner review

1. **Unlisted artifact kinds are stored as given (not fail-closed).** The plan lists the kinds explicitly, so a kind absent from `REDACTED_TEXT_KINDS` is stored unredacted. The source-scan test fails when code stores a kind that is neither a map kind nor listed, which forces the choice at the time the kind is added (plan 04-23's `restricted-plan`, `restricted-patch` and `restricted-decisions` will hit it). The alternative is to redact every kind except the two map kinds.
2. **Three kinds are listed before any call site stores them:** `context-pack` (named in the plan's behavior), `manual-context` and `manual-evidence` (plan 04-27's kinds). They are redacted when a later plan stores them.
3. **A line longer than the whole cap ends the transcript** without being redacted and measured (bounding memory). The plan does not say what a single over-cap line does.
4. **`transcriptBytes` is the size of the redacted transcript in every mode,** and the ledger records a `transcript` artifact only in full mode. The plan did not say whether summary mode reports a size.

## Documentation surfaces (for plans 04-38 and 04-39)

`docs/system/` exists in this checkout and was not edited here; the phase documentation plans own it. The surfaces this plan changes:

- **Profile config key `retention.transcripts`:** `summary` (default) or `full`; any other value is refused at composition naming the key (exit as for the credentials section). Candidate home: `config-reference.md`.
- **Environment variable `AVARICE_DEBUG_TRANSCRIPTS=1`:** stores the whole redacted transcript of every invocation. Candidate homes: `config-reference.md`, `containment.md` "Secret redaction".
- **Artifact kinds:** new `transcript-summary` (JSON: `sessionId`, `turns`, `costUsd`, `toolUses`, `resultText`); `transcript` is now optional. Candidate home: `data-model.md` artifact kinds.
- **Step result and event fields:** the launch step result names `transcriptDigest` and `transcriptSummary` (and `transcript` only in full mode); `invocation.finished` carries `transcriptDigest`. Candidate homes: `data-model.md` events, the run-invocation document.
- **Redaction boundaries:** transcript lines are redacted before the cap and the cap cuts at a line boundary; `RedactingArtifactStore` redacts the listed kinds (`transcript`, `transcript-summary`, `check-output`, `test-inventory`, `knowledge-manifest`, `gsd-quick-record`, `context-pack`, `manual-context`, `manual-evidence`) and valid UTF-8 only; map documents and snapshots are stored as given because validation already refuses a map with a secret hit. Candidate home: `containment.md` "Secret redaction".
- **Closed findings:** the transcript-path findings at `claude-host.ts` lines 75 and 217 (a secret split by the cap; whole transcripts always kept). Update `findings.md` if they are recorded there.
- **Limits to record:** a multi-line secret (a PEM block spread over several raw lines) is matched per line; the transcript digest is of the line-wise redaction, and the artifact store's second pass over the whole text is a no-op for every current pattern; the exit tools and live harness need `AVARICE_DEBUG_TRANSCRIPTS=1` (the harness sets it).

## Threat Flags

None. The new artifact kind adds no network, auth or file surface; the threats T-04-47, T-04-48 and T-04-49 are mitigated as planned.

## Next Phase Readiness

- Plan 04-22's redaction suite can assert 0 secret patterns in transcripts and text artifacts.
- Plan 04-23 and plan 04-27 must add their new artifact kinds to `REDACTED_TEXT_KINDS` (or decide they are not redacted); the source-scan test fails until they do.

## Self-Check: PASSED

- Files exist: `src/adapters/fs/redacting-artifact-store.ts`, `src/adapters/host-claude/transcript-collector.ts`, `test/integration/transcript-retention.test.ts`, `test/integration/artifact-redaction.test.ts`, both RED records.
- Commits exist: `d479bc6`, `0b9bbce`, `85962c9`, `207a85b`, `0a7cb32`.
- Acceptance: both RED records non-zero exit and `RED_EVIDENCE_OK`; `redactSecrets(ran.transcript)` appears nowhere in `claude-host.ts`; `AVARICE_DEBUG_TRANSCRIPTS` appears in `live-harness.ts`; the source scan finds every `artifacts.put` kind in the list or the two map kinds; typecheck and boundaries clean.

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
