**Verdict: BOUNCE.** One WARNING: an absolute claim in containment.md goes further than the hook's path model. There are no BLOCKERs.

Severity terms: **BLOCKER** means the change cannot proceed. **WARNING** means likely rework, to be fixed but not blocking. **OBS** is worth noting.

## What holds

- **Option lists:** the rule 13 lists match `GIT_OUTPUT_FORMS` (`src/domain/hook-decision.ts:532-557`) exactly.
  - `git log`: short `s`, valued `n`, counts, 23 flags, 13 valued options.
  - `git status`: `sbz`, attached `u`, 12 flags, 5 valued options.
  - `git show`: nothing.
- **Rule 12:** the colon trigger, the brace refusal, stages `[0-3]`, refusal of a path part starting with `/`, `!` or `(`, and the check from two starting points (the working copy root and the shell's directory) all match `checkGitObjects` (`:502-513`).
- **`git show` rejects any dash word:** true, including `--` and `-` (`:566`). A missing or colon-free operand is `shell-git-object` (`:567`).
- **Count options:** `-<digits>` is refused for `git status` (`:574-577`) and `git show`. The doc limits its claim to these three commands, which is correct. `git ls-files` and `git rev-parse` have no form, so they are not covered by rule 13, and the doc does not say they are.
- **`-u` takes its mode only attached:** confirmed in `SHORT_VALUE_OPTIONS` (`:346`) and in `shortAttached`.
- **Check order paragraph:** matches `checkSegment` (`:621-633`). `git show -s HEAD` gives `shell-git-output`, because `HEAD` has no colon and so skips rule 12.
- **Empty path part:** it resolves to the working copy root and the shell directory, and the root is never matched against a secret glob (`:237`). `git show REV:` does print a tree listing of names only.
- **Rule counts:** 35 rule IDs, 6 allow, 30 deny, one on both. This is arithmetically consistent, and the coverage.md rows (35 of 35; 6 allow, 30 deny) agree with containment.md.
- **New Limits bullet:** settings.ts:125 puts only `scope.denyRead` roots in the sandbox, and :110 turns the secret globs into `Read(...)` deny rules. The bullet is accurate.
- **findings.md citations, all correct:**
  - `hook-decision.ts:502` and `:562` (both functions)
  - `:237` (secret glob below staging)
  - `:747` (`decideReadBeforeEdit`)
  - `:716` (`meta` allow)
  - `settings.ts:125`
  - `docs/containment.md:108` (row 108 lists "committed secret-glob files read through git objects (`git show <rev>:<path>`, `git log -p`)" as a remaining bypass)
  - `findings.md:91` (still the file-edit safeguards line)
- **House rules:** no em or en dashes, no function names or delivery history in the containment.md additions, and the headings are unchanged.

## Findings

**WARNING: "refused … from history" is stronger than what the code does**
- **Location:** docs/system/containment.md:219, and the matching claim in rule 12 at :266 "resolved from the working copy root (where git resolves it)".
- **Problem:** "a secret file is refused whether it is read from the working copy, from history or from the index" is absolute. Git resolves `<rev>:<path>` inside that revision's tree. The hook resolves the path on the working copy's filesystem through `canonicalAbsolute`, which follows symlinks component by component (`src/adapters/fs/canonical-path.ts:28-31`).
- **Evidence:** suppose `config/` is a real directory at an older revision but a symlink to `other/` in the checkout, for example a tracked symlink at the pin. Then `git show HEAD~5:config/secrets.json` is judged as `<clone>/other/secrets.json`. A glob `config/**` does not match it, so the hook admits it, and git prints the old blob.
- **Fix:** bound the sentence, for example: "for a path whose directories are the same in the revision and in the working copy". Alternatively, add a line to findings.md and a Limits bullet saying the path part is judged on the working copy's filesystem, not on the revision's tree.
- **Confidence:** medium. The code path is confirmed; I did not run git.

**OBS: `:^` passes only if its path part passes**
- **Location:** :266, "Pathspec negation with `:^` passes, because it only excludes paths."
- **Problem:** the code has no special case for `:^`. Its path part (`^foo`) still goes through the read rules from both starting points, so it can be refused.
- **Evidence:** `:506-509`.
- **Fix:** "is not refused by this rule; its path part, `^` included, gets the read rules like any other."
- **Confidence:** high.

**OBS: missing comma**
- **Location:** :270, "With no operand, a bare revision or an object name it is `shell-git-object`".
- **Problem:** without a comma the subject is ambiguous on first read. "A bare revision or an object name" also reads as two kinds when the code tests one thing: an operand without a colon (`:567`).
- **Fix:** "With no operand, or with an operand that has no colon (a revision or an object name), it is `shell-git-object`".
- **Confidence:** high.

**OBS: the new findings line and the Limits bullet scope the exposure differently**
- **Location:** findings.md:125 says "a tracked secret file in the clone". containment.md Limits bullet (diff line 46) says "a secret file present in the clone", adding that installs and the run's own writes add more files.
- **Problem:** the same exposure is described with two different scopes.
- **Evidence:** the sandbox denyRead is roots only (settings.ts:125), so untracked secret files are exposed too.
- **Fix:** change "tracked" to "present" in findings.md:125.
- **Confidence:** high.

**OBS: annotation points at the function header**
- **Location:** findings.md:102, "`src/domain/hook-decision.ts:526`, now at `…:262`".
- **Problem:** line 262 is the `checkWrite` header. The path-in-write-root test the finding describes is at :266.
- **Fix:** cite :266.
- **Confidence:** high.

**OBS: the Limits bullet is three facts in one sentence**
- **Location:** containment.md Limits bullet, the sentence beginning "The git object store … holds the committed files compressed; the read rules do not refuse that directory, and `cat` … prints it compressed; no admitted command decompresses it."
- **Problem:** three facts are joined by semicolons into one sentence, which makes it hard to read.
- **Fix:** split it into two sentences.
- **Confidence:** high.

## Not verified

- "The clone starts with only the files committed at the pin" (Limits bullet). It is outside the files I was given, and I did not trace clone creation.

Verdict: BOUNCE
