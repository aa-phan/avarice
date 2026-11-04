---
phase: quick-261104-nxh
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/domain/invocation-scope.ts
  - test/unit/invocation-scope.test.ts
  - docs/containment.md
autonomous: true
requirements: [CON-1]

estimate:
  tokens: 30000
  raw_tokens: 30000
  tasks: 2
  confidence: low

must_haves:
  truths:
    - "computeInvocationScope throws a TypeError whose message starts with `computeInvocationScope: workRoot must be a normalized absolute path` for every purpose when workRoot is empty (''), relative ('work', './work', 'work/', '../work'), the filesystem root or a form that trims to nothing or to it ('/', '//', '///'), not normalized ('/work//onb-1', '/work/./x', '/work/../x', '/work/.', '/work/..'), or not a string at run time (undefined, null, 42). It throws before computing any part of the scope (review WR-01)"
    - "A normalized absolute work root is accepted as before. Trailing slashes are trimmed: '/work', '/work/' and '/work///' each put '/work' last in denyRead. Dots inside a segment are fine: '/srv/a.b/..c' is kept as written. Every existing work-root test (order after the five base entries, dedupe against the data root, allowRead of staging only, no sibling re-allow) stays green"
    - "The 'cannot be called without a work root' test calls computeInvocationScope at run time with an input that has no workRoot and asserts the named TypeError by message, so `npm test` (node --test, types stripped) fails if the runtime guard is dropped. The @ts-expect-error stays, and its comment says that only `npm run typecheck` checks it (review WR-02)"
    - "Every existing caller keeps working: `npm run typecheck`, `npm run check:boundaries` and the full `npm test` pass with 0 failures (planning-time baseline: 1270 tests, 1248 pass, 0 fail, 22 skipped, before the new tests). src/app/invocation.ts is not changed"
    - "docs/containment.md states that the scope refuses a work root that is not a normalized absolute path below `/`, and why"
  artifacts:
    - path: "src/domain/invocation-scope.ts"
      provides: "Runtime work-root guard, run first in computeInvocationScope; its trimmed result is the value denied last in denyRead"
      contains: "computeInvocationScope: workRoot must be a normalized absolute path"
    - path: "test/unit/invocation-scope.test.ts"
      provides: "Rejection tests for each refused form, acceptance tests for the normalized forms, and the WR-02 runtime assertion"
      contains: "WR-01"
    - path: "docs/containment.md"
      provides: "One sentence on the work-root guard in the sandbox-settings paragraph"
      contains: "WR-01"
  key_links:
    - from: "src/app/invocation.ts prepareInvocation"
      to: "src/domain/invocation-scope.ts computeInvocationScope"
      via: "workRoot: deps.profile.workRoot, which src/adapters/fs/profile-paths.ts produces with resolve() and realpathNearest() and has already passed checkRoots (that check refuses '/', because '/' would contain the home directory)"
      pattern: "workRoot: deps.profile.workRoot"
    - from: "the work-root guard in computeInvocationScope"
      to: "InvocationScope.denyRead (last entry), then the hook's under() and the sandbox denyRead"
      via: "the guard returns the trimmed root, and that value is the one appended last to denyRead"
      pattern: "computeInvocationScope: workRoot"
---

<objective>
Close review warnings WR-01 and WR-02 from .planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md.

WR-01: `ScopeInput.workRoot` is required by type only. Today `''` reaches denyRead. So do `'//'` and `'///'`, because `trimTrailingSlashes` turns them into `''` (checked at planning time). The hook's `under(path, '')` is true for every absolute path, so the invocation silently cannot read its own GSD and skill read roots, and nothing in the denial names the cause. `'/'` has the same effect. A relative or non-normalized root fails the other way: the hook compares string prefixes against canonical paths, so a root such as `/a/../work` matches nothing, and the work-root deny silently does not apply in the hook. computeInvocationScope must refuse all of these at run time with a named error. It fails closed: the scope is never built.

WR-02: the "cannot be called without a work root" test is only an `@ts-expect-error`, which `node --test` never checks. Back it with a runtime assertion so `npm test` exercises the guard.

Purpose: the work-root deny of CON-1 (no reads of other onboardings) now holds for every value the type admits, not only the values production happens to pass.
Output: the guard in src/domain/invocation-scope.ts, its tests in test/unit/invocation-scope.test.ts, and one sentence in docs/containment.md.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
@src/domain/invocation-scope.ts
@test/unit/invocation-scope.test.ts

Facts established at planning time (2026-11-04, HEAD 72f0c10). Reuse them and do not re-derive them:
- How the domain reports bad input. Runtime conditions a user can cause return `Result` with `{ kind: 'invalid', field, reason }`: src/domain/root-rules.ts checkRoots at `avarice init`, and src/adapters/git/staging-base.ts, which refuses a relative workRoot with 'an absolute path is required'. A pure function that returns a plain value throws a built-in error that names the function when a caller breaks its invariant: src/domain/ids.ts (RangeError), src/domain/mapping.ts and src/domain/digest.ts (TypeError). These are tested with `assert.throws` in test/unit/domain-contracts.test.ts. computeInvocationScope returns a plain InvocationScope and today validates nothing. The production work root is already validated upstream, so a bad value here is a caller bug. That puts it in the throw class.
- Callers of computeInvocationScope, all checked. src/app/invocation.ts:84 passes `deps.profile.workRoot`. src/adapters/fs/profile-paths.ts builds that value as `resolve(...)`, then `realpathNearest(...)`, then checkRoots, so it is absolute, normalized, never `/`, and has no trailing slash. The tests pass `'/work'`, `'/work/'` and DATA (test/unit/invocation-scope.test.ts), `'/work'` (test/mutation/scope-and-validation.test.ts), `join(root, 'work')` over mkdtemp (test/unit/claude-settings.test.ts) and `join(fx.dir, 'work')` or `join(probe.dir, 'work')` (test/integration/hook.test.ts). test/containment/failclosed.test.ts passes `root`, which is realpathSync over mkdtemp. No other file calls it: scripts, bin, spikes and .audit-src have no call, and .mutation-test holds only run outputs. claude-settings.test.ts:263 builds its no-work-root scope by hand and does not pass `''`. The guard defined below breaks no legitimate caller.
- Trailing slashes must stay accepted: the existing test 'trims a trailing slash on the work root' passes `'/work/'`, and root-rules `strip` treats them the same way. `trimTrailingSlashes('//')` and `trimTrailingSlashes('///')` return `''`, so a raw `startsWith('/')` check, the one-liner in the review, would still let `''` through. The guard must judge the trimmed value.
- With workRoot undefined, today's code already throws a native TypeError ("Cannot read properties of undefined (reading 'length')") from `trimTrailingSlashes`. A bare `assert.throws(fn, TypeError)` therefore passes on unchanged code. Every new assertion must match the message.
- scripts/check-boundaries.ts allows a domain file to import only relative paths plus `node:crypto`. The guard uses string operations only, not `node:path`.
- Baseline: `node --test test/unit/invocation-scope.test.ts` gives 32 pass in about 0.2 s. `npm run typecheck` is clean. `npm run check:boundaries` is ok (53 files). `npm test` gives 1270 tests, 1248 pass, 0 fail, 22 skipped, in about 2 minutes.
</context>

<source_audit>
| Source | Item | Covered by |
|--------|------|------------|
| GOAL | WR-01: runtime check that workRoot is a non-empty absolute path, fail closed with a named error, with tests for '' and a relative path | Task 1 |
| GOAL | WR-02: back the type-only test with a runtime assertion that `npm test` runs | Task 1 |
| GOAL | Check every caller so the check breaks no legitimate one | Planning facts above; Task 2 runs the full suite |
| GOAL | Decide whether a trailing-slash or non-normalized workRoot is accepted or rejected | Task 1: trailing slashes accepted and trimmed; non-normalized forms rejected |
| REQ | CON-1 (the work-root deny is part of "no reads of other profiles or onboardings") | Tasks 1 and 2 |
| RESEARCH / CONTEXT | None (quick task, no research and no CONTEXT.md) | n/a |
Out of scope, as the review states: validating repoPath, dataRoot, home and stagingPath (not new outage vectors); review items IN-01 to IN-04; chaining tsc into `npm test` (the review's other WR-02 option, not chosen).
</source_audit>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1: computeInvocationScope refuses a work root that is not a normalized absolute path, and npm test checks the no-work-root call at run time (WR-01, WR-02)</name>
  <files>test/unit/invocation-scope.test.ts, src/domain/invocation-scope.ts</files>
  <behavior>
    - Empty: for each purpose of map, intel and knowledge, scopeFor(purpose, { workRoot: '' }) throws a TypeError whose message matches /^computeInvocationScope: workRoot must be a normalized absolute path/.
    - Relative: 'work', './work', 'work/' and '../work' each throw that error.
    - Filesystem root, and forms that trim to nothing or to it: '/', '//' and '///' each throw that error.
    - Not normalized: '/work//onb-1', '/work/./x', '/work/../x', '/work/.' and '/work/..' each throw that error.
    - Not a string at run time: undefined, null and 42 (cast `as never`) each throw that error, matched by message and not only by TypeError.
    - Accepted, pinning current behavior (these already pass before the fix): '/work', '/work/' and '/work///' each give denyRead.at(-1) === '/work'. '/srv/a.b/..c' gives denyRead.at(-1) === '/srv/a.b/..c'.
    - WR-02: the 'cannot be called without a work root' test passes its no-workRoot literal to computeInvocationScope inside assert.throws with the same message matcher.
  </behavior>
  <action>
RED first, per the repository's TDD convention: earlier quick tasks commit the failing test before the fix.

1. In test/unit/invocation-scope.test.ts, inside `describe('the work root (CR-02, D-GAP-01)', ...)`, add the rejection and acceptance tests listed in `<behavior>`. Use the existing `scopeFor` helper. Its `...over` spread replaces the default '/work', so `{ workRoot: undefined }` reaches the function as undefined. Name each test with "(WR-01)". Use the `assert.throws(fn, { name: 'TypeError', message: /^computeInvocationScope: workRoot must be a normalized absolute path/ })` form. Do not use a bare TypeError matcher: the native undefined.length TypeError would satisfy it on unchanged code. Loop over the three purposes at least for the empty case. A table loop over the forms in each group is fine.

2. Rewrite the test 'cannot be called without a work root (WR-03)' (currently lines 309-314). Rename it to 'cannot be called without a work root (WR-03, WR-02): the type rejects a ScopeInput that omits it, and the call throws at run time'. Keep the `@ts-expect-error WR-03: ScopeInput.workRoot is required` directive and its literal. Remove `void withoutWorkRoot;`. Then call `computeInvocationScope(withoutWorkRoot)` inside assert.throws with the same name-and-message matcher. Replace the comment with two sentences. First: the directive is checked only by `npm run typecheck`, where tsc reports an unused directive if workRoot ever becomes optional again. Second: `npm test` strips types, so the assert.throws is what node --test checks.

3. Run `node --test test/unit/invocation-scope.test.ts`. Every new rejection test and the rewritten WR-02 test must fail, either with "Missing expected exception" or with a message mismatch against the native TypeError. The acceptance tests must pass. If a rejection test passes before the guard exists, its matcher is too loose: fix the test. Commit only the test file with the message `test(261104-nxh): failing tests for a work root that is not a normalized absolute path (WR-01, WR-02)`.

GREEN:

4. In src/domain/invocation-scope.ts, add a private function, for example `checkedWorkRoot(value: unknown): string`, after the `uniqueSorted` helper. If `typeof value` is not 'string', it throws. Otherwise it trims the value with the existing `trimTrailingSlashes`. It throws unless the trimmed value starts with '/', is not exactly '/', and no segment of `trimmed.slice(1).split('/')` is '', '.' or '..'. It returns the trimmed value. Judge the trimmed value and not the raw one, because '//' trims to ''.
   - Each throw is `new TypeError(...)`. Do not add an Error subclass and do not change the return type to Result. This follows the domain's existing mechanism for a broken caller invariant in a pure function (ids.ts, mapping.ts, digest.ts, tested by domain-contracts.test.ts), and avoids changing the signature for all seven caller files. Result stays the mechanism for user-caused runtime conditions, as in root-rules checkRoots.
   - Message: `computeInvocationScope: workRoot must be a normalized absolute path below '/', got ` followed by `JSON.stringify(value)` for a string, or `a value of type ${typeof value}` otherwise. That is the same shape digest.ts uses. It avoids `String(value)`, which throws for a null-prototype object.
   - Use string operations only. The domain may import only relative paths and node:crypto (scripts/check-boundaries.ts), so do not import node:path.

5. Make `const workRoot = checkedWorkRoot(input.workRoot);` the first statement of computeInvocationScope, before the destructuring, so nothing is computed for a refused root. Delete the later `const workRoot = trimTrailingSlashes(input.workRoot);` (currently line 241). The denyRead expression, its order and its Set dedupe are otherwise unchanged.

6. Extend the comment on `ScopeInput.workRoot`. Required, and checked at run time (WR-01). An empty root or '/' would deny every read, including the read roots. A relative or non-normalized root would match no canonical path, so the deny would not apply. Either one throws a TypeError that names the field. Trailing slashes are trimmed.

7. Do not validate repoPath, dataRoot, home or stagingPath: the review scopes them out. Do not edit src/app/invocation.ts. Its workRoot is the profile value, already resolved, realpath'd and accepted by checkRoots.

8. Run the verify command. Commit the source file with the message `fix(261104-nxh): computeInvocationScope refuses a work root that is not a normalized absolute path (WR-01)`.
  </action>
  <verify>
    <automated>node --test test/unit/invocation-scope.test.ts && npm run typecheck && npm run check:boundaries</automated>
  </verify>
  <done>
- The RED commit exists and touches only the test file. At that commit the new rejection tests and the rewritten WR-02 test fail, and the acceptance tests pass.
- The fix commit makes `node --test test/unit/invocation-scope.test.ts` pass in full: 32 existing tests plus the new ones.
- `npm run typecheck` passes, which proves the @ts-expect-error directive is still used.
- `npm run check:boundaries` reports ok.
- '' , '//' , '/', relative and non-normalized roots and non-string values each throw the named TypeError. '/work', '/work/' and '/work///' are accepted as '/work'.
  </done>
</task>

<task type="auto">
  <name>Task 2: Full-suite regression over every caller, and the containment doc states the guard</name>
  <files>docs/containment.md</files>
  <action>
1. In docs/containment.md, in the sandbox-settings paragraph that begins "The settings are generated per invocation" (currently line 92), add one sentence right after the sentence about the work root holding every staging copy. It says that computeInvocationScope refuses, with a TypeError naming the field, a work root that is not a normalized absolute path below `/`. It gives the reason: an empty root or `/` would deny every read, including the GSD and skill read roots, and a relative or non-normalized root would match no canonical path, so the work-root deny would not apply. It cites review WR-01. Match the paragraph's plain declarative style. Do not touch the CON-1 table row: its misattribution is review IN-03, which is out of scope. Commit with the message `docs(261104-nxh): containment doc states the work-root guard (WR-01)`.

2. Run the full regression: `npm run typecheck` then `npm test`. The suite takes about 2 minutes. Expect 0 failures and 22 skipped. Expect the pass count to be the planning-time baseline of 1248 plus the number of tests Task 1 added. If any test fails, read its workRoot value first. Every caller was checked at planning time to pass an absolute, normalized root. A failure means either a caller this plan missed, or a guard that refuses a legitimate form, such as a trailing slash or a dot inside a segment. Fix the guard or the test, not the caller's production value. Then re-run.

3. Confirm that `git diff --stat 72f0c10 -- src/app package.json package-lock.json` is empty: no app change and no dependency change. Record in the SUMMARY the final test counts, the fact that src/app/invocation.ts is unchanged, and the reason it needs no change: its workRoot comes from profile-paths.ts resolve() and realpathNearest() and passes checkRoots.
  </action>
  <verify>
    <automated>node -e "const l=require('fs').readFileSync('docs/containment.md','utf8').split('\n').find(x=>x.startsWith('The settings are generated per invocation'));if(!l||!l.includes('WR-01')||!l.includes('normalized absolute path')){console.error('containment paragraph lacks the work-root guard');process.exit(1)}console.log('containment paragraph ok')" && test -z "$(git diff --stat 72f0c10 -- src/app package.json package-lock.json)" && npm run typecheck && npm test</automated>
  </verify>
  <done>
- The docs commit exists, and the paragraph names the guard, its reason and WR-01.
- `npm run typecheck` passes.
- `npm test` reports 0 failures and 22 skipped, with the pass count equal to 1248 plus the new tests.
- src/app, package.json and package-lock.json are unchanged since 72f0c10.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| caller (app layer or test) -> computeInvocationScope | The domain function receives every path as an unchecked string. Its type promises a work root, but at run time it received whatever the caller passed. |
| InvocationScope.denyRead -> hook under() and sandbox filesystem.denyRead | Each denyRead entry is compared as a string prefix against canonical, normalized paths. An entry that is empty, '/', relative or non-normalized changes the verdict silently. |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-nxh-01 | Denial of service | computeInvocationScope with workRoot '' , '//' , '///' or '/': denyRead then holds '' or '/', and every read outside allowRead, including the GSD and skill read roots, is denied deny-read with no cause in the output | medium | mitigate | Task 1's guard judges the trimmed value and throws a TypeError naming `computeInvocationScope: workRoot` before any scope is built. There is one test per form, for every purpose in the empty case. |
| T-nxh-02 | Information disclosure | a relative or non-normalized workRoot ('work', '/a/../work', '/work//x') matches no canonical path in the hook's under(), so the work-root deny silently does not apply and another onboarding's staging becomes readable through hook-judged tools | medium | mitigate | Task 1's guard refuses relative values and any '', '.' or '..' segment. The tests pin each form. Production cannot reach this today, because profile-paths resolves and realpaths the root. The guard keeps it that way for every future caller. |
| T-nxh-03 | Tampering | a later change makes workRoot optional again and the only check is a type directive that `npm test` never runs (WR-02) | low | mitigate | Task 1 adds a runtime assert.throws with a message matcher to the no-work-root test, so node --test goes red if the guard is dropped. The @ts-expect-error still guards the type under `npm run typecheck`. |
| T-nxh-04 | Denial of service | if the guard ever throws inside prepareInvocation, it does so after reserveInvocation, which leaves a reserved invocation | low | accept | This cannot happen in production: the profile work root is resolved, realpath'd and accepted by checkRoots. If it did happen, nothing launches, and the next reserveInvocation charges the orphan (src/app/budget.ts orphan path). src/app/invocation.ts stays unchanged. |
| T-nxh-05 | Information disclosure | repoPath, dataRoot, home and stagingPath remain unvalidated in computeInvocationScope | low | accept | The review states these did not become new outage vectors in the change under review. They are out of scope for WR-01. |
| T-nxh-SC | Tampering | npm/pip/cargo installs | low | accept | There is no install task. Task 2 checks that package.json and package-lock.json show no diff since 72f0c10. |
</threat_model>

<verification>
- `node --test test/unit/invocation-scope.test.ts` passes, including every WR-01 rejection and acceptance test and the WR-02 runtime assertion.
- `npm run typecheck` and `npm run check:boundaries` pass.
- `npm test` passes with 0 failures (baseline 1248 pass and 22 skipped, plus the new tests).
- The commit sequence is a test(261104-nxh) RED commit, then a fix(261104-nxh) commit, then a docs(261104-nxh) commit.
- src/app/invocation.ts, package.json and package-lock.json are unchanged.
</verification>

<success_criteria>
- WR-01: no work root that the type admits but that is not a normalized absolute path below '/' can produce a scope. Each refused form throws a TypeError whose message names computeInvocationScope and workRoot. Trailing-slash forms of a valid root are still accepted and trimmed.
- WR-02: `npm test` itself exercises the no-work-root guard through a runtime assertion matched by message.
- All existing callers and suites stay green.
</success_criteria>

<output>
Create `.planning/quick/261104-nxh-fix-phase-1-code-review-warnings-wr-01-a/261104-nxh-SUMMARY.md` when done
</output>
