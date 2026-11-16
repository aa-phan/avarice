---
phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili
plan: 05
subsystem: policy
tags: [policy, action-classification, precedence, sec-4, sec-7, fr-12, fr-14, typescript]

requires:
  - phase: 01
    provides: "Result type, safe git (runGit), profile config read discipline (O_NOFOLLOW, regular file, 64 KiB), SEC-5 non-configurable TLS, authentication and egress rules"
  - phase: 04-04
    provides: "ProfileClass and the profile name grammar (src/domain/profile.ts)"
provides:
  - "One action classification table: read, local-write, privileged; a name outside the table is privileged (src/domain/action-class.ts)"
  - "The four-rank policy evaluator with enterprise add-only rules, a fail-closed rank 1 and fixed SEC-5 rules (src/domain/policy.ts)"
  - "A closed policySources() constructor that accepts only the profile class and the three parsed policy files (FR-14)"
  - "Organization policy file reader and repository policy reader from git objects at the pin (src/adapters/fs/policy-sources.ts)"
  - "The reserved acme organization fixture package and an SEC-7 footprint guard"
affects: [04-16, 04-19, 04-21, 04-37]

actuals:
  tokens: 22000
  tasks: 3
  commits: 5
plan_head_before: 7626b9175cff7886199c01734453d49a735b08e6
plan_head_after: 6284e8b4613325bc1d9a553c93d8a353a249d89e
commits: 5

tech-stack:
  added: []
  patterns:
    - "A parsed policy file is frozen and remembers the source it was parsed as in a WeakMap; the evaluator and policySources accept a file only in the field of its own source"
    - "Repository policy read with ls-tree and cat-file at a full SHA pin; a symbolic link, submodule or oversized entry is refused"
    - "Footprint guard reads the git working set (tracked plus new, not ignored) so an employer name is caught before it is committed"

key-files:
  created:
    - src/domain/action-class.ts
    - src/domain/policy.ts
    - src/adapters/fs/policy-sources.ts
    - test/fixtures/org-acme/policy.json
    - test/fixtures/org-acme/policy-invalid.json
    - test/fixtures/org-acme/config.json
    - test/unit/action-class.test.ts
    - test/unit/policy-precedence.test.ts
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-05-red-task1.json
    - .planning/phases/04-profiles-retrieval-budgets-restricted-mode-and-the-portabili/04-05-red-task2.json
  modified:
    - test/unit/footprint.test.ts

key-decisions:
  - "evaluatePolicy answers by rank: a fixed SEC-5 rule, then a broken rank 1 (deny every privileged action), then a rule the organization states (never loosened), then the built-in rule, which a personal-profile user rule may replace; ranks 3 and 4 afterwards only replace the answer with a stricter one, and the repository never loosens in any profile"
  - "PolicySources.organization has three states: left out (no organization policy applies), 'absent' (a file was expected and is missing; denies privileged actions under an enterprise profile) and a read result (an error result denies privileged actions under any profile)"
  - "The SEC-5 rules are built-in fixed deny rules on three new privileged actions (net.insecure-transport, net.unauthenticated, net.egress-unlisted) with ids sec5.tls, sec5.authentication and sec5.egress; the ids prefixed builtin. and sec5., and org.invalid-or-missing, are reserved and refused in any file"
  - "A policy file that was not produced by parsePolicyFile for its own source is unusable: at rank 1 it counts as a broken file, at ranks 3 and 4 as absent"
  - "approvalSource is accepted only on a require-approval rule; rule when conditions match by string equality, so a parameter the caller omits means the rule does not apply (callers must pass the parameters a rule names)"

patterns-established:
  - "Pure domain policy modules import only from ./ and take the profile class as data, not the profile name"
  - "Fixture organization package under test/fixtures/org-acme with reserved names only (acme, example.com)"

requirements-completed: [FR-12, SEC-4, SEC-7, FR-14]

coverage:
  - id: D1
    description: "Every action is classed read, local-write or privileged in one frozen table; a name absent from it is privileged"
    requirement: FR-12
    verification:
      - kind: unit
        ref: "test/unit/action-class.test.ts#ACTION_CLASSES (FR-12)"
        status: pass
      - kind: unit
        ref: "test/unit/action-class.test.ts#classifyAction"
        status: pass
    human_judgment: false
  - id: D2
    description: "Policy precedence is organization, built-in, user, repository; within a rank the most restrictive effect wins; a rank-1 deny is never loosened"
    requirement: SEC-4
    verification:
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#tracer: git.push is privileged and the organization deny wins over a user allow"
        status: pass
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#loosening rules (SEC-4)"
        status: pass
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#a rule applies by action and by exact parameter values"
        status: pass
    human_judgment: false
  - id: D3
    description: "Under an enterprise profile ranks 3 and 4 only restrict; under a personal profile the user may loosen the built-in defaults except the SEC-5 rules"
    requirement: SEC-4
    verification:
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#loosening rules (SEC-4)"
        status: pass
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#the built-in defaults (rank 2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A missing, unreadable or invalid rank-1 file under an enterprise profile makes every privileged action deny; read and local-write still allow"
    requirement: SEC-4
    verification:
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#an invalid or missing rank-1 file (SEC-4, D-17)"
        status: pass
    human_judgment: false
  - id: D5
    description: "The evaluator accepts only the four declared sources; retrieved text cannot be supplied as a policy source"
    requirement: FR-14
    verification:
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#the evaluator accepts only the four declared sources (FR-14)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The organization file reader refuses links, non-regular and oversized files; the repository policy is read from git objects at the pin and ignores working-tree edits"
    requirement: SEC-4
    verification:
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#readOrganizationPolicy"
        status: pass
      - kind: unit
        ref: "test/unit/policy-precedence.test.ts#readRepositoryPolicy reads git objects at the pin"
        status: pass
    human_judgment: false
  - id: D7
    description: "The fixture organization package uses only reserved names and a footprint guard fails on an employer profile name or host outside test/fixtures"
    requirement: SEC-7
    verification:
      - kind: unit
        ref: "test/unit/footprint.test.ts#employer configuration stays outside the distribution (SEC-7)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-16
status: complete
---

# Phase 4 Plan 05: Action classification and the policy model Summary

**Every action is classed read, local-write or privileged in one table, and a four-rank evaluator (organization, built-in, user, repository) decides allow, deny or require-approval with enterprise add-only rules, a fail-closed organization file and fixed SEC-5 denials, behind a footprint guard that keeps employer names and hosts out of the repository**

## Performance

- **Duration:** 12 min
- **Started:** 2026-11-16T18:47:00Z
- **Completed:** 2026-11-16T18:59:00Z
- **Tasks:** 3
- **Files modified:** 11 (10 created, 1 modified)

## Accomplishments

- `src/domain/action-class.ts` holds the frozen `ACTION_CLASSES` table (three read, four local-write, fourteen privileged actions) and `classifyAction`, which answers privileged for any name outside the table, including `constructor` and `__proto__`.
- `src/domain/policy.ts` parses policy files by hand (unknown keys, effects and reserved ids refused, at most 256 rules, `when` by string equality) and evaluates an action: a fixed SEC-5 deny first; then a broken rank 1 denies every privileged action with `org.invalid-or-missing`; then a rule the organization states decides and no lower rank loosens it; otherwise the built-in rule decides and, under a personal profile, a user rule may replace it. Ranks 3 and 4 afterwards only replace the answer with a stricter one, and the repository never loosens in either profile. Within a rank deny beats require-approval beats allow.
- `policySources()` is the one way to build `PolicySources` from values of unknown type: any field other than `profileClass`, `organization`, `user` and `repository` is refused, and each file must be what `parsePolicyFile` returned for that source. Brief, context item, tool output and model output text has no field and the evaluator has no parameter for it; the test shows policy-shaped text in a parameter value or action name changes nothing.
- `src/adapters/fs/policy-sources.ts` reads the organization file (no symbolic link, regular file, at most 64 KiB) and the repository's `.avarice/policy.json` from the pinned tree with `ls-tree` and `cat-file`, so an uncommitted or untracked edit never counts; a link, submodule or oversized entry is refused.
- The `test/fixtures/org-acme` package (policy, an invalid policy, an enterprise-acme profile config) uses only `acme` and `example.com`, and the footprint test fails on any other `enterprise-<org>` name or off-list host outside `test/fixtures`.

## Task Commits

1. **Task 1: tracer, `git.push` is privileged and the organization's rank-1 deny wins over a user allow** (RED 3 of 3 failing, `RED_EVIDENCE_OK`)
   - `de14106` test: failing tracer cases, skeleton modules, acme policy fixture, `04-05-red-task1.json`
   - `a1e2614` feat: classification table, policy parser, evaluator for organization and built-in ranks
2. **Task 2: loosening rules, the invalid rank-1 deny, policy source adapters and the FR-14 whitelist** (RED 29 of 85 failing, `RED_EVIDENCE_OK`)
   - `25b2abd` test: failing precedence, invalid rank-1, source and reader tests, `04-05-red-task2.json`
   - `613c2d8` feat: ranks 3 and 4, fixed SEC-5 rules, `policySources`, both readers
3. **Task 3: SEC-7 footprint guard**
   - `6284e8b` test: three guard tests and a control

**Plan metadata:** the commit that adds this summary, then the state and roadmap commit.

## TDD Gate Compliance

Both TDD tasks have a `test(04-05)` commit before the `feat(04-05)` commit.

- Task 1 RED: the three tracer tests fail on assertions against skeleton modules that export the planned names with no behavior (the evaluator answers `allow/skeleton`; `classifyAction` answers privileged for everything). The classifier returned `RED_EVIDENCE_OK` (`target_test_failed`, TAP). Semantic assessment: the target test ran and failed on the planned `deepEqual` of the decision; no import, syntax or fixture fault.
- Task 2 RED: 29 of 85 cases fail. The target, "lets a personal profile user rule allow loosen the built-in require-approval", failed on the planned decision comparison. The 56 passing cases are the tracer and the whole of `action-class.test.ts`, which pass at RED because the table already exists from Task 1. The classifier returned `RED_EVIDENCE_OK`.
- Task 3 is `type="auto"` without `tdd`; its guard was proven by the control cases and by the plan's temporary-file check below.

Tracer gate: the tracer `<verify>` command passed on the proven slice (3 of 3) before Task 2 began, so the plan expanded.

## Footprint guard check (Task 3 acceptance)

A temporary file `src/zz-footprint-probe.ts` containing `enterprise-megacorp` and `https://git.megacorp.com/x` made two footprint tests fail (the profile-name test and the host test, each naming the file); the file was then deleted and the tests passed again (32 of 32). It was never staged or committed.

## Files Created/Modified

- `src/domain/action-class.ts` - `ActionClass`, `ACTION_CLASSES`, `classifyAction`
- `src/domain/policy.ts` - `PolicyRule`, `PolicyFile`, `PolicySources`, `BUILTIN_POLICY`, `parsePolicyFile`, `parsedAs`, `policySources`, `evaluatePolicy`, `INVALID_ORGANIZATION_RULE_ID`
- `src/adapters/fs/policy-sources.ts` - `readOrganizationPolicy`, `readRepositoryPolicy`
- `test/fixtures/org-acme/policy.json`, `policy-invalid.json`, `config.json` - reserved acme organization package
- `test/unit/action-class.test.ts`, `test/unit/policy-precedence.test.ts` - 85 cases
- `test/unit/footprint.test.ts` - SEC-7 describe block with four tests
- `04-05-red-task1.json`, `04-05-red-task2.json` - RED evidence records

## Decisions Made

See `key-decisions`. In short: rank 1 is judged before everything but the SEC-5 rules; `organization` left out means no organization policy applies while `'absent'` means a file was expected and is missing, so the caller (the profile config reader of a later plan) decides which to pass; an unusable file fails closed at rank 1 and is absent at ranks 3 and 4.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] RED needed skeleton modules so the test file loads**
- **Found during:** Task 1 and Task 2
- **Issue:** A test importing modules that do not exist is a load failure, which the RED classifier rejects as `INVALID_RED`.
- **Fix:** The RED commits carry skeleton exports (`classifyAction`, `evaluatePolicy`, `parsePolicyFile`, `policySources`, both readers) with no behavior; the feat commits replace them.
- **Files modified:** src/domain/action-class.ts, src/domain/policy.ts, src/adapters/fs/policy-sources.ts
- **Verification:** `RED_EVIDENCE_OK` for both records
- **Committed in:** de14106, 25b2abd

**2. [Rule 2 - Missing critical] SEC-5 rules made concrete**
- **Found during:** Task 1
- **Issue:** The plan says a personal user may loosen rank 2 "except the SEC-5 rules" but defines no SEC-5 rule or action to protect.
- **Fix:** Three privileged actions (`net.insecure-transport`, `net.unauthenticated`, `net.egress-unlisted`) with built-in fixed deny rules (`sec5.tls`, `sec5.authentication`, `sec5.egress`) that no rank changes; ids with the `builtin.` or `sec5.` prefix and `org.invalid-or-missing` are refused in any file, which also covers "a user rule that names a SEC-5 rule id is refused at parse".
- **Files modified:** src/domain/action-class.ts, src/domain/policy.ts
- **Verification:** `test/unit/policy-precedence.test.ts#the built-in defaults (rank 2)` and `#parsePolicyFile`
- **Committed in:** a1e2614

**3. [Rule 3 - Blocking] Footprint allowlists extended for literals already in the tree**
- **Found during:** Task 3
- **Issue:** The plan's allowlists (acme only; github.com, api.github.com, registry.npmjs.org, code.claude.com, docs.anthropic.com, localhost, 127.0.0.1, example.com) would fail on content that predates this plan: `docs/enterprise-adaptation.md` and grammar-test names (`enterprise-other`, `enterprise-a1-b2`, `enterprise-0`, `enterprise-ac`, `enterprise--acme`), and hosts under reserved TLDs (`.test`, `.invalid`, `.example`, `.internal`), the owner's portfolio site `aa-phan.github.io`, the plist DTD host `www.apple.com` and the look-alike `githubXexample.com` of a remote pattern test.
- **Fix:** Explicit allowlists with a comment for each group; `test/fixtures` is skipped by the name and host tests (the org-acme package has its own stricter test), and the scan reads tracked plus new, not ignored files so a file is caught before it is committed.
- **Files modified:** test/unit/footprint.test.ts
- **Verification:** `node --test test/unit/footprint.test.ts` 32 of 32; the megacorp probe fails it
- **Committed in:** 6284e8b

**4. [Rule 3 - Blocking] A second RED record**
- **Found during:** Task 2
- **Issue:** The plan lists only `04-05-red-task1.json`; Task 2 is also TDD and its RED must be machine-validated.
- **Fix:** Added `04-05-red-task2.json`.
- **Committed in:** 25b2abd

---

**Total deviations:** 4 auto-fixed (1 missing critical, 3 blocking). **Impact on plan:** No change of scope; the SEC-5 rules and the allowlists make the plan's own statements testable against the tree as it is.

## Issues Encountered

- `when` conditions match by string equality and a parameter the caller omits means the rule does not apply, so a deny with `when: { branch: protected }` does nothing for a caller that never passes `branch`. The plan names string equality only; callers (plans 04-16, 04-19, 04-21) must pass every parameter an organization rule is likely to name.
- `SEC-4`, `SEC-7`, `FR-12` and `FR-14` are declared by sibling plans of this phase, so `requirements.ready-ids` may mark none ready until the last declaring plan finishes.

## Documentation surfaces (for plan 04-37)

- Action classification table: the read, local-write and privileged actions (including the three SEC-5 actions), deny by default for a name not in the table
- Policy file shape at `schema: 1`: `rules[]` of `id`, `action`, `when` (string equality, 1 to 8 keys), `effect` (`allow`, `deny`, `require-approval`), `approvalSource` (only on require-approval); at most 256 rules, 64 KiB; unknown keys refused
- Reserved rule ids: prefixes `builtin.` and `sec5.`, and `org.invalid-or-missing`
- Built-in rule ids: `builtin.read-allowed`, `builtin.local-write-allowed`, `builtin.privileged-needs-approval`, `sec5.tls`, `sec5.authentication`, `sec5.egress`
- Precedence: organization file (rank 1), built-in defaults (rank 2), user profile policy (rank 3), repository `.avarice/policy.json` at the pin (rank 4); most restrictive effect within a rank; enterprise ranks 3 and 4 add restrictions only; personal rank 3 may loosen rank 2 except SEC-5; the repository never loosens; a rank-1 stated rule is never loosened
- Organization file states: left out, `'absent'`, read result; an absent file under an enterprise profile and an invalid file under any profile deny every privileged action with `org.invalid-or-missing`
- Repository policy: read from git objects at the pin, never the working tree; a symbolic link, submodule or file over 64 KiB at `.avarice/policy.json` is refused
- Organization file read: opened without following a link, regular file, at most 64 KiB
- Profile config keys read by later plans: `policy.organizationFile` (relative to the config directory in the fixture), `remotePatterns`
- Footprint guard (SEC-7): reserved names `acme` and `example.com`; the host allowlist in `test/unit/footprint.test.ts`

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-04-10 (a repository or user rule loosening an organization rule: rank order and the enterprise add-only rule, tested), T-04-11 (a missing or corrupt rank-1 file read as permissive: deny of every privileged action, tested for absent, invalid and unparsed values), T-04-12 (injected text as policy: closed `policySources`, brand check, no evaluator parameter, tested) and T-04-13 (employer data committed: footprint guard) are mitigated. No package was installed (T-04-SC).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plans 04-16 (approval gate), 04-19 (hook) and 04-21 (promotion) can call `evaluatePolicy` with sources built by `policySources`. The profile config reader that reads `policy.organizationFile` is a later plan's work and decides between leaving `organization` out and passing `'absent'`.

## Self-Check: PASSED

- Files present: all ten created files and the modified footprint test
- Commits present on this branch: de14106, a1e2614, 25b2abd, 613c2d8, 6284e8b; `check evaluation-scope --plan 04-05 --commits-only` resolved with the plan's commits
- Plan verification: `node --test test/unit/policy-precedence.test.ts test/unit/action-class.test.ts test/unit/footprint.test.ts` green, `npm run typecheck` clean, `npm run check:boundaries` ok (102 files), `grep -n "from '\.\./" src/domain/policy.ts src/domain/action-class.ts` prints nothing; full unit suite 2444 of 2444 passing

---
*Phase: 04-profiles-retrieval-budgets-restricted-mode-and-the-portabili*
*Completed: 2026-11-16*
