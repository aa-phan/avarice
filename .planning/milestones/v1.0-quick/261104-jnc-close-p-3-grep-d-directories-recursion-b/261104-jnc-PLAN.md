---
phase: quick-261104-jnc
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/domain/hook-decision.ts
  - test/unit/hook-decision.test.ts
  - test/integration/hook.test.ts
  - docs/containment.md
  - test/integration/claude-host.test.ts
  - src/domain/invocation-scope.ts
  - test/unit/invocation-scope.test.ts
  - test/unit/claude-settings.test.ts
  - test/containment/failclosed.test.ts
  - test/mutation/scope-and-validation.test.ts
autonomous: true
requirements: [CON-1]

estimate:
  tokens: 75000
  raw_tokens: 75000
  tasks: 3
  confidence: low

must_haves:
  truths:
    - "Each of the nine -d/--directories spellings that 01-VERIFICATION.md P-3 reproduced as `allow shell-identity` (grep -dRECURSE, -d RECURSE, --directories=RECURSE, --directories=Recurse, --dir=RECURSE, -d rec, -d dereference-recurse, --directories=dereference-recurse, -ddereference-recurse) is denied `shell-recursive-read` by decideToolCall under a policy with the preset-shaped secret globs, and `grep -d RECURSE PASSWORD .` is denied through the real hook entry (CR-01, P-3)"
    - "A -d/--directories action is compared case-insensitively: read and skip are not recursive, recurse is recursive, and dereference-recurse, any unrecognised or abbreviated value, or a --directories prefix given without a value it consumed is treated as following links, so it is denied `shell-recursive-read` wherever the walk starts, including inside a read root"
    - "Every prefix of --directories of at least three characters (--d, --di, --dir, ...) is recognised as the directories option; `--di=recurse` (accepted by /usr/bin/grep at planning time) is no longer missed"
    - "A recursive grep whose value-taking long option is given a separate word (`grep -r --exclude-dir x PASSWORD`) is judged on the root it really walks (the working directory), and a long option the hook does not model, followed by another argument, adds the working directory to the judged roots (WR-01)"
    - "computeInvocationScope cannot be called without workRoot: `npx tsc -p .` fails on a ScopeInput that omits it, and every scope it returns denies the work root and re-allows only its own staging (WR-03)"
    - "The claude-host integration assertion that no Read deny contains staging fails when production settings re-add a Read deny on the work root, and passes on the unmodified code (WR-04)"
    - "docs/containment.md CON-1 states the -d/--directories rule, the long-option rule, that every recursive shell grep starting inside staging is denied under the preset secret globs so the mapper uses the Grep tool (IN-01), and the unresolved embedded-ugrep residual (WR-02), with no read restriction the hook does not enforce"
  artifacts:
    - path: "src/domain/hook-decision.ts"
      provides: "Fail-closed -d/--directories classification in recursiveRule; LONG_VALUE_OPTIONS consumed by parseReadArgs; working-directory fallback for unmodelled long options"
      contains: "LONG_VALUE_OPTIONS"
    - path: "test/unit/hook-decision.test.ts"
      provides: "One test per reproduced spelling, link-following cases, long-option value cases"
      contains: "dereference-recurse"
    - path: "src/domain/invocation-scope.ts"
      provides: "ScopeInput.workRoot required"
    - path: "test/integration/claude-host.test.ts"
      provides: "A Read-deny-contains-staging assertion that can fail"
    - path: "docs/containment.md"
      provides: "CON-1 row matching what the hook enforces"
      contains: "dereference-recurse"
  key_links:
    - from: "src/domain/hook-decision.ts checkSegment"
      to: "parseReadArgs(entry key) -> LONG_VALUE_OPTIONS"
      via: "the matched READ_ONLY_COMMANDS entry key, same lookup as SHORT_VALUE_OPTIONS"
      pattern: "LONG_VALUE_OPTIONS\\["
    - from: "src/domain/hook-decision.ts recursiveRule"
      to: "deny rule shell-recursive-read"
      via: "directories-action classification feeding the link-following branch"
      pattern: "shell-recursive-read"
    - from: "src/app/invocation.ts computeInvocationScope call"
      to: "src/domain/invocation-scope.ts ScopeInput.workRoot"
      via: "workRoot: deps.profile.workRoot (already passed; now type-enforced)"
      pattern: "workRoot: deps.profile.workRoot"
---

<objective>
Close the last open phase-01 gap, P-3 (review CR-01). Today the hook's recursive-grep detector recognises only the exact lowercase `recurse` action of `-d`/`--directories`, so upper-case, abbreviated and `dereference-recurse` spellings run unchecked. Also fix review warnings WR-01 (a long option with a separate value shifts the grep operands, so the hook judges the wrong walk root), WR-03 (`ScopeInput.workRoot` is optional, so the work-root deny can be dropped without notice) and WR-04 (the claude-host assertion that no Read deny contains staging can never fail). Update the docs/containment.md CON-1 row to match, including review IN-01.

Purpose: plan 01-23 truth 4 says "every recursive grep inside staging is denied" and "a recursive grep that follows links is denied". Both must be true for every spelling a real grep accepts, not only for the spellings the tests list. Phase 01 is containment-first, and its re-verification is `gaps_found` only because of this.

Output: hardened `src/domain/hook-decision.ts` and `src/domain/invocation-scope.ts`, tests that pin each spelling and each parser case, an integration assertion that can fail, and a truthful CON-1 row.
</objective>

<execution_context>
@~/.claude/gsd-core/workflows/execute-plan.md
@~/.claude/gsd-core/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/01-contained-onboarding-of-one-repository/01-VERIFICATION.md
@.planning/phases/01-contained-onboarding-of-one-repository/01-REVIEW.md
@.planning/phases/01-contained-onboarding-of-one-repository/01-23-SUMMARY.md
@.planning/phases/01-contained-onboarding-of-one-repository/01-24-SUMMARY.md
@src/domain/hook-decision.ts
@src/domain/invocation-scope.ts

<interfaces>
Observed at planning time (HEAD 50baad4). Use these, do not re-explore:

src/domain/hook-decision.ts
- SHORT_VALUE_OPTIONS (line ~288): exported record keyed by the matched READ_ONLY_COMMANDS entry joined with a space; grep is 'ABCDdefm'.
- interface ReadArgs { positional: string[]; values: string[]; flags: Set<string>; shortValues: Array<{flag, value}>; longs: Array<{ name: string; value: string | null }>; malformed: boolean }.
- parseReadArgs(entryKey, args) (line ~312): a `--name` word without `=` is pushed to longs with value null and its next word becomes positional (line ~326-331). That is the WR-01 defect. Every value pushed to `values` is path-checked by checkSegment through checkRead.
- isLongOption(name, full, minLength): GNU prefix match, `name.length >= minLength && full.startsWith(name)`.
- recursiveRule(parsed, call, policy, canon) (line ~377): directoriesRecurse (line ~380-382) compares the -d value and the --directories value (min prefix length 5, plus a positional-list fallback for a separate word) with the exact lowercase string. That is CR-01. dereferences = R flag or --dereference-recursive; the S and O flags also return 'shell-recursive-read'. patternFromOption (e, f, --regexp, --file); walked = positional, or positional minus the first when the pattern is not from an option; cwd is pushed only when walked is empty (line ~390-394).

test/unit/hook-decision.test.ts
- helpers inside describe 'shell option values, operands after --, and recursive reads (CR-02, D-GAP-01)' (line ~338): rule(command, p = policy(), cwd = STAGING) returns 'decision:rule'; roots(...readRoots) gives a policy with readRoots. The default policy() has denyReadGlobs ['**/.env', '**/*.pem'], the shape of the preset. Tests use a lexical makeCanon (no filesystem).
- The existing it 'refuses every recursive grep spelling inside staging...' (line ~376) includes 'grep --directories recurse x src'. It must stay green.

test/integration/hook.test.ts
- runHook(fx, 'pre', { tool_name: 'Bash', tool_input: { command } }) runs the real hook entry with cwd fx.staging. parsed(stdout).hookSpecificOutput.permissionDecision is the decision. decisions(fx) lists the hook.decision events with `.rule`. The fixture policy has denyReadGlobs ['**/.env', '**/*.pem']. fx.staging = join(fx.dir, 'work', 'staging').
- computeInvocationScope call sites without workRoot: lines ~425, ~500, ~537 (knowledge probe), ~614.

src/domain/invocation-scope.ts
- ScopeInput.workRoot is declared optional (line ~186). computeInvocationScope (line ~204) adds the work root to denyRead and staging to allowRead only when the field is present (line ~237-242).
- The only production caller is src/app/invocation.ts:84, which already passes `workRoot: deps.profile.workRoot` (line 90).
- Test callers that omit it: test/unit/invocation-scope.test.ts scopeFor (line ~50; STAGING '/work/onb-1/staging'); test/unit/claude-settings.test.ts scope() (line ~64; staging = join(root, 'work', 'onb-1', 'staging')); test/containment/failclosed.test.ts:39; test/mutation/scope-and-validation.test.ts:19 (stagingPath '/work/staging'); test/integration/hook.test.ts (four sites above).

src/adapters/host-claude/settings.ts:103-105: the permission deny list filters out every denyRead path that equals or contains staging, through containsStaging(path, staging). Rules are written `Read(//abs/path/**)`.

test/integration/claude-host.test.ts:231-235: the WR-04 predicate takes rule.slice of the 'Read(//' length, which drops the leading slash, so the predicate is never true.

/usr/bin/grep on this machine is "grep (BSD grep, GNU compatible) 2.6.0-FreeBSD". Probed at planning time in a scratch tree:
- `--di=recurse` recurses; `--dir RECURSE` (abbreviated, separate word) recurses; `-d RECURSE` recurses; `-d rec` errors.
- With a separate word, these consume it: --after-context, --before-context, --binary-files, --devices, --directories, --exclude, --exclude-dir, --file, --include, --include-dir, --max-count, --regexp, --label.
- `--context` does NOT consume a separate word (`grep -r --context 1 PASSWORD` reported "PASSWORD: No such file or directory"). --exclude-from and --group-separator are unrecognised (grep exits 2).
</interfaces>
</context>

<tasks>

<task type="tracer" tdd="true">
  <name>Task 1 (tracer): any -d/--directories action other than read or skip recurses, through decideToolCall and the real hook entry (CR-01, P-3)</name>
  <files>src/domain/hook-decision.ts, test/unit/hook-decision.test.ts, test/integration/hook.test.ts</files>
  <read_first>src/domain/hook-decision.ts lines 286-410 (SHORT_VALUE_OPTIONS through recursiveRule); test/unit/hook-decision.test.ts lines 335-440; test/integration/hook.test.ts lines 1-43 and 118-131 (harness and the Bash identity test).</read_first>
  <behavior>
    Unit tests (test/unit/hook-decision.test.ts). Add a new describe block named for CR-01 and P-3. Generate one `it` per spelling from a list, so each spelling shows as its own test in the runner output.
    - Default policy(), cwd STAGING. Each of the following expects 'deny:shell-recursive-read'. First the nine spellings 01-VERIFICATION.md P-3 reproduced: `grep -dRECURSE PASSWORD .`, `grep -d RECURSE PASSWORD .`, `grep --directories=RECURSE PASSWORD .`, `grep --directories=Recurse PASSWORD .`, `grep --dir=RECURSE PASSWORD .`, `grep -d rec PASSWORD .`, `grep -d dereference-recurse PASSWORD .`, `grep --directories=dereference-recurse PASSWORD .`, `grep -ddereference-recurse PASSWORD .`. Then the review's extra cases and the abbreviations probed at planning: `grep -dRecurse x src`, `grep --di=recurse x .`, `grep --dir RECURSE x .`, `grep --directories rec x .`, `grep -d DEREFERENCE-RECURSE x src`.
    - Link following is refused wherever the walk starts, with policy roots('/gsd/core') and cwd STAGING. `grep -d recurse x /gsd/core` and `grep -d RECURSE x /gsd/core` expect 'allow:shell-identity', the same as the existing `grep -r x /gsd/core`. `grep -d dereference-recurse x /gsd/core`, `grep --directories=Dereference-Recurse x /gsd/core`, `grep -d rec x /gsd/core`, `grep -d deref x /gsd/core` and `grep --dir RECURSE x /gsd/core` expect 'deny:shell-recursive-read'.
    - Non-recursive actions stay allowed under the default policy: `grep -d read x src/a.ts`, `grep -d READ x src/a.ts`, `grep -dskip x src/a.ts` and `grep --directories=Skip x src/a.ts` expect 'allow:shell-identity'.
    - Every existing test in the file still passes unchanged, including 'grep --directories recurse x src' expecting deny.
    Integration test (test/integration/hook.test.ts). Add one `it` in describe 'commands, subagents and other tools' whose name contains "CR-01". It runs Bash `grep -d RECURSE PASSWORD .` through runHook and asserts permissionDecision 'deny', and that the last hook.decision event from decisions(fx) has rule 'shell-recursive-read'.
  </behavior>
  <action>
    RED first. Write the tests in the behavior block. Run `node --test test/unit/hook-decision.test.ts test/integration/hook.test.ts` and confirm the new spelling tests and the real-hook case fail, because they come back 'allow:shell-identity'. Commit only the tests as `test(261104-jnc): failing tests for -d/--directories recursion spellings (CR-01, P-3)`.

    GREEN. In recursiveRule (src/domain/hook-decision.ts), replace the directoriesRecurse computation with a fail-closed classification of every directories action the command carries. That is each shortValues entry with flag 'd', and each longs entry that isLongOption matches against '--directories' with minimum length 3. Lower the minimum from 5 to 3, because GNU and BSD getopt accept `--di`, and `--di=recurse` was observed to recurse on /usr/bin/grep. Classify each action as follows:
    - A long entry whose value is null, meaning it was given without `=` and consumed no value, is link-following. The hook cannot prove which action it names, and /usr/bin/grep accepts an abbreviated name with a separate word. Remove the existing fallback that looks up the action in the positional list. Task 2 makes the exact `--directories` consume its next word, so that fallback is no longer needed.
    - Compare a non-null value lowercased. 'read' and 'skip' are not recursive. 'recurse' is recursive and the walk roots are judged as today. Any other value is link-following. This covers 'dereference-recurse' (ugrep follows links with it), abbreviations such as 'rec' or 'deref', and the empty string. Treating unrecognised and abbreviated values this way is the fail-closed rule the task asks for.
    - Any link-following action counts as recursive and joins the existing dereferences branch, so it returns 'shell-recursive-read' before any root is judged. Keep -R, --dereference-recursive, -S and -O as they are.
    Where several -d values appear, judge the command as if any one of them applies. That is fail closed: a real grep uses only the last one. Add a short code comment that names CR-01 and the two greps observed: macOS BSD grep folds case, and embedded ugrep accepts dereference-recurse. Do not touch the named-operand check in checkSegment. Run the verify command and confirm it passes, then commit as `fix(261104-jnc): fail closed on every -d/--directories action that is not read or skip (CR-01, P-3)`.
  </action>
  <verify>
    <automated>node --test test/unit/hook-decision.test.ts test/integration/hook.test.ts</automated>
  </verify>
  <done>Every spelling listed in the behavior block gets its expected rule through decideToolCall. The real hook entry denies `grep -d RECURSE PASSWORD .` with rule shell-recursive-read. Both test files pass with 0 failures. There are two commits, the RED tests and then the GREEN fix, and the RED run showed the new cases failing.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: long options with a separate value consume it, with a working-directory fallback for unmodelled ones (WR-01); make the CON-1 evidence true (docs row, WR-04 assertion)</name>
  <files>src/domain/hook-decision.ts, test/unit/hook-decision.test.ts, docs/containment.md, test/integration/claude-host.test.ts</files>
  <read_first>src/domain/hook-decision.ts lines 286-410 as left by Task 1; docs/containment.md line 107 (the CON-1 row) and line 92; test/integration/claude-host.test.ts lines 208-240; src/adapters/host-claude/settings.ts lines 96-106.</read_first>
  <behavior>
    Add a new describe block in test/unit/hook-decision.test.ts named for WR-01.
    - Policy narrowEnv = policy({ denyReadGlobs: ['.env', 'config/*.key'] }). These globs have no `**`, which is the shape the review used. `grep -r --exclude-dir x PASSWORD`, `grep -r --max-count 1 PASSWORD` and `grep -r --include "*.ts" PASSWORD` expect 'deny:shell-recursive-read'. Each was 'allow:shell-identity' before this task. The control `grep -r PASSWORD` expects 'deny:shell-recursive-read'.
    - Policy narrow = policy({ denyReadGlobs: ['config/secrets.json'] }), which tests precision. `grep -r --exclude-dir x PASSWORD src` expects 'allow:shell-identity' and `grep -r --exclude-dir x PASSWORD config` expects 'deny:shell-recursive-read'. `grep --directories RECURSE x src` expects allow and `grep --directories RECURSE x config` expects deny. `grep -r --regexp foo config` expects deny and `grep -r --regexp foo src` expects allow.
    - Unmodelled long options fail closed with policy narrow. `grep -r --exclude-d x PASSWORD src` expects 'deny:shell-recursive-read', because the abbreviation is not consumed and the working directory is judged. `grep -r --context 2 PASSWORD src` expects deny: --context is left out of the table because /usr/bin/grep leaves its separate word in place. `grep -r --ignore-case x src` expects deny, because the long option is unmodelled and an argument follows it.
    - Arguments that consume nothing stay precise with policy narrow. `grep --recursive x src` expects allow, because the recursion long options take no value. `grep -r x src --ignore-case` expects allow, because an unmodelled long option in last position consumes nothing.
    - A consumed separate value is still path-checked under the default policy. `grep --exclude /home/u/.netrc x src/a.ts` expects 'deny:outside-read-set' and `grep --file /home/u/.ssh/id_rsa src/a.ts` expects 'deny:deny-read'.
    - The existing tests 'keeps allowing the read commands the mapper and the intel agent need', 'takes the pattern from -e, -f or --regexp...' and all Task 1 tests stay green.
  </behavior>
  <action>
    RED first. Write the unit tests in the behavior block. Run the unit file and confirm that the narrowEnv cases and `grep --directories RECURSE x src` fail. The latter is denied after Task 1, because an exact --directories with a separate word is not yet consumed. Commit the tests as `test(261104-jnc): failing tests for long options with a separate value (WR-01)`.

    GREEN, parser. In src/domain/hook-decision.ts, add LONG_VALUE_OPTIONS beside SHORT_VALUE_OPTIONS. It is a record keyed by the same entry key and holds full long-option names; an entry that is not listed takes none. The grep list is exactly: --after-context, --before-context, --binary-files, --devices, --directories, --exclude, --exclude-dir, --exclude-from, --file, --group-separator, --include, --include-dir, --label, --max-count, --regexp. An option belongs in the list when it takes a required argument in GNU grep and this machine's /usr/bin/grep either consumes the separate word or rejects the option. A grep that rejects the option exits before walking, so consuming its word cannot hide a root. Leave out --context and --color/--colour, whose argument is optional in at least one grep (BSD --context was observed not to consume it), and say why in a comment. In parseReadArgs, when a `--name` word has no `=` and `name` exactly equals a listed option, consume the next argument whatever it looks like, the way getopt consumes a required argument. Set the longs entry's value to it, push it to `values` so checkRead judges it as a path, and do not add it to positional. If no next argument exists, the value stays null. Do not consume for abbreviations. Exact match only, because a prefix could resolve to a different option in another grep, which would hide a root.

    GREEN, fallback. In recursiveRule, call the operand list unprovable when any longs entry meets all of these: its value is null, it is followed by at least one more argument in the original word list, and it is not a prefix match of --recursive or --dereference-recursive (those take no value). Track the index or a flag in ReadArgs. Store it as a field, for example `unprovenLong: boolean`, set by parseReadArgs; that is cleaner than re-scanning. When the list is unprovable, push cwd onto walked as well as the computed roots. This is the review's minimum fix, applied only where the table cannot prove the parse. It is safe because the computed roots plus cwd are a superset of every root the real grep can walk under any arity reading. Name WR-01 in the comment.

    Docs (docs/containment.md, the CON-1 row at line 107, which is one table line; edit it in place with Edit). Leave the other columns' existing facts in place and add the following. In the controls and coverage text: a recursive `grep` is any `-r`, `-R`, prefix of `--recursive` or `--dereference-recursive`, or `-d`/`--directories` action other than `read` or `skip` (any case, attached or separate, any prefix of `--directories` from `--d`). `dereference-recurse`, an unrecognised or abbreviated action, and an abbreviated `--directories` given without `=` are treated as following links and are denied `shell-recursive-read` wherever the walk starts. Long options that take a separate value consume it, and a long option the hook does not model that is followed by another argument makes the hook also judge the working directory as a walked root. IN-01: under the preset secret globs, every one of which starts with `**/`, every recursive shell `grep` whose walk starts inside staging is denied, and the mapper must use the Grep tool there. Add to the known bypasses (review WR-02, unresolved): the parser models GNU and BSD grep option syntax. If the contained shell runs `grep` as the ugrep embedded in Claude Code (not established), ugrep-only recursion such as `-5`, and the reading of files directly inside a directory operand without `-r`, are not detected. In the evidence column, add the -d/--directories spellings and the long-option cases to the `test/unit/hook-decision.test.ts` entry. Do not claim any restriction the hook does not enforce (plan 01-24 prohibition).

    WR-04 (test/integration/claude-host.test.ts, around lines 231-235). Replace the slice-based predicate with a parsed one. Match a rule against the pattern Read, open paren, a slash, then capture an absolute path, then the suffix /** and close paren; the regex in 01-REVIEW.md WR-04 does this. The predicate is true when staging equals the captured root or starts with the captured root plus '/'. Drop the extra includes(workRoot) condition so the predicate stands alone. Keep the assertion message. Prove it can fail: temporarily delete the `&& !containsStaging(path, staging)` clause from the deny filter in src/adapters/host-claude/settings.ts (line ~104), run `node --test --test-name-pattern "denies the work root and re-allows only this staging" test/integration/claude-host.test.ts` and confirm it FAILS on the "no Read permission deny names a root that contains the staging" message. Then restore the file with `git checkout -- src/adapters/host-claude/settings.ts`, rerun the test and confirm it passes. Record both runs (fail, then pass) in the SUMMARY. Never commit the mutation.

    Run the verify command, then commit the parser fix as `fix(261104-jnc): consume separate values of grep long options, judge cwd when the parse is unprovable (WR-01)` and the docs plus WR-04 change as `docs(261104-jnc): CON-1 row states the grep recursion rules; fix the vacuous Read-deny assertion (IN-01, WR-04)`.
  </action>
  <verify>
    <automated>node --test test/unit/hook-decision.test.ts && node --test --test-name-pattern "denies the work root and re-allows only this staging" test/integration/claude-host.test.ts && git diff --quiet -- src/adapters/host-claude/settings.ts && grep "No reads of secrets, other profiles" docs/containment.md | grep -c "dereference-recurse" && grep "No reads of secrets, other profiles" docs/containment.md | grep -c "Grep tool" && grep "No reads of secrets, other profiles" docs/containment.md | grep -c "ugrep"</automated>
  </verify>
  <done>Every case in the behavior block gets its expected rule. The claude-host test passes on unmodified code and was observed to fail under the temporary settings.ts mutation, with both runs recorded in the SUMMARY. settings.ts has no diff. The CON-1 row names `dereference-recurse`, the Grep tool and the ugrep residual (each grep count is 1). There are three commits: RED, GREEN, and docs plus WR-04.</done>
</task>

<task type="auto">
  <name>Task 3: make ScopeInput.workRoot required and fix every caller (WR-03)</name>
  <files>src/domain/invocation-scope.ts, test/unit/invocation-scope.test.ts, test/unit/claude-settings.test.ts, test/containment/failclosed.test.ts, test/mutation/scope-and-validation.test.ts, test/integration/hook.test.ts</files>
  <read_first>src/domain/invocation-scope.ts lines 176-245; test/unit/invocation-scope.test.ts lines 1-60 and 175-302; test/unit/claude-settings.test.ts lines 1-80, 140-152, 225-266 and 318-330.</read_first>
  <action>
    Six files, four of which get a single field each that `npx tsc -p .` lists. Splitting them across tasks would leave typecheck red between commits.

    In src/domain/invocation-scope.ts, make ScopeInput.workRoot a required string: drop the optional marker. Rewrite its comment so it says the type makes every caller pass the work root (WR-03), and drop the claim that prepareInvocation always passes it. In computeInvocationScope, trim the work root unconditionally. denyRead always ends with it; keep the Set de-duplication, so a work root equal to an existing entry is listed once. allowRead always ends with the staging path. Remove the comment about unit callers that model no profile. src/app/invocation.ts already passes `workRoot: deps.profile.workRoot`; leave it unchanged.

    Fix every caller tsc reports. Pass a work root that contains the staging path, the way production lays out `{workRoot}/{onboardingId}/staging`:
    - test/unit/invocation-scope.test.ts: scopeFor defaults workRoot to '/work', which an `over` value can still replace. Update the expectations that change: the map allowRead becomes [STAGING], the repoReadAllow case becomes [`${REPO}/.git`, STAGING], and any denyRead deepEqual gains '/work' last. Replace the test 'keeps the previous denyRead and allowRead when no work root is given' with a type-level pin: a `const` typed ScopeInput object literal that omits workRoot, on the line directly under a `// @ts-expect-error` comment that names WR-03. Never pass that literal to computeInvocationScope; mark it used with `void`. tsc then reports an unused directive if the field ever becomes optional again.
    - test/unit/claude-settings.test.ts: the scope() helper defaults workRoot to join(root, 'work'), the directory that holds staging. Update the default fixture expectation (around line 150): the sandbox denyRead gains the work root last and the sandbox gains allowRead [staging], while the permission denies are unchanged because the work root contains staging and is filtered out. The tests at about lines 260-265 ('is unchanged when the scope carries no work root') and 322-325 ('emits allowRead only when the strategy lists a path') pin the renderer's branch for an empty allowRead. Keep them, but feed the renderer an InvocationScope with denyRead set to the five base entries and allowRead set to [], made by spreading scope('map') with those overrides. Rename the first one so it says it tests the renderer branch, not a scope computeInvocationScope can produce.
    - test/containment/failclosed.test.ts:39: add the root's work directory as workRoot, using the directory that holds that test's staging path.
    - test/mutation/scope-and-validation.test.ts:19: add workRoot: '/work'.
    - test/integration/hook.test.ts at lines ~425, ~500 and ~614: add workRoot: join(fx.dir, 'work'), which holds fx.staging. At ~537, add the same for the knowledge probe fixture: join(probe.dir, 'work').
    If an assertion in those files fails only because the scope now carries the work-root deny and the staging re-allow, update the expected value. Never drop the assertion. Run the verify command, then commit as `fix(261104-jnc): require ScopeInput.workRoot so no caller can drop the work-root deny (WR-03)`.
  </action>
  <verify>
    <automated>npx tsc -p . && node --test test/unit/invocation-scope.test.ts test/unit/claude-settings.test.ts test/containment/failclosed.test.ts test/mutation/scope-and-validation.test.ts test/integration/hook.test.ts</automated>
  </verify>
  <done>`npx tsc -p .` exits 0 with the @ts-expect-error pin in place. To prove the pin is live, temporarily make the field optional again and confirm tsc reports the unused directive, then revert and record it in the SUMMARY. The five test files pass. Every computeInvocationScope call passes workRoot. One commit.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| model-generated tool call -> PreToolUse hook (decideToolCall) | The Bash command string is untrusted. It is produced by a model that reads hostile repository content in staging. |
| hostile repository -> staging tree | Tracked symlinks and secret-bearing files (.env, *.pem) are materialized in staging, which a link-following walk can use to leave the tree. |
| scope computation -> settings and hook policy | Each caller of computeInvocationScope decides whether the OS sandbox and the hook deny the work root (other onboardings). |

## STRIDE Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation Plan |
|-----------|----------|-----------|----------|-------------|-----------------|
| T-jnc-01 | Information disclosure | hook-decision.ts recursiveRule, -d/--directories action | high | mitigate | Task 1: case-insensitive classification. Only read and skip are non-recursive. dereference-recurse, unrecognised, abbreviated and unconsumed actions are link-following and denied shell-recursive-read. --directories is matched from the 3-character prefix. One unit test per reproduced spelling and a real-hook-entry test. |
| T-jnc-02 | Information disclosure | hook-decision.ts symlink-following walk out of staging to ~/.netrc and ~/.npmrc (not in the sandbox denyRead) | high | mitigate | Task 1: every link-following action is denied before any root is judged, including inside read roots (tests with roots('/gsd/core')). |
| T-jnc-03 | Information disclosure | hook-decision.ts parseReadArgs, long option with a separate value hides the walk root | medium | mitigate | Task 2: LONG_VALUE_OPTIONS (exact names, observed arity) consume their word, and the cwd is also judged when an unmodelled long option is followed by an argument. Tests use narrow globs, where the preset `**/` globs would otherwise mask the defect. |
| T-jnc-04 | Elevation of privilege | invocation-scope.ts ScopeInput.workRoot optional | medium | mitigate | Task 3: required at type level, pinned by a @ts-expect-error literal that tsc checks. |
| T-jnc-05 | Repudiation | claude-host.test.ts vacuous Read-deny assertion | low | mitigate | Task 2: the predicate parses the rule. It was proven to fail under a temporary settings.ts mutation and to pass after the revert. |
| T-jnc-06 | Information disclosure | grep run as embedded ugrep (review WR-02: -5 recursion, directory operand read without -r) | medium | accept | Out of scope for this task per the orchestrator. Documented as a known bypass in the CON-1 row (Task 2). Tracked by review WR-02. |
| T-jnc-07 | Denial of service | fail-closed over-denial (unmodelled long options, abbreviated -d values) | low | accept | Under the preset globs every recursive grep in staging is denied anyway. The Grep tool is the supported route (documented, IN-01). |
| T-jnc-SC | Tampering | npm/pip/cargo installs | low | accept | No install task. package.json and the lockfile are unchanged; confirm with `git diff --stat` at the end. |
</threat_model>

<verification>
- `npx tsc -p .` exits 0.
- `node scripts/check-boundaries.ts` exits 0.
- `npm test`: 0 failures. The pass count is at least the baseline 1218 plus the tests this plan adds, with 22 or fewer skipped.
- `git diff --quiet -- src/adapters/host-claude/settings.ts package.json`: the WR-04 mutation was reverted and no dependency changed.
- Re-run the nine P-3 spellings from 01-VERIFICATION.md through decideToolCall: all are deny shell-recursive-read (covered by the Task 1 unit tests).
</verification>

<success_criteria>
- Phase-01 gap P-3 (review CR-01) is closed: no -d/--directories spelling, in any case, abbreviation or dereference form, gets a recursive grep past the secret-glob or link-following check.
- WR-01, WR-03 and WR-04 are fixed, each with a test that fails without the fix, and for WR-04 a recorded mutation run.
- The docs/containment.md CON-1 row matches what the hook enforces, including IN-01 and the WR-02 residual.
- Out of scope and untouched: the WR-02 fix (which grep the contained shell runs), IN-02, IN-03, and the review-disposition ledger.
</success_criteria>

<source_audit>
| Source | Item | Covered by |
|--------|------|-----------|
| GOAL (quick description) | Close P-3 / CR-01 | Task 1 |
| REQ | CON-1 (no reads of secrets or other profiles) | Tasks 1-3 |
| CONTEXT (orchestrator) | Fail closed on -d/--directories values other than read and skip, case-insensitive; dereference-recurse is link-following | Task 1 |
| CONTEXT | A unit test per reproduced spelling | Task 1 (one `it` per spelling) |
| CONTEXT | docs CON-1 row; IN-01 sentence | Task 2 |
| CONTEXT | WR-01 parser fix plus tests | Task 2 |
| CONTEXT | WR-03 workRoot required, callers and tests fixed | Task 3 |
| CONTEXT | WR-04 assertion can fail, proven by temporary mutation | Task 2 |
| VERIFICATION gap missing[2] (establish which grep runs, or drop grep) | WR-02 | Excluded by the orchestrator (WR-02 out of scope); the residual is recorded in the docs row (Task 2) |
| Excluded | IN-02, IN-03, the review-disposition ledger | Out of scope per the orchestrator |
</source_audit>

<output>
Create `.planning/quick/261104-jnc-close-p-3-grep-d-directories-recursion-b/261104-jnc-SUMMARY.md` when done. Record the RED failures for Tasks 1 and 2, the WR-04 mutation run (fail, then pass), the WR-03 tsc pin check, and the final `npm test` totals.
</output>
