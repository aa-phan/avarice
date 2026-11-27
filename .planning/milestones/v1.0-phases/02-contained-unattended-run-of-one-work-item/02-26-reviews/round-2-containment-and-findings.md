BOUNCE: no blockers, two warnings, five observations.

Severity: **BLOCKER** means the document cannot ship. **WARNING** means a claim the code contradicts or only loosely supports; it needs rework but does not block alone. **OBS** is worth fixing.

One limit on this review: Bash was denied in this session, so I could not run real git. The real-git checks below come from reading git's revision and pathspec parsing, and the confidence levels reflect that.

## WARNING

**W1. "An option's position never changes the decision" and "a word with a colon in the operands" are false for `git status -u`.** Location: `docs/system/containment.md`, rule 13's `git status` bullet and the check-order paragraph (added lines 30 and 33 of the diff).
- **Evidence:** `SHORT_VALUE_OPTIONS['git status']` is `'uM'` (`src/domain/hook-decision.ts:345`). So the read-rule parse (`parseReadArgs`, `:415-419`) takes the word after a bare `-u` as an option value, not an operand. `checkGitObjects` only sees operands (`:632`), so it never judges that word.
- `checkGitOutput` correctly treats `u` as attached-only (`:584`), and git does too: `-u` takes an optional argument that must be attached, so git reads the next word as a pathspec.
- **Result:** `git status ':(top)x' -u` is `shell-git-object`, but `git status -u ':(top)x'` is allowed. Rule 12 never sees an operand that git does receive, and moving `-u` changes the verdict.
- **Impact:** low, because status prints names only. But the document states the opposite.
- **Fix:** either drop `u` from `SHORT_VALUE_OPTIONS['git status']` (a code change, outside a docs pass), or qualify both sentences and add a findings.md line at `src/domain/hook-decision.ts:345`.
- **Confidence:** high for the code path; medium-high for git's `-u` parsing.

**W2. The check-order sentence leaves out `shell-syntax`.** Location: `containment.md`, the paragraph after rule 13 (diff line 33).
- **Evidence:** after the command match, `checkSegment` returns `shell-syntax` for an expanding word (`:620`) before the `shell-git-option` test (`:623`). The paragraph claims to list "the checks that follow the command match" and starts at `shell-git-option`.
- The `shell-git-object` step is also where the read rules on the path part produce `deny-secret-read` or `outside-read-set` (`:508-509`). The list implies that step only returns `shell-git-object`.
- **Fix:** start the list with `shell-syntax`, and write the fourth step as "the read rules on each object's path part, then `shell-git-object`".
- **Confidence:** high.

## OBS

**O1. The reason given for refusing a leading `/` does not match git.** Location: rule 12, "an absolute path part leaves the working copy".
- In `<rev>:<path>` and `:<path>`, git resolves only `./` and `../` relative to the current directory. It looks up any other path in the tree or the index, so `HEAD:/x` fails rather than leaving the repository.
- In pathspec position (the operands of `git log`, `git status` and `git ls-files`), `:/` is the "top" magic, not a message search.
- The refusal is correct as fail-closed behaviour; only the explanation is off.
- **Fix:** say the hook refuses these forms because git does not read them as plain paths. Name `:/` as both a message search (in a revision) and top-of-tree magic (in a pathspec).
- **Confidence:** medium (not run).

**O2. "An empty path part names the root tree" holds only for `<revision>:`.** Location: rule 12, last sentence.
- For `:` and `:0:`, the empty path names no tree in the index, and git errors. The hook allows both, since the path resolves to the working-copy root (`:237`). That is harmless.
- **Fix:** "An empty path after a revision names its root tree…". **Confidence:** medium.

**O3. Rule 13 and rule 11 disagree about a lone `-` after `git show`.** Location: rule 13, `git show` bullet, "With any option, a bare double hyphen included".
- The code refuses every word that starts with `-` (`:565`), including a lone `-`. Rule 11 says a lone `-` "names no path", which suggests it is harmless.
- **Fix:** "Any word starting with a dash, `--` and `-` included, is `shell-git-output`." **Confidence:** high.

**O4. "The clone holds only files the repository tracks" overstates.** Location: Limits of containment, new "Secret files read by code the run executes" bullet.
- The clone is checked out from the pin (`src/adapters/git/staging-clone.ts:65`). The install then writes `node_modules` into it, and the run writes files under its write globs.
- **Fix:** "The clone starts with only the files committed at the pin."

**O5. "No admitted command decompresses it" is loose.** Same bullet.
- `git show <rev>:<path>` reads and decompresses the object store; the read rules judge it by path.
- **Fix:** "no admitted command prints an object's content except by a path the read rules judge."

## Checked and correct

- **Option lists:** rule 13's lists match `GIT_OUTPUT_FORMS` (`:531-556`) exactly, in the same order. `git log`: short `s`, short valued `n`, counts, 23 flags, 13 valued options. `git status`: short `s b z`, attached `u`, 12 flags, 5 valued options. `git show`: nothing.
- **Stage numbers 0 to 3:** `/^:[0-3]:/` at `:505` matches git's `:N:` parse.
- **Braces:** refusing a brace anywhere (`:504`) matches git, which splits at the first colon outside braces.
- **Two-candidate check:** `:508` resolves the path part from the working-copy root and from the shell's directory, and both must pass.
- **`git show` order:** the option test comes before the object-operand test (`:565-566`), so `git show -s HEAD` is `shell-git-output`.
- **Count options:** `-<digits>` is admitted for `git log` only (`counts: true`); for `git status` it is `shell-git-output` (`:573-575`).
- **Global options:** `git --no-pager log` and `git -C dir show` are `shell-not-allowed` (`:618`), and `git -c` is `shell-denied-prefix` (`:616`).
- **Rule-ID count:** 35 is consistent: 6 allow + 30 deny − 1 on both. The two new IDs come in through `_RULE = ` constants, which the ledger's grep catches.
- **Limits bullet:** the sandbox `denyRead` holds roots only (`settings.ts:125`, `invocation-scope.ts:291` and `:519`), and the secret globs become Read deny rules (`settings.ts:110`). The read rules do not refuse the git directory (`:230-238`).
- **findings.md citations:** every one resolves at HEAD.
  - `:262` is `checkWrite`, `:746` is `decideReadBeforeEdit` and `:715` is the `meta` allow.
  - `:237` is the secret-glob check below the working copy, and `:501` and `:561` are the two git checks.
  - `settings.ts:125` is the sandbox `denyRead`, and `docs/containment.md:108` is the proposal row that lists the git-object bypass.
- **coverage.md:** 35 of 35 rule IDs agrees with containment.md. The 117 test files agrees with a glob of `test/**/*.test.ts`. I could not re-run the line count (26,259).
- **House rules:** no em or en dashes in the added lines. No file paths, function names, phase numbers or plan IDs in the containment.md prose. Rule IDs, option names and command forms are used as contract surface. Rules 12 and 13 follow the numbered style of the rules around them, and the Limits bullet fits the existing bullets.

PASS / BOUNCE: **BOUNCE** (2 WARNING)
