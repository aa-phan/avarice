I read every added line of `containment.md` and `findings.md` and checked each one against `src/domain/hook-decision.ts` and `src/adapters/host-claude/settings.ts` at HEAD. **Verdict: BOUNCE.** There is one BLOCKER and two WARNINGs. The BLOCKER is a false claim in the prose that comes from a gap in the code, where `git status -u -v` gets past the hook.

Severities: **BLOCKER** means it cannot ship, **WARNING** means it needs rework but does not block, and **OBS** is worth noting.

## BLOCKER

**B1. "An option's position never changes the decision" is false, and the reason is a gap in the code.**
- **Location:** `docs/system/containment.md`, the paragraph after rule 13 (diff line 33). Also rule 13's `git status` bullet, which says `-u` takes "its mode attached or in the next word".
- **Problem:** `GIT_OUTPUT_FORMS['git status'].shortValued` is `'u'`. When `-u` ends a word, `checkGitOutput` (`hook-decision.ts:580-582`) skips the next word with `i += 1`. `parseReadArgs` also takes that word as a value, because `SHORT_VALUE_OPTIONS['git status']` is `'uM'` (`:345`). Real git does not work this way: `-u` only takes a mode attached to it (`-uno`), never the next word. So:
  - `git status -v -u` is refused with `shell-git-output`.
  - `git status -u -v` and `git status -u -vv` are admitted. Git then reads `-v` as verbose and prints the staged diff, and the working-tree diff with `-vv`. That is file content, including a modified or staged secret file.
- The sentence is wrong about the code. The rule 13 bullet describes the code correctly but not git, and that mismatch is where the bypass comes from.
- **Fix:** the code has to change first: `-u` should take only an attached mode. Then rewrite the bullet to say "its mode attached". Keep the position sentence only once it is true. If the code stays as it is, remove the sentence and add a `findings.md` line at `hook-decision.ts:580`.
- **Confidence:** high on the code path. High on git's `-u` behaviour (it is an optional argument in git's option parser) and on `status -v` printing the staged diff.

## WARNING

**W1. The stated check order is wrong for `git show` with an option and a bare revision.**
- **Location:** `containment.md`, diff line 33: "… `shell-git-object`, `shell-git-output`."
- **Problem:** `checkGitObjects` (`:501`) only looks at words that contain a colon. The `git show` check for "no operand or a bare revision" sits inside `checkGitOutput`, after its option test (`:561-562`). So `git show -s HEAD` returns `shell-git-output`, but the order as written predicts `shell-git-object`.
- **Fix:** add a sentence such as: "For `git show`, the option check comes before the check that every operand names an object by path."
- **Confidence:** high.

**W2. "Give the same information" overstates what the replacement commands show.**
- **Location:** `containment.md`, the new Limits bullet (diff line 54).
- **Problem:** `git log -1 --stat <revision>` prints only file names and line counts. `git show <revision>:<path>` prints a whole file. Neither prints the diff that `git log -p` or `git show <commit>` would, so the claim is only loosely true.
- **Fix:** "… recover the changed paths and each file's content at a revision, but not the patch itself."
- **Confidence:** high.

## OBS

- **O1.** In `findings.md:102` the "(now at …)" notes moved "it still holds for the onboarding purposes" into a line-location parenthetical, so the sentence now reads as if it were about the location. The new notes also drop the backticks the other references use. Suggest putting the qualifier back next to the `72a86b1` clause and writing the path as `` `src/domain/hook-decision.ts:262` ``. Confidence: high.
- **O2.** Diff line 38, "and every git operand that names an object only as rule 12 allows", is missing its verb. Suggest "… and a git operand that names an object is admitted only as rule 12 allows." Confidence: high.
- **O3.** Rule 12 says a brace is refused "because git resolves a reflog or date form at a colon the hook does not see". The hook does see the colon; it splits at the first one, and git may split somewhere else (for example in `HEAD@{10:00}:x`). Suggest "… because a reflog or date form can hold a colon, and git would split the word at a different colon from the hook". Confidence: medium.
- **O4.** Rule 13 ends "The options are an allow-list because they print no file content". This mixes two reasons. The options were chosen because they print no file content; the list is an allow-list because git accepts abbreviated options and patch-implying spellings, as the code comment at `:516-517` says. Confidence: medium.
- **O5.** Rule 13's opening names only `git log` and `git status`, but its third bullet covers `git show`. Suggest adding "`git show` takes no option at all" to the opening sentence. Confidence: low.
- **O6.** In the Limits bullet, "The secret globs hold the model's own tools …" uses an unusual verb. Suggest "The secret globs confine …". Confidence: medium.

## Checked and correct

- **Option lists:** the `git log` and `git status` lists match `GIT_OUTPUT_FORMS` (`:529-552`) exactly: every short letter, the 23 and 12 flags, and the 13 and 5 valued options, including `--pretty` and `--decorate` appearing in both forms.
- **Rule 12 against the code:**
  - The stage regex is `^:[0-3]:`, so stage numbers 0 to 3 are right.
  - A slash, `!` or `(` at the start of the path part is refused (`:506`).
  - The path is checked twice, from the working copy and from the shell's directory, and both must pass (`:508`).
  - An empty path part resolves to the root, which `readRule` never matches against a secret glob (`:237`).
  - Quoted words are allowed, so a brace can reach the check, and the rule is not dead code.
- **Rule 12 against git:** both the two resolution bases and the root-tree listing match git.
- **`git show`:** any word starting with a dash, `--` included, is `shell-git-output` (`:561`). A count option is admitted only where `counts` is true, which is `git log` alone.
- **Global options:** `git --no-pager log` and `git -C dir show` give `shell-not-allowed`, and `git -c` gives `shell-denied-prefix`, because the denied-prefix check runs first (`:611-613`).
- **Limits bullet:**
  - The sandbox `denyRead` holds roots only (`settings.ts:125`).
  - The secret globs become `Read` deny rules (`settings.ts:110`).
  - The clone holds only tracked files: it is made with `git clone --local --no-checkout` (`staging-clone.ts:65`).
- **`findings.md` references:** every one checks out.
  - `hook-decision.ts:262` is `checkWrite`, `:741` is `decideReadBeforeEdit`, `:710` is the meta allow, and `:237` is the secret-glob test below the working copy.
  - `:501` and `:557` are the two new checks, and `settings.ts:125` is `denyRead`.
  - `docs/containment.md:108` holds the "Known bypasses that remain: … git objects" text.
  - `findings.md:91` and `:89` still point at the lines they describe.
- **`coverage.md`:** consistent. 35 = 6 + 30 − 1, the two new IDs are `shell-git-object` and `shell-git-output`, and the document says 35 and 30.
- **House style:** no em or en dashes, no function names or delivery history in the prose, and no new headings. The new rules are precise, and they name the option and rule IDs that make up the contract surface.

**Verdict: BOUNCE**
