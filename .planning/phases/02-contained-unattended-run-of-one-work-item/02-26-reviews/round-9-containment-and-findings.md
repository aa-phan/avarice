I've started two separate reviewers in the background, one for `docs/system/containment.md` and one for `docs/system/findings.md`. The second one also checks that the counts in `docs/system/coverage.md` match the documents. Neither one edits files.

I couldn't hash the files myself because shell commands are blocked in this session. Each reviewer will compute the SHA-256 of the file it reviews and report it, so each verdict applies to that exact version.

When both finish, I'll pass on their findings unchanged: blockers, then warnings, then observations, each with its digest. After that comes one combined verdict line: PASS (no blocker or warning) or BOUNCE.

The `findings.md` and `coverage.md` reviewer stopped before reviewing anything. Shell commands are blocked here as well, so it couldn't compute the SHA-256 digests or run the commands in the `coverage.md` ledger.

I've restarted it with file reading and search only. It will:
- check every `file:line` and "(now at ...)" citation against the code;
- check each claim in the three new findings against the code;
- count the hook rule IDs (total, allow and deny) by searching the two hook source files;
- list the digest and the source-line and test-file counts as not run.

That means neither verdict will be tied to a digest. To get digest-bound verdicts, allow `shasum` and read-only `git`, `grep` and `wc` for this session, and both reviews will run again in full.

The `containment.md` reviewer is still running and will probably hit the same block. I'll pass on both reports when they come back.

The `findings.md` and `coverage.md` reviewer has finished. I'll hold its report until the `containment.md` reviewer is done, then pass both on together.

Its verdict is BOUNCE, on two warnings:
- `docs/system/coverage.md:70` still records "33 rule IDs" as verified for `containment.md`. Every other count now says 35.
- The new finding at `docs/system/findings.md:125` is a single sentence of about 100 words. That breaks the 35-word maximum per sentence, so it should be split into three.

It also made three observations that don't block:
- `findings.md:127` cites `settings.ts:125`, but the claim that the secret globs become Read deny rules is at `settings.ts:110`. The phrase "into the transcript" isn't backed by the code.
- The new finding at `findings.md:126` and the paragraph that records when the counts were taken (`coverage.md:7`) are long sentences that should be split.
- It couldn't check that paragraph's claims about which commits changed code, because `git log` was blocked.

Everything else it checked held up:
- Every `file:line` citation and every "(now at ...)" annotation points to the right line.
- Searching the two hook files gives 35 rule IDs: 6 on allow decisions and 30 on deny decisions, with `subagent-type` on both.
- The `git log` and `git status` option lists match the code.
- There are no em or en dashes.

Shell access was blocked for this reviewer too, so the verdict isn't tied to a digest. It couldn't recompute the source-line and test-file counts either.

# Prose review: changed parts of `containment.md` and `findings.md` (counts in `coverage.md`)

**Verdict: BOUNCE.** There are no blockers, but there are five warnings. Two separate reviewers found the technical content matches the code; the rework is splitting long sentences, two scoping or sourcing fixes, and one stale count. Neither verdict is tied to a SHA-256 digest: shell commands were blocked here, so neither reviewer could run `shasum`, the source-line and test-file count commands, `git log`, or real `git`.

## `docs/system/containment.md` (digest not computed)

**WARNING 1: eight sentences in running prose are over the 35-word maximum.**
- Rule 12: "So is a path part that starts with a slash, `!`, `(` or `^` …" (about 70 words).
- Rule 12: "The path is resolved on the working copy's file system …" (about 46).
- Rule 12: "An empty path part is judged as the working copy root …" (about 40).
- Rule 12: "Otherwise the path part is given the read rules twice …" (about 36).
- Rule 13: "They are an allow-list, because git accepts an abbreviated long option …" (about 40).
- Rule 13, the `git show` item: "With no operand, or with an operand that has no colon …" (about 38).
- The check-order paragraph, first sentence (about 75).
- The new paragraph after read rule 4: "With the git output rules below, an admitted read-only command cannot print a secret file …" (about 42).
- Fix: split each into one claim per sentence.

**WARNING 2: one claim in the Limits bullet has no source.**
- The sentence: "The clone starts with only the files committed at the pin; installs and the run's own writes add more."
- The reviewer found nothing in the code or the document that ties the clone's contents to the pin. The only nearby context is the pin mentions at `containment.md:391` and `:393` and a `--no-checkout` clone option at `:372`.
- It matters because this sentence is what limits "present in the clone".
- Fix: cite the clone code, restate it in terms the document already defines, or drop it.

**WARNING 3: the new paragraph after read rule 4 contradicts the Limits bullet.**
- The paragraph says an admitted read-only command "cannot print a secret file from the working copy, from history or from the index".
- The Limits bullet says `cat` of an object file under the clone's git directory prints the committed file compressed, and the read rules don't refuse that directory.
- Fix: narrow the guarantee to "print a secret file's content in readable form", or add "(see Limits of containment)" for the object store, as the paragraph already does for contract commands.

**OBS 1: the rule 13 option lists match `GIT_OUTPUT_FORMS` exactly** (`hook-decision.ts:533-558`).
- `git log`: `-s`, `-n`, the `-<digits>` count, 23 options without a value and 13 with `=value`.
- `git status`: `-s`, `-b`, `-z`, `-u` with its mode only attached, 12 options without a value and 5 with `=value`, and no count.
- `--pretty` and `--decorate` each appear twice in one sentence. That is accurate but easy to misread. Optional fix: say "both bare and with a non-empty `=value`".

**OBS 2: the term for an object name changes from place to place.** The text uses "git object names", "names a git object by path", "an object by path" and "an object name". Pick one, for example "object by path".

**OBS 3: these claims about git were checked against the code only, not against real git:**
- that a quoted `:*` is read as a pathspec (git may treat it as a literal index path; the hook refuses it either way);
- that `--pat` is accepted as `--patch`;
- that `:!` and `:(` are pathspec magic.

If they were tested, keep them; otherwise soften the wording.

**What held against the code:**
- The rule ID count is 35: 6 on allow decisions, 30 on deny decisions, with `subagent-type` on both. The two new IDs are `shell-git-object` and `shell-git-output`.
- Rule 12 matches `checkGitObjects`:
  - stage numbers 0 to 3;
  - a brace anywhere in the word is refused, and so is a path part that starts with `/`, `!`, `(` or `^`;
  - a wildcard or backslash in the path part is refused;
  - an empty path part is judged as the working copy root and as the shell's directory;
  - the path part is checked from both places, and both must pass.
- `git show`:
  - it refuses every word that starts with a dash, including `--` and a lone `-`;
  - with no operand, or an operand without a colon, it is `shell-git-object`;
  - the option test comes first, so `git show -s HEAD` is `shell-git-output`.
- The check order matches `checkSegment`.
- A global option before the subcommand is `shell-not-allowed`, and `git -c` is `shell-denied-prefix`.
- `settings.ts:125` denies reads by root, and `:110` turns the secret globs into Read deny rules, so the Limits bullet's premise holds.
- The known-gap bullet holds: `git log -p` and `git show` of a commit are refused, and `git log -1 --stat <rev>` is admitted.
- The house rules hold: no em or en dashes, no file paths, function names or delivery history in the prose, and no new headings.
- One check is incomplete: the reviewer did not open the path-resolution helper to confirm how symlinks are resolved.

## `docs/system/findings.md` and `coverage.md` (digests not computed)

**WARNING 4: `coverage.md:70` still says "33 rule IDs".** It is the note recording what was verified when `containment.md` was last reviewed. Every other count now says 35, and the document changed after that review. Fix: once `containment.md` passes review, update the note to 35 and to what this review covered. Until then, don't mark it as reviewed.

**WARNING 5: the new finding at `findings.md:125` is one sentence of about 100 words.** It makes three claims: the proposal's list of bypasses, what the hook now refuses, and the symlink exception. Fix: split it into three sentences and keep the ending "Spec contradiction; … the owner decides which side moves."

**OBS 4: `findings.md:127` cites a line that supports only half its claim.**
- `settings.ts:125` (`denyRead: scope.denyRead.map(marked)`) supports "denies reads by root only".
- The secret globs become Read deny rules at `settings.ts:110`. Add that citation.
- "into the transcript" isn't backed by the code; `containment.md` says only "print it".

**OBS 5:** `findings.md:126` (about 55 words) and the paragraph recording when the counts were taken (`coverage.md:7`, about 85 words) should be split. That paragraph's claim about which code changed after `fdc29c6` could not be checked without `git log`.

**What held:**
- Every citation and "(now at …)" note points at the right line:
  - `hook-decision.ts:266` is the write check;
  - `:748` is the read-before-edit check;
  - `:718` is the `meta` allow;
  - `:237` is the secret-glob test below staging;
  - `:502` is `checkGitObjects`, `:563` is `checkGitOutput`, and `:510` is the read check on the path part;
  - `settings.ts:133` is the non-blocking GSD hook entry;
  - `docs/containment.md:108` holds the bypass text.
- The references to `findings.md:91` and `:89` still point at the right findings.
- The three new findings match the code.
- The rule ID counts in `coverage.md` (35, 6 allow, 30 deny, and "35 of 35") match a search of the code.
- No em or en dashes.

**Not checked (shell blocked):** the source-line count (26,261) and the test-file count (117).

---

**Verdict: BOUNCE** (5 warnings, 0 blockers; not tied to a digest).

When the fixes are made, both files need a fresh review, bound to their new digests. Allowing `shasum` and read-only `git`, `grep` and `wc` would let that review also run the commands that were skipped this time.
