**Verdict: BOUNCE.** There is one WARNING and no BLOCKER. Every code claim I checked holds at HEAD. One sentence breaks the 35-word cap.

Severity: **BLOCKER** means it cannot ship. **WARNING** means fix it before shipping, though it is not a correctness defect. **OBS** is worth noting and is not blocking.

## WARNING

**W1. A sentence runs to 48 words, over the 35-word cap.**
- **Location:** `docs/system/containment.md:219`, the paragraph's first sentence ("An operand of an admitted git command that names a git object by path (a revision and a path joined by a colon, … ) is judged by these rules on its path part.").
- **Evidence:** I counted 48 words in running prose. Most of the length is the parenthesis listing the three forms in words.
- **Fix:** Use the notation rule 12 already uses: "An operand of an admitted git command that names a git object by path (`<revision>:<path>`, `:<path>` or `:<stage>:<path>`) is judged by these rules on its path part." That leaves about 27 words.
- **Confidence:** high.

## OBS

**O1. Rule 12's first sentence says more than git does for two of the commands.**
- **Location:** `containment.md:266`, "A word with a colon in the operands of an admitted git command names a git object by path".
- **Evidence:** The hook runs `checkGitObjects` on every git entry (`hook-decision.ts:633-634`), and that includes `git ls-files` and `git rev-parse`. But git reads a colon word given to `ls-files` as a pathspec, not an object name. The hook's behaviour is described correctly; git's reading of the word is not.
- **Fix:** "…is treated as a git object name by path…".
- **Confidence:** medium.

**O2. In rule 12, "Otherwise" is far from what it refers to.**
- **Location:** `containment.md:266`, "Otherwise the path part is given the read rules twice."
- **Evidence:** It refers back to the refused forms three sentences earlier. The sentences in between are about message search and pathspecs. The rule is a single numbered item of roughly 250 words.
- **Fix:** "A path part that passes these tests is given the read rules twice."
- **Confidence:** medium.

**O3. The Limits bullet may undersell what the object store holds.**
- **Location:** `containment.md:436`, "The git object store under the clone's git directory holds the committed files compressed."
- **Evidence:** The clone is made with `git clone --local --no-hardlinks --no-checkout` (`src/adapters/git/staging-clone.ts:65`). That copies the source repository's objects, so the store holds its whole history, not only the files at the pin. The sentence just before it is about the pin, so a reader may take it as pin-only.
- **Caveat:** I did not trace whether the run purpose uses this same clone function or prunes the store afterwards.
- **Fix:** "…holds every committed object of the source repository's history, compressed."
- **Confidence:** medium.

**O4. The two option-list bullets are each one sentence of 90 words or more.**
- **Location:** `containment.md:268-269`.
- **Evidence:** They are list items enumerating the contract surface, so the prose cap arguably does not apply. They match `GIT_OUTPUT_FORMS` exactly (see the checks below).
- **Fix:** Optional. Split "the short options …" and "the long options …" into separate sentences.
- **Confidence:** low.

**O5. Two lines near the edited findings were left stale.**
- **Location:** `findings.md:86-87`. These lines are not in the diff.
- **Evidence:** The pass moved `settings.ts:113` to `:133`, so `settings.ts` shifted by about 20 lines. Lines 86-87 still cite `settings.ts:157` and `settings.ts:165`. At HEAD, line 157 is the PostToolUse entry and line 165 is blank. The hook command is now near `:169-171` and the GSD guard near `:175-178`.
- **Fix:** Add "(now at …)" annotations to both lines.
- **Confidence:** high.

## Checks that passed against the code

- **Rule-ID count.** I ran the coverage regex with Grep. It finds 35 unique IDs: 6 on allow decisions (`write-set`, `read-set`, `subagent-type`, `meta`, `shell-identity`, `agent-command`) and 30 on deny decisions, with `subagent-type` on both. This agrees with containment.md and with both coverage.md rows (35, and 35 of 35). There are 117 `*.test.ts` files on disk, which matches the ledger.
- **Option lists.** Rule 13's lists equal `GIT_OUTPUT_FORMS` (`hook-decision.ts:533-558`) entry for entry:
  - `git log`: 23 options without a value, 13 that take a value.
  - `git status`: 12 without, 5 with.
  - The "listed both bare and with a value" sets are correct.
  - The value must be non-empty (`:581`).
  - `-u` takes its mode only attached, because it is in `shortAttached` and missing from `SHORT_VALUE_OPTIONS['git status']`.
  - `-n` takes its count attached or as the next word (`:587-589`).
  - A count `-<digits>` is admitted only for `git log` (`counts`, `:575-577`).
  - `git show` rejects any word starting with a dash, including `-` and `--` (`:567`).
  - With no operand, or an operand with no colon, `git show` is `shell-git-object` (`:568`).
- **Rule 12 code paths.**
  - Stages 0 to 3 match the regex `^:[0-3]:` (`:506`), and that agrees with how git splits a `:n:path` name.
  - A brace is refused only in words that contain a colon (`:504-505`).
  - The leading `/ ! ( ^` and the `* ? [ \` wildcard tests are at `:508`.
  - The two-candidate check (working copy root and shell directory, both must pass) is at `:510`.
  - Symlinks are judged by their target because `checkRead` canonicalizes the path.
  - The empty path part is judged as the working copy root, which is allowed because the root is never glob-matched (`:237`).
  - The pathspec explanation fits git's behaviour: `:` followed by a magic character, or a word containing a glob character or backslash, is read as a pathspec.
- **Check order.** The order matches `checkSegment` (`:622-634`). So do `git show -s HEAD` being `shell-git-output`, `git --no-pager log` and `git -C` being `shell-not-allowed`, and `git -c` being `shell-denied-prefix` (denied prefixes are tested before the command match). A contract command is not held by rule 12, because `matchAgentCommand` returns before the check.
- **Limits bullet against settings.ts.** The sandbox `denyRead` holds roots only (`settings.ts:125`, and `invocation-scope.ts:291` and `:519`). The secret globs become `Read(...)` deny rules (`settings.ts:110`).
- **findings.md citations.**
  - In `hook-decision.ts`: `:266` (the write decision), `:748` (`decideReadBeforeEdit`), `:718` (meta allow), `:237` (globs only below staging), `:563` (`checkGitOutput`), `:502` (`checkGitObjects`) and `:510` (the two-candidate check) are all correct.
  - In `settings.ts`: `:133` (the GSD hook entry, with no blocking flag), `:125` and `:110` are correct.
  - In docs: `docs/containment.md:108` does list the git-object bypass, and `findings.md:91` and `:89` point to the entries they quote.
- **House rules.** I found no em or en dashes and no new headings. The containment prose has no file paths, function names, phase numbers, plan IDs or SHAs. findings.md carries `file:line` as allowed.

## Checks I could not run

- Shell commands were denied, so I did not run git. I could not confirm the order of commits `9383cb8`, `42156c7` and `fdc29c6`, or coverage.md's statement that "the only code changed after it is the hook's git rules and one comment".
- I did not recount the 26,261 source lines.
- I did not run real `git show` or `git log` to test the hook's claims against live git. The git-behaviour judgements above come from git's documented name and pathspec parsing.

The good news: rules 12 and 13 and the check order match the code closely, the option lists are exact, and the findings citations were carefully re-anchored.

**Verdict: BOUNCE** (one WARNING: W1).
