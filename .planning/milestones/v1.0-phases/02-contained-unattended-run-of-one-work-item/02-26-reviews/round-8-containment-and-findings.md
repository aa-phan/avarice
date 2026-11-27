**Verdict: BOUNCE.** No BLOCKERs, two WARNINGs, two OBS.

Severity: **BLOCKER** means it cannot ship. **WARNING** means likely rework (fix it, though it does not block). **OBS** means worth noting.

The prose is grounded closely. Both option lists match `GIT_OUTPUT_FORMS` exactly, in the same order and with no extra or missing entries, `--pretty` and `--decorate` each appearing in both lists. The check order matches `checkSegment` (`src/domain/hook-decision.ts:618-634`), and the example `git show -s HEAD` → `shell-git-output` holds. There are no dashes, no new headings and no delivery history in the prose; rule IDs and option names stay where they belong.

## WARNING

**W1. The symlink exception covers every path component, but the documents say only "a directory".**
- **Where:**
  - containment.md:219 says "unless a directory on its path is a symlink".
  - Rule 12 (containment.md:266) says "a directory that is a symlink in the working copy and a real directory in the revision".
  - findings.md (diff lines 125-126) says "a working-copy directory symlink" and "a directory that is a symlink".
- **Problem:** the hook resolves the whole path through the canonicaliser before the secret-glob test. `src/adapters/fs/canonical-path.ts:3,30` replaces each existing component with its realpath, the last one included. The test (`hook-decision.ts:237`) then runs on that canonical path. So the last component can be the symlink too.
- **Example:** the working copy has `.env` as a symlink to `README.md`, and an older revision has `.env` as a real file. `git show HEAD~1:.env` resolves to `<clone>/README.md` and passes `deny-secret-read`, and git then prints the old `.env`.
- **Fix:** write "unless a component of its path (a directory or the file itself) is a symlink in the working copy" in all four places. Confidence: high (code read; I did not run git).

**W2. "An admitted shell command cannot print a secret file" contradicts the document's own new Limits bullet.**
- **Where:** containment.md:219.
- **Problem:** a contract command is an admitted shell command. It is allowed under rule `agent-command` (`hook-decision.ts:612-616`). The new Limits bullet (diff line 46) says that code a contract command runs "can therefore read a secret file present in the clone and print it".
- **Fix:** narrow the claim, for example: "an admitted read-only command cannot print…". You could also point to the Limits bullet. Confidence: high.

## OBS

**O1. The `git show` bullet in rule 13 overstates when `shell-git-output` fires** (containment.md:272, last bullet). It says "Any word that starts with a dash … is `shell-git-output`", but two earlier checks can refuse first:
- `git show -p. HEAD:a` is `shell-option-value`, because the cluster is malformed (`hook-decision.ts:629`).
- `git show -O/etc/x HEAD:a` is refused by the read rules, because `O` is a value letter for `git show` (`hook-decision.ts:343, 631`).

The check-order paragraph below it gets this right, so the rule is not wrong, only absolute when read on its own. Suggested fix: "Any other word that starts with a dash…". Confidence: high.

**O2. Two claims I could not check.**
- The Limits bullet's "The clone starts with only the files committed at the pin" is not in any file I read. It is probably documented elsewhere (in `runs.md` or the clone adapter).
- In `coverage.md`, the source-line and test-file counts and the statement about which code changed since `fdc29c6` need `git` and `wc`. Bash was denied in this session, so I did not re-run them.

## Checks that passed

**Rule 12** (`checkGitObjects`, `hook-decision.ts:502-514`):
- The three forms are right, and the stage number is `^:[0-3]:`. Stages 0 to 3 are right for git.
- A brace anywhere in the word is refused (`:505`).
- A path part that starts with `/`, `!`, `(` or `^`, or that holds `*`, `?`, `[` or `\`, is refused (`:508`).
- The path is checked twice, from the working copy root and from the shell's directory, and both must pass (`:510`).
- An empty path part is checked as both roots: `absolutize(root, '')` gives `root/`, and the root itself is exempt from the secret-glob test (`:237`). `git show <rev>:` does print a tree listing.

**Rule 13** (`checkGitOutput`, `:563-595`):
- Long options are compared as whole words, and short clusters are read per character.
- The `-<digits>` count is admitted only where `counts: true`, which is `git log` only. `git status -5` and `git show -5` are refused.
- `git status -u` takes its mode only when attached (the code breaks out of the cluster without consuming the next word), which matches `SHORT_VALUE_OPTIONS` (`:345-346`).
- `git show`: no operand, or any operand without a colon, gives `shell-git-object`. Any argument starting with `-`, including `-` and `--`, gives `shell-git-output` (`:567-568`).
- A global option before the subcommand matches no read-only entry and gives `shell-not-allowed`. `git -c` gives `shell-denied-prefix` (`:618-620`).

**Rule-ID count:** 35 = 6 allow + 30 deny − 1 on both. The two new IDs come from `GIT_OBJECT_RULE` and `GIT_OUTPUT_RULE`, both declared as `_RULE = '…'`, which the ledger's grep pattern catches. The ledger reads 33 + 2. containment.md:208 and both coverage rows agree.

**Limits bullet:**
- The sandbox `denyRead` holds roots only (`settings.ts:125`).
- The secret globs become `Read(...)` deny rules (`settings.ts:110`).
- `.git/objects` is not refused by the read rules unless a secret glob matches it.
- Loose objects are zlib-compressed.

**findings.md citations:**
- `docs/containment.md:108` is the CON-1 row with "committed secret-glob files read through git objects".
- `hook-decision.ts:266` is the write-root check.
- `hook-decision.ts:748` is `decideReadBeforeEdit`.
- `hook-decision.ts:718` is the `meta` allow.
- `hook-decision.ts:237` is the secret glob applied below staging only.
- `hook-decision.ts:502`, `:510` and `:563` are correct.
- `settings.ts:133` is the GSD hook entry, with no blocking flag.
- `settings.ts:125` is the sandbox `denyRead`.
- The unchanged reference to `findings.md:91` still points at the file-edit safeguards line.

BOUNCE
