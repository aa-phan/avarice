**Verdict: BOUNCE.** The review found one BLOCKER, one WARNING and five OBS.

Severity levels: **BLOCKER** means it cannot ship. **WARNING** means likely rework: fix it, but it does not block. **OBS** is worth noting.

## BLOCKER

**B1. The check order for rule 12 is the wrong way round.**
- **Location:** `docs/system/containment.md`, the paragraph after rule 13 ("For a git command the checks that follow the command match run in this order: ... rule 12 (the read rules on each object name's path part, then `shell-git-object`) ...").
- **Problem:** The code takes the operands one at a time. For each operand it tests for a brace and for a path part starting with `/`, `!` or `(` (both give `shell-git-object`) before it runs the read rules on that operand's path part.
- **Evidence:** `src/domain/hook-decision.ts:503-510` loops over the operands. Line 505 (brace) and line 507 (`/^[/!(]/`) return `GIT_OBJECT_RULE` before `checkRead` runs at line 509. You can see the difference in practice:
  - `git show :/.env` is `shell-git-object` in the code. The documented order would give `outside-read-set`, because `/.env` resolved from the root is outside the read set.
  - `git show HEAD@{1}:x HEAD:.env` is `shell-git-object`. The documented order would give `deny-secret-read`.
- **Fix:** "rule 12 (for each object name in turn: `shell-git-object` for a brace or a path part starting with `/`, `!` or `(`, then the read rules on its path part)". The `shell-git-object` for a `git show` operand that is not an object belongs to rule 13, after the option test, which the next sentence already says.
- **Confidence:** high.

## WARNING

**W1. "An option's position never changes the decision" is false for words after `--` and for the word that `-n` consumes.**
- **Location:** `containment.md`, the last sentence of the check-order paragraph.
- **Evidence:** `checkGitOutput` stops at a bare `--` (`hook-decision.ts:571`), so `git log -p` is `shell-git-output` and `git log -- -p` is admitted. `-n` at the end of a cluster skips the next word (line 587), so `git log -n -p` gets past the option allow-list. Git rejects that command itself, but the hook's decision still depends on where the option sits.
- **Fix:** Narrow the sentence, for example: "Among the options before a bare `--`, order does not change the decision; a word after `--` is an operand (rule 11)." Or delete it.
- **Confidence:** high.

## OBS

**O1. The reason given for refusing `!` and `/` holds only for the index form.**
- **Location:** rule 12, "because git does not read these as a plain path ... `<revision>:/path` is not a lookup at all".
- **Problem:** After a revision, `HEAD:!x` is a plain tree path in git. `HEAD:/path` is a tree lookup that fails; it is still a lookup.
- **Fix:** Say the refusal is fail-closed for both forms, and that the magic readings apply to the `:`-prefixed form and to pathspecs.
- **Confidence:** medium. Git's handling of `<rev>:/path` was not checked against git source.

**O2. `:^` is pathspec magic too, and rule 12 does not list it.**
- **Location:** rule 12.
- **Problem:** `:^x` is negation, the same as `:!x`. The code does not refuse it (`hook-decision.ts:507`) and judges `^x` as a plain path. That is harmless, because exclusion prints no content. But the sentence implies that `/`, `!` and `(` are the only magic leaders.
- **Fix:** Add one clause saying `:^` is let through because it only excludes paths.
- **Confidence:** high on the code, low on how much it matters.

**O3. The empty path part has two candidates, not one.**
- **Location:** rule 12, "An empty path part resolves to the working copy root".
- **Problem:** The second candidate resolves to the shell's directory (`absolutize(shellCwd, '')`, line 509). The claim about which path git reads still holds.
- **Fix:** "An empty path part resolves to the working copy root and to the shell's directory, which the read rules allow."
- **Confidence:** high.

**O4. "Compared as whole words" fits only the long options.**
- **Location:** the opening of rule 13.
- **Problem:** Short options are read one character at a time within a cluster (lines 583-591). So `-sbz` is admitted for `git status`, and `-sn5` for `git log`.
- **Fix:** "Long options are compared as whole words; short options are read per character in a cluster."
- **Confidence:** high.

**O5. The read-rules paragraph credits path judgement alone with refusing history reads, and the object-store sentence is ambiguous.**
- **Location 1:** `containment.md`, the new read-rules paragraph, "A secret file is therefore refused whether it is read from the working copy, from history or from the index."
  - **Problem:** History reads through `git log -p` or `git show <commit>` are refused by rule 13, not by judging the path. The "therefore" claims more than the sentence before it supports.
  - **Fix:** "With rule 13, a secret file is refused..."
- **Location 2:** the Limits of containment bullet, "no admitted command prints an object's content except by a path the read rules judge".
  - **Problem:** `cat` on a loose object under the clone's git directory prints that object's zlib-compressed bytes. The read rules judge that path and allow it. So the sentence is true only in the sense that the output is compressed.
  - **Fix:** Say so directly: "`cat` of an object file prints it compressed; no admitted command decompresses it."
- **Confidence:** medium.

## Checked and correct

- **Option lists:** The `git log` and `git status` lists in rule 13 match `GIT_OUTPUT_FORMS` exactly (`hook-decision.ts:532-556`), including the duplicated `--pretty`, `--decorate` and `--porcelain`, `--untracked-files`, `--ignored`.
  - `-s` and `-n` for `git log`, with `-n` taking its count attached or as the next word, are correct.
  - The `-<digits>` count is admitted only for `git log`: `counts` is true only there, and status and show refuse it (lines 574-577 and 566).
  - `-u` for `git status` takes its mode attached only (lines 585 and 346).
- **`git show`:** Any word that starts with a dash is refused, `--` and `-` included (line 566). No operand, or an operand without a colon, gives `shell-git-object` (line 567). `git show -s HEAD` is `shell-git-output`.
- **Object name parsing:** stage numbers 0 to 3 (`/^:[0-3]:/`, line 506); the split at the first colon, which matches git when no brace is present; the two-candidate read check (line 509); the order of read check, then rule 12, then rule 13 (lines 630-633).
- **Command-level claims:** `git -c` is `shell-denied-prefix` and a git global option gives `shell-not-allowed` (lines 617-619). `git show HEAD:` lists the names in the root tree.
- **Rule IDs:** the two new IDs are picked up by the `_RULE = ` alternative of the coverage grep. That makes 35 IDs: 6 on allow decisions and 30 on deny decisions, with `subagent-type` on both. `containment.md` and `coverage.md` agree (35 of 35).
- **Limits bullet:** `settings.ts:125` puts roots only in `denyRead`, and `settings.ts:110` turns the secret globs into `Read(...)` deny rules, so the bullet's sandbox claim holds.
- **findings.md citations:**
  - `:262` is `checkWrite`.
  - `:747` is `decideReadBeforeEdit`.
  - `:716` is the `meta` allow.
  - `:237` is the secret-glob test below the working copy.
  - `:502` is `checkGitObjects`.
  - `:562` is `checkGitOutput`.
  - `docs/containment.md:108` lists the git-object bypass.
  - `settings.ts:125` is `denyRead`.
  - The self-references `findings.md:91` and `:89` still point at the right lines.
- **House rules:** none of the added lines has an em or en dash, a file path, a function name or a phase or plan ID. The prose is precise, and the rationale given for each refusal is a real strength of the change.

**Verdict: BOUNCE**
