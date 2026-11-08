BOUNCE: one BLOCKER, no WARNING, three OBS.

Severity: **BLOCKER** means the text cannot ship (a claim the code or git does not support). **WARNING** means likely rework that does not block. **OBS** is worth noting.

## BLOCKER

**B1. The `:^` pathspec form lets `git show` print a commit's patch, so two new claims are false.**
- **Location:** `docs/system/containment.md`, the new paragraph under "Read rules" ("a secret file is refused whether it is read from the working copy, from history or from the index"), the `:^` sentence of rule 12, and the new Limits bullet ("`git show` of a commit and `git log -p` are refused").
- **Evidence from the code:** for `git show :^README`, `checkGitObjects` (`src/domain/hook-decision.ts:506-507`) takes the path part `^README`. It refuses only a part that starts with `/`, `!` or `(`, so `<staging>/^README` passes the read rules. `checkGitOutput` (`:565-567`) then sees no dash and an operand with a colon, and returns null. The command is admitted.
- **Evidence from git:** `:^README` fails as a revision because no index entry is named `^README`. `setup_revisions` then calls `verify_filename`, and `check_filename` strips the `:^` (as it strips `:!`) and finds `README` in the working tree. The word becomes an exclude pathspec. `git show` with no revision defaults to HEAD and prints HEAD's patch for every path except `README`. If HEAD added or changed a secret-glob file, its content is printed. `:^` and `:!` are synonyms in git, and the hook refuses only `:!`. A bare `:^` is also admitted; `check_filename` accepts it ("excluding everything is silly, but allowed").
- **Fix:** this is a code gap first. Refuse `^` at the start of the path part alongside `/`, `!` and `(`, then rewrite the `:^` sentence to match. If the owner keeps the code as it is, the three claims must be narrowed instead: add a Limits bullet and a `findings.md` line (`src/domain/hook-decision.ts:507`).
- **Confidence:** high on the hook path, which I read in the code. Medium-high on git, which I traced from git's revision.c and setup.c logic but did not run; Bash was denied in this session. A one-line reproduction settles it: `git show :^README` in a repo whose HEAD touches another file.

## WARNING

None.

## OBS

**O1. The empty-path claim is conditional, not unconditional.**
- **Location:** rule 12, "An empty path part resolves to both, which the read rules allow".
- **Evidence:** `absolutize(shellCwd, '')` (`src/domain/hook-decision.ts:114`, `:509`) gives the shell's directory. The read rules allow it only when that directory is in the read set. In practice rule 11 has already judged `<cwd>/HEAD:` by then, so the outcome is right.
- **Fix:** "which the read rules allow for a shell directory inside the read set", or drop "which the read rules allow".
- **Confidence:** high.

**O2. Two new Limits sentences rest on code outside the files named for this review, and I did not check them.**
- **Location:** the Limits bullet, "The clone starts with only the files committed at the pin" and "The read rules do not refuse that directory".
- **Fix:** none needed if the clone-creation code and the default secret globs (no `.git/**`) confirm them.
- **Confidence:** low that anything is wrong.

**O3. One old `findings.md` line points at a moved line.**
- **Location:** `docs/system/findings.md`, the line citing `src/adapters/host-claude/settings.ts:113` (not changed in this diff).
- **Evidence:** line 113 is now `'NotebookEdit'`. The GSD hook entries are at `:130-135`.
- **Fix:** add "(now at `src/adapters/host-claude/settings.ts:130`)" in the same style as the other annotations.
- **Confidence:** high.

## Checks that pass

- **Option lists:** the lists in rule 13 equal `GIT_OUTPUT_FORMS` (`:532-557`) exactly, in order:
  - `git log`: short `s`, valued `n`, the `-<digits>` count, 23 flags and 13 valued options.
  - `git status`: short `sbz`, `-u` attached only, 12 flags and 5 valued options.
  - `git show`: no options, object operands only.
- **Option behaviour:** `-n` takes its count attached or as the next word (`:586-588`). A count is admitted only for `git log`: `counts` is true only there, and `-5` on `git status` is `shell-git-output` (`:574-577`). `git show` refuses any word that starts with a dash, `--` and `-` included (`:566`). `-u` of `git status` takes its mode only attached, and `parseReadArgs` agrees (`:345-346`).
- **Object names:**
  - Stage numbers are 0 to 3, as the regex `/^:[0-3]:/` shows (`:506`).
  - A brace is refused only in a word that has a colon (`:504-505`).
  - The path part is checked from the working copy root and from the shell's directory, and both must pass (`:509`).
  - Checking on the working copy's file system rather than in the revision's tree is what `canon` does.
- **Check order:** shell-syntax, then `shell-git-option`, `shell-option-value`, the read rules, rule 12 and rule 13, matching `checkSegment` (`:621-633`). `git show -s HEAD` is `shell-git-output`. `git --no-pager log` and `git -C dir show` are `shell-not-allowed`, and `git -c` is a denied prefix.
- **Sandbox bullet:** `filesystem.denyRead` holds `scope.denyRead` roots only (`src/adapters/host-claude/settings.ts:125`). The secret globs become `Read(...)` deny rules (`:110`). The bullet and the `findings.md` line citing `:125` are correct.
- **`findings.md` citations:**
  - `src/domain/hook-decision.ts:266` is the write-root decision in `checkWrite`.
  - `:747` is `decideReadBeforeEdit`.
  - `:716` is the `meta` allow.
  - `:237` is the secret glob only below staging.
  - `:502` is `checkGitObjects`, `:562` is `checkGitOutput` and `:509` is the two-candidate read check.
  - `docs/containment.md:108` is the CON-1 row naming the git-object bypass.
- **Coverage ledger:** 33 + 2 new deny IDs (`shell-git-object`, `shell-git-output`) = 35, with 6 allow and 30 deny, one on both (6 + 30 − 1 = 35). `containment.md` and both `coverage.md` rows agree.
- **House rules:** the added lines have no em or en dashes and no delivery history in the `containment.md` prose. Rule IDs, command forms and option names appear as the contract surface.

The new rules 12 and 13 are precise and grounded. The option lists are exact, and the check-order paragraph earns its place.

**Verdict: BOUNCE**
