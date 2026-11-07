**Verdict: BOUNCE.** There are no blockers. Two warnings need fixing first; both are small edits.

Severity: **BLOCKER** means it cannot ship. **WARNING** means fix before shipping, but not a hard-rule break. **OBS** means worth noting.

## Findings

### WARNING

**W1. The `git log` and `git status` option bullets break the 35-word cap.**
- **Location:** `docs/system/containment.md:268` and `:269`, rule 13.
- **Problem:** Each bullet is one sentence of about 100 and about 70 words. The `git status` bullet also has a parenthesis containing a semicolon inside the list.
- **Evidence:** The lists match `GIT_OUTPUT_FORMS` (`src/domain/hook-decision.ts:533-558`), so only the sentence shape is wrong.
- **Fix:** Split each bullet into three sub-bullets: "Short options: …", "Long options without a value: …", "Long options with a non-empty `=value`: …". Move the note on `-u` to its own sentence.
- **Confidence:** high.

**W2. The example `--pat` for `--patch` may not hold in real git.**
- **Location:** `docs/system/containment.md:267`, rule 13, "because git accepts an abbreviated long option (`--pat` for `--patch`)".
- **Problem:** The code comment makes the same claim (`hook-decision.ts:519`), but it is not true of git as I know it. `--pat` is a prefix of `--patch`, `--patch-with-raw` and `--patch-with-stat`. Git's option parser either rejects an ambiguous prefix or, for revision and diff options, turns abbreviations off. Either way git would probably refuse `--pat`. The allow-list itself is right and fails closed; only the example is doubtful.
- **Fix:** Run `git log --pat -1` and check. If git refuses it, use an example git accepts, or keep the reason without an example ("git accepts unambiguous abbreviations of some long options").
- **Confidence:** medium. I could not run git.

### OBS

**O1. "Not held by this rule" is unclear.** `containment.md:219`: "A contract command is not held by this rule, and neither is the compressed object store." Say "is not judged by this rule" or "this rule does not cover". Confidence: high.

**O2. "The commit's patch" does not name the commit.** `containment.md:267`: "`git show` then prints the commit's patch for the paths the pathspec matches." When `git show` gets only a pathspec, it shows HEAD. Write "prints HEAD's patch for the paths the pathspec matches". Confidence: high.

**O3. The reason for refusing a backslash is missing.** Rule 12 says why braces, `/`, `!`, `(`, `^` and wildcards are refused, but not why a backslash is. The code says it is a quoted word the lexer kept, which git would read as a pathspec (`hook-decision.ts:507`). One clause would close the gap. Confidence: medium.

**O4. The object store holds more than committed objects.** `containment.md:436`, Limits bullet: "holds every committed object of the source repository's history". The clone is made with `git clone --local --no-hardlinks` (`src/adapters/git/staging-clone.ts:65`). With `--local`, git copies the whole `.git/objects` directory, so the clone also gets objects that are not reachable: blobs that were staged but never committed, dropped stashes, and so on. The claim is true but understates the exposure on a security page. Suggest "every object in the source repository's object store, committed or not, compressed". Confidence: medium. I could not run git to confirm.

**O5. Two "now at" anchors point to the call rather than the code that does the work.** Neither is wrong.
- `findings.md:86` cites `settings.ts:129` (the `hookEntry(...)` call) for "runs node with the hook entry, `--event` and `--policy`". The arguments are built at `settings.ts:59`.
- `findings.md:141` cites `hook-decision.ts:563` (the `checkGitOutput` declaration) for the `git log -p` refusal. The refusals happen at `:582` and `:591`.

Confidence: high.

**O6. "Any other word" in the `git show` bullet has no clear contrast.** `containment.md:270`: "Any other word that starts with a dash …". The sentence before it is about operands, not dash words, so "other" points to nothing. Drop "other". Confidence: medium.

**O7. The global-option sentence omits one exception.** `containment.md:281` says `git --no-pager log` "is `shell-not-allowed`". A contract command with exactly those words is checked first and would be admitted (`hook-decision.ts:612-617`). Rule 11's preamble probably covers this already; adding "unless a contract command lists it" would make the sentence exact. Confidence: low.

## What I checked and found correct

- **Option lists:** the `git log` and `git status` lists in rule 13 equal `GIT_OUTPUT_FORMS` exactly:
  - `git log`: 23 flags, 13 options with `=value`, `-s` and `-n`, and the `-<digits>` count.
  - `git status`: 12 flags, 5 options with `=value`, `-s` `-b` `-z`, and `-u` with its mode attached only.
  - The five options admitted both bare and with a value are named correctly.
- **Rule 12 against `checkGitObjects`** (`hook-decision.ts:502-514`):
  - The stage regex is `^:[0-3]:`.
  - Braces anywhere in a word with a colon are refused.
  - Path parts starting with `/` `!` `(` `^` are refused, and `*` `?` `[` or `\` anywhere in the path part.
  - The two-candidate read check (working-copy root and the shell's directory) uses `canon`, so symlinks are judged by their target.
  - An empty path part resolves to the working copy root, which the secret-glob rule never matches (`:237`).
- **Rule 12 against git:** git splits at the first colon outside braces; `./` and `../` resolve from the current directory; `:/text` is a message search; a quoted `:*` falls through to a pathspec; `<rev>:` names the root tree. These match my knowledge of git, but I did not run git.
- **`git show`:** any word starting with a dash, including `--` and `-`, is refused (`:567`). A missing operand or one without a colon is `shell-git-object` (`:568`). The count option is admitted only where `counts: true`, which is `git log` alone.
- **Check order:** steps 1 to 6 match `checkSegment` (`:618-634`), and so does the example `git show -s HEAD` → `shell-git-output`.
- **Rule-ID count:** the ledger's grep pattern, run with Grep, finds 35 distinct IDs. 6 appear on allow decisions and 30 on deny, with `subagent-type` on both. That agrees with `containment.md:208` and both rows of `coverage.md`.
- **Limits bullet:** the sandbox `denyRead` holds roots only (`settings.ts:125`), and the secret globs become Read deny rules (`settings.ts:110`). The clone is checked out detached at the pin (`staging-clone.ts:68`). The hook's read rules never use `readExclude: ['.git']`, so the claim that they do not refuse `.git` holds.
- **findings.md anchors:** `:237`, `:266`, `:502`, `:510`, `:718`, `:748`, `settings.ts:110`, `:125`, `:130` and `:133` each point at the code they describe. `docs/containment.md:108` is the matrix row naming the git-object bypass. `findings.md:89` and `:91` are still the network line and the read-before-edit line.
- **House rules:** the added prose has no em or en dashes, no new headings, and no file paths, function names, phase numbers, plan IDs or threat IDs. The cross-references "Limits of containment" (`:425`) and `findings.md` both exist.

The prose is precise and well grounded. Each refusal comes with the git behaviour that justifies it, and the Limits bullet states the residual risk plainly.

## Checks I could not run

Shell access was denied, so I did not:
- Run git to test `--pat`, the `:*` pathspec fallback, `<rev>:` tree output, or what `--local` copies.
- Run the ledger commands for source lines (26,261) or test files (117), or confirm the claims tied to commits `9383cb8`, `42156c7` and `fdc29c6`, or "the only code changed after it".
- Compute any digests.

On `coverage.md` I checked only that the hook-rule counts agree with the documents.

**Verdict: BOUNCE** (W1, W2)
