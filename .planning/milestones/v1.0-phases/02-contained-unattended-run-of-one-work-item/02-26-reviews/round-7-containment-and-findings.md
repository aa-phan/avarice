**Verdict: BOUNCE.** I found no BLOCKER, but two WARNINGs need fixing before the documents can pass.

Severity: **BLOCKER** means it cannot proceed. **WARNING** means a claim is only loosely supported and needs rework, but does not block. **OBS** is worth noting.

Bash was denied in this session, so I could not run the hook-rule count command or recount source lines. Everything below comes from reading the code.

## What checks out against the code

- **Rule 12 matches `checkGitObjects` (`src/domain/hook-decision.ts:502-514`).**
  - It runs on every operand with a colon, for any admitted git command.
  - A brace anywhere in the word is refused.
  - A stage is recognised only as `^:[0-3]:`, and that is also git's own rule (`:4:x` and `:01:x` are read as index paths).
  - A path part is refused if it starts with `/`, `!`, `(` or `^`, or holds `*`, `?`, `[` or `\`.
  - The path part gets the read rules twice: from `stagingPath` and from `shellCwd`.
  - An empty path part becomes `<root>/` through `absolutize` (`:114`), so it is judged as the root.
  - The git behaviour is right too: git skips colons inside `@{...}`, `:/text` is a message search, `:!`, `:^` and `:(` fall back to a pathspec, and `git show <rev>:` prints only the names in a tree.
- **Rule 13's option lists equal `GIT_OUTPUT_FORMS` (`:533-558`) exactly.**
  - `git log`: 23 options without a value and 13 that take `=value`, in the same order.
  - `git status`: short options `sbz` plus `u` with its mode attached, 12 options without a value and 5 that take `=value`.
  - The `-<digits>` count is admitted only for `git log`.
  - For `git show`, any word starting with a dash is `shell-git-output` (`:567`), and that includes `--` and `-`. This test runs before the check that every operand has a colon (`:568`), so `git show -s HEAD` is `shell-git-output`, as the document says.
- **The check order matches `checkSegment` (`:597-635`).** The denied-prefix check runs before the command match, so `git -c` is `shell-denied-prefix`, and `git --no-pager log` matches no admitted command, so it is `shell-not-allowed`.
- **The rule count is consistent.** The only new rule IDs are `GIT_OBJECT_RULE` and `GIT_OUTPUT_RULE` (`:500`, `:560`), so 33 becomes 35, with 6 allow and 30 deny (6 + 30 − 1 = 35). coverage.md says 35 of 35, which agrees. The test files number 117 (glob count). I could not check the 26,261 source lines.
- **The new Limits bullet holds against `src/adapters/host-claude/settings.ts`.**
  - The sandbox `denyRead` holds roots only (`:125`).
  - The secret globs become `Read(...)` deny rules (`:110`).
  - None of the secret globs covers `.git/` (`run-contract.ts:72`).
  - Nothing admitted decompresses an object file it names by path: `git show <hash>` is refused and `git cat-file` is not admitted.
- **The new Limitations bullet** (`git show` of a commit and `git log -p` are refused, and the `--stat` and `<rev>:<path>` alternatives work) is correct.
- **House rules are met.** There are no dashes, no delivery history in the containment prose, and no new headings.
- **Every `file:line` in findings.md resolves:**
  - `hook-decision.ts:237` (secret glob below staging), `:266` (write check), `:502`, `:510`, `:563` and `:748` (`decideReadBeforeEdit`).
  - `docs/containment.md:108` is the CON-1 row listing the git-object bypasses.
  - `settings.ts:125`.
  - `:717` and `settings.ts:130` are near misses, covered in the OBS below.

## Findings

**WARNING 1: the new findings.md entry for `docs/containment.md:108` says too much.**
- **Location:** `docs/system/findings.md`, the new line that starts `docs/containment.md:108`.
- **Problem:** It says "the hook now refuses those forms" (`git show <rev>:<path>`, `git log -p`). The hook refuses `git log -p`, but it admits `git show <rev>:<path>` and judges only the path part with the read rules (`hook-decision.ts:506-511`).
- **Problem:** Calling it a plain disagreement with the proposal overstates the fix. Part of the bypass still exists: a working-copy directory that is a symlink is judged by where the link points (`:510`, which is the entry's own next finding).
- **Proposed fix:** "the hook refuses `git log -p` and `git show` of a commit, and judges the path part of `git show <rev>:<path>` by the read rules, so a secret-glob path is refused (`:502`, `:563`) except through a working-copy directory symlink (`:510`)".
- **Confidence:** high.

**WARNING 2: the new Read rules paragraph in containment.md states its secret-file guarantee too widely, with a vague condition.**
- **Location:** the paragraph after read rule 4, starting "An operand of an admitted git command...".
- **Problem:** "a secret file is refused whether it is read from the working copy, from history or from the index" reads as a general guarantee. The new Limits bullet in the same change says code a contract command runs can read the same file.
- **Problem:** The condition "as long as the directories of its path are the same in the revision and in the working copy" is looser than what the code does. The real exception is that the path is resolved on the working copy's file system (`:510`), so a directory that is a symlink in the working copy is judged by its target.
- **Proposed fix:** "With the git output rules below, an admitted shell command cannot print a secret file from the working copy, from history or from the index, unless a directory on its path is a symlink in the working copy (see rule 12)."
- **Confidence:** high.

**OBS 1: two citations land one or three lines away from the cited code.**
- In findings.md, `src/domain/hook-decision.ts:717` points at `case 'meta':`. The allow it describes is at `:718`.
- In findings.md, `settings.ts:130` points at the `for` loop. The GSD hook entry that has no blocking flag is at `:133`.
- **Proposed fix:** cite `:718` and `:133`.
- **Confidence:** high.

**OBS 2: rules 12 and 13 open with a label fragment that rules 1 to 11 don't use.**
- **Location:** rules 12 and 13 begin "Git object names." and "Git output forms."
- **Proposed fix:** drop the labels, or accept them, since these two rules are long. Optional.
- **Confidence:** medium.

**OBS 3: one sentence in the new Limits bullet runs on.**
- **Location:** "The read rules do not refuse that directory, and `cat` of an object file there prints it compressed, and no admitted command decompresses...".
- **Proposed fix:** split it into two sentences at the second "and".
- **Confidence:** medium.

The rule 12 and 13 text and the check-order paragraph are careful, exact and complete against the code.

**Verdict: BOUNCE**
