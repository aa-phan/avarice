**Verdict: PASS.** I found no BLOCKER and no WARNING, only six OBS findings. Every changed claim in `containment.md` and `findings.md` matches the code at HEAD.

Severity: **BLOCKER** means it cannot ship. **WARNING** means it needs rework but does not block. **OBS** is worth noting.

## Findings

**BLOCKER:** none.

**WARNING:** none.

**OBS-1.** The sentence "A backslash is a quoted word that git would read as a pathspec" says something false as written.
- **Location:** `docs/system/containment.md`, read-only commands, rule 12.
- **Problem:** A backslash is a character, not a word. The code comment at `src/domain/hook-decision.ts:507` means something narrower: a backslash only reaches git inside a quoted word that the lexer kept, and git treats `\` as a glob character, so it reads the word as a pathspec.
- **Fix:** "A backslash reaches git only inside a quoted word, and git reads a word that holds one as a pathspec."
- **Confidence:** high.

**OBS-2.** Rule 12 is one list item of about 17 sentences, and its reasons come after all three refusals.
- **Location:** `docs/system/containment.md`, rule 12.
- **Problem:** The brace sentence carries its own reason. The reasons for the slash, `!`, `(`, `^`, wildcard and backslash refusals only arrive three sentences later, so the reader has to match each reason to its refusal. Rule 13 next to it uses sub-bullets.
- **Fix:** Split rule 12 the same way: the forms, the refused forms each with its reason, then how the path part is resolved (two checks, symlinks, empty path part).
- **Confidence:** medium.

**OBS-3.** Item 5 of the check-order list repeats rule 12's refusal list word for word.
- **Location:** `docs/system/containment.md`, the git check-order list, item 5.
- **Problem:** The same list now lives in two places (one fact, one home).
- **Fix:** "Rule 12, per object name: `shell-git-object` for a refused form, then the read rules on its path part."
- **Confidence:** medium.

**OBS-4.** "git prints names only for it": the word "it" is ambiguous.
- **Location:** `docs/system/containment.md`, the end of rule 12.
- **Fix:** "`git show <revision>:` prints the names in that root tree, not file content."
- **Confidence:** low.

**OBS-5.** The new anchor for the hook-command finding points at the wrong line.
- **Location:** `docs/system/findings.md:86`.
- **Problem:** The finding's claim is "runs node with the hook entry, `--event` and `--policy`". `settings.ts:129` only calls `hookEntry`. The `--event` and `--policy` arguments are built at `src/adapters/host-claude/settings.ts:59`.
- **Fix:** Anchor to `:59`, or cite both lines.
- **Confidence:** medium.

**OBS-6.** The "(now at ...)" notes are placed three different ways.
- **Location:** `docs/system/findings.md:86, 91, 98`.
- **Problem:** Line 86 appends it after the citation. Line 91 puts it inside the citation's parentheses. Line 98 puts it right after the leading anchor.
- **Fix:** Pick one placement.
- **Confidence:** high.

## Verified against the code

**Rule 12 (`checkGitObjects`, `hook-decision.ts:502-514`)**
- Only words with a colon are checked, and only operands, not option values.
- A brace anywhere is `shell-git-object`.
- Stage numbers are 0 to 3 (`/^:[0-3]:/`). That matches git, which reads `:4:x` as the path `4:x`.
- A path part starting with `/`, `!`, `(` or `^` is refused, and so is any `*`, `?`, `[` or `\` in it.
- There are two checks: one from the working-copy root, one from the shell's directory. Both must pass.
- Symlinks are judged by where they point, because `canonical-path.ts` resolves each component.
- An empty path part becomes the root or the shell's directory, and the root itself is exempt from the secret globs (`:237`).
- Real git behaviour I reasoned through without running it:
  - `:/text` is a message search.
  - `:!`, `:^`, `:(` and a word with a wildcard or backslash are pathspecs, and `git show` then prints HEAD's patch limited to them.
  - `<rev>:` names the revision's root tree.
  - Reflog and date forms can hold their own colon.

**Rule 13 (`GIT_OUTPUT_FORMS`, `checkGitOutput`, `:533-595`)**
- The lists match exactly:
  - `git log`: 23 flags, 13 valued options, short `s` and `n`, counts.
  - `git status`: 12 flags, 5 valued options, short `s`, `b`, `z`, and `u` attached only.
  - `git show`: no options.
- The five options admitted both bare and with a value are correct.
- A `-<digits>` count is admitted only where `counts` is true, which is `git log` only.
- `git show` refuses any word starting with a dash, including `--` and `-`. With no operand, or an operand without a colon, it is `shell-git-object`.
- `git log -n -p` is safe: both the hook and git take `-p` as the count, and git then fails.

**Check order (`checkSegment`, `:618-634`)**
- The order is `shell-syntax`, `shell-git-option`, `shell-option-value`, read rules, rule 12, then rule 13, as documented.
- `git show -s HEAD` is `shell-git-output`.
- `git -C` and `git --no-pager` are `shell-not-allowed`, and `git -c` is a denied prefix.

**Limits bullet**
- The sandbox `denyRead` holds roots only (`settings.ts:125`, `invocation-scope.ts:519`). The secret globs become Read deny rules (`settings.ts:110`).
- The clone is made with `--local --no-hardlinks --no-checkout` and then checked out at the pin (`staging-clone.ts:65-68`), so it carries every object in the source store, compressed.
- `.git` is write-denied only. `readExclude` never reaches the hook, so the read rules do not refuse `.git`.

**The `git log -1 --stat` example** passes the rules.

**`findings.md` anchors**
- `docs/containment.md:108` is the proposal's CON-1 row, and it does list the git-object bypass.
- `hook-decision.ts:563`, `:502` and `:510` are correct.
- The "now at" lines are correct: `:266`, `:748`, `:718`, `:237`, and `settings.ts:130`, `:133`, `:125`, `:110`.
- The cross-references to `findings.md:89` and `:91` still land on the right lines.

**Counts and style**
- The counts agree everywhere: 35 rule IDs = 6 allow + 30 deny − 1 on both, consistent with the two new rule constants `shell-git-object` and `shell-git-output`. The same 35 appears in `containment.md` and twice in `coverage.md`.
- No em or en dashes, no file paths or function names in `containment.md` prose, and no delivery history.
- No sentence of running prose goes over 35 words; the longest is 34.

## Checks I could not run (shell denied)

- The `coverage.md` rule-count grep that gives 35. I inferred it from the code instead.
- The source line count (26,261) and the test file count (117).
- That `9383cb8` comes before `ac520c1`. Two test commits (`42d3419`, `b7c94ba`) may have landed after `9383cb8`, which could change the test-file count.
- The claim that only the hook's git rules and one comment in the invocation scope changed after `fdc29c6`.
- Actually running git to confirm the behaviour above; it is reasoned from git's source, not tested.

## What is good

Rule 13's lists match the code exactly. The new Limits bullet states its exposure plainly and leaves the decision to the owner. The new findings name the symlink gap honestly instead of claiming full coverage.

**Verdict: PASS**
