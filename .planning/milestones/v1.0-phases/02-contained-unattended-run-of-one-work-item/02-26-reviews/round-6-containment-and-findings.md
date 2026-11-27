**Verdict: BOUNCE.** I found 1 BLOCKER, 2 WARNINGs and 6 OBS.

Severity levels: **BLOCKER** means it can't ship until fixed. **WARNING** means likely rework, but it doesn't block. **OBS** is worth noting.

Bash was denied in this session, so I couldn't run git, the coverage commands or the tests. I checked everything by reading the code at HEAD and the diff. The git behaviour below comes from git's own argument handling (`setup.c`, `pathspec.c`), not from a test run.

## BLOCKER

**B1. A quoted wildcard after a leading colon gets past the hook, so `git show` can still print a secret file from history.**
- **Location:** `containment.md` in three places: the new paragraph after read rule 4 ("a secret file is refused whether it is read from the working copy, from history or from the index"), the reasoning in rule 12, and the new Limits bullet on `git show`. Also `findings.md`, the new `docs/containment.md:108` line ("the hook now refuses those forms").
- **What happens in the hook:**
  - The lexer keeps a quoted `*`, `?` or `[` and does not mark the word as expanding (`src/domain/hook-decision.ts:300-305`, `:325`). So `git show ':*'` and `git show ':.env*'` reach `checkSegment` without a `shell-syntax` refusal.
  - `checkGitObjects` (`:502-513`) takes the path part `*` or `.env*`. That part doesn't start with `/ ! ( ^`.
  - `canonicalAbsolute` adds a path that doesn't exist literally (`src/adapters/fs/canonical-path.ts:47-53`). The secret globs (`**/.env`, `**/.env.*` and so on) don't match the literal `*` or `.env*`.
  - Both checks pass, and `checkGitOutput` admits the word because it has a colon.
- **What git does with it:**
  - Git can't find `:*` in the index, so it doesn't treat the word as a revision.
  - `verify_filename` then accepts the word as a pathspec, because `looks_like_pathspec` returns true for any word containing a wildcard.
  - `parse_short_magic` stops at `*`, which isn't a magic character. The pathspec becomes `*`.
  - `git show` falls back to HEAD and prints HEAD's patch for every matching path, including a secret file the pin commit added or changed.
- **Fix:** In the code, refuse `*`, `?`, `[` and `\` in the path part of a word that starts with a colon, or in any object name. Until that's done, the three doc claims and the findings line overclaim and must be qualified. The findings line should also record the bypass.
- **Confidence:** medium-high. The hook trace is certain. The git side is from reading git's source, not from a run.

## WARNING

**W1. The check-order paragraph says rule 13 always gives `shell-git-output`, but for `git show` it can also give `shell-git-object`.**
- **Location:** `containment.md`, the paragraph after rule 13: "rule 13 (`shell-git-output`)".
- **Evidence:** `checkGitOutput` returns `GIT_OBJECT_RULE` when `git show` has no operand or an operand without a colon (`src/domain/hook-decision.ts:567`). The rule 13 bullet says this correctly, so the order paragraph contradicts it.
- **Fix:** write "rule 13 (`shell-git-output`, or `shell-git-object` for a `git show` operand that is not an object by path)".
- **Confidence:** high.

**W2. In the new "Secret files read by code the run executes" bullet, "no admitted command decompresses it" reads as reassurance, but the bullet is about code a contract command runs, which can decompress objects.**
- **Location:** `containment.md`, Limits of containment, the new bullet.
- **Evidence:** "Admitted command" means the hook's read-only commands. The bullet's subject is code that a contract command runs, which the hook doesn't limit (the bullet's own third sentence says so). Also, the admitted `git show <rev>:<path>` does decompress objects, just not by file path.
- **Fix:** say "none of the model's admitted shell commands decompresses an object file it names by path", or drop the object-store sentences from this bullet.
- **Confidence:** medium.

## OBS

- **O1.** In the paragraph after read rule 4, "A shell operand that names a git object by path" could be read as covering `cat HEAD:.env`. Only operands of admitted git commands are checked (`src/domain/hook-decision.ts:632-633`). Suggest "An operand of an admitted git command". Confidence: high.
- **O2.** In rule 12, "An empty path part names the working copy root and the shell's directory" says one word names two things. The hook judges it as both. Suggest "is judged as the working copy root and as the shell's directory". Confidence: high.
- **O3.** In rule 12, "or as something other than a path below the working copy root" is vague for the `<revision>:/path` case. Name the form, or drop the clause. Confidence: medium.
- **O4.** `findings.md`: the "now at" notes are placed three different ways:
  - "(…:526, now at …:266)" inside the citation
  - "(intent unknown) (now at …)" at the end of the line
  - "`settings.ts:113` (now at …)" right after the location

  Pick one placement. All the targets are correct: `:266`, `:747`, `:716`, `:237` and `settings.ts:130` hold the cited behaviour.
- **O5.** The limits bullet says "The clone starts with only the files committed at the pin". I didn't check this against the clone code. Confirm it, or cite where it comes from.
- **O6.** I couldn't recount `coverage.md`'s "Source lines 26,260" and "Test files 117" because Bash was denied. Re-run both commands before marking the ledger reviewed.

## Checked and correct

- **Option lists:** the rule 13 lists match `GIT_OUTPUT_FORMS` exactly, including order. That's 23 `git log` flags and 13 valued options, and 12 `git status` flags and 5 valued options. `-s` and `-n` behave as described, `-<digits>` is accepted only for `git log`, `-u` takes its mode attached only, and `git show` takes no option.
- **Rule 12 mechanics** match `checkGitObjects`:
  - stage numbers 0 to 3, which is also git's own range; `:4:x` is a path in both the hook and git
  - braces refused anywhere in the word
  - path parts starting with `/`, `!`, `(` or `^` refused
  - two path candidates, from the working copy root and from the shell's directory, and both must pass
  - paths resolved on the working copy's file system
- **Check order:** matches `checkSegment` lines 621 to 633. `git show -s HEAD` is `shell-git-output`. `git -C` is `shell-not-allowed` and `git -c` is `shell-denied-prefix`. The `git show` dash rule covers a lone `-` and a bare `--` (`:566`).
- **Rule count:** 35 distinct rule IDs (my own Grep with the same regex), with 6 on allow decisions and 30 on deny decisions; `subagent-type` is on both. `coverage.md`'s "35 of 35" agrees.
- **Sandbox and secret globs:** the sandbox `denyRead` holds roots only (`settings.ts:125`), and the secret globs become Read deny rules (`:110`).
- **findings.md citations:** `docs/containment.md:108` is the bypass row the new line quotes. The self-references `findings.md:89` and `:91` still point at the right lines.
- **House rules:** no em or en dashes, no function names, and no phase or plan IDs in the `containment.md` prose. The new prose is precise about the contract surface.

Verdict: BOUNCE
