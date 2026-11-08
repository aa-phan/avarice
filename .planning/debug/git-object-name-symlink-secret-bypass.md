---
status: diagnosed
trigger: "G-02-H2 / UAT Test 2 (02-HUMAN-UAT.md): path part of a git object name (<rev>:<path>, :<path>, :N:<path>) must be denied when either its symlink-resolved path or its lexical repo-relative path matches a secret glob; owner said 'fix it' (CR-01 in 02-26-REVIEW.md)"
created: 2026-11-07T00:00:00Z
updated: 2026-11-07T00:00:00Z
goal: find_root_cause_only
---

## Current Focus

hypothesis: CONFIRMED. checkGitObjects (src/domain/hook-decision.ts:502-514) feeds `<staging>/<path>` and `<cwd>/<path>` to checkRead, which canonicalizes through symlinks (src/adapters/fs/canonical-path.ts) and matches denyReadGlobs against the resolved target in readRule (line 237). The name git looks up in the revision tree / index is never matched lexically.
test: done (unit-level repro with real decideToolCall + real canonicalAbsolute + real git over scratch repos)
expecting: n/a
next_action: return ROOT CAUSE FOUND to caller (plan-phase --gaps applies the fix)
bug_class: Bohrbug (deterministic, 100% reproducible)

reasoning_checkpoint (diagnosis only, no fix applied):
  hypothesis: "A symlink (live or dangling) at a name matching a secret glob, or a symlinked parent directory of a secret-glob path, makes canon() return the link target; readRule matches globs on that target; git reads the blob by name from history/index, so the secret is printed."
  confirming_evidence:
    - "Repro A/C/D: hook ALLOW and real git printed the sentinel for git show HEAD~1:.env, :.env, :0:.env (file symlink), for a dangling symlink, and for HEAD~1:secrets/key.txt behind a directory symlink."
    - "Prototype lexical check on a scratch copy flips every one of those to DENY(deny-secret-read) without changing cat/head/ls verdicts."
  falsification_test: "Would have been refuted if the unpatched hook denied the A/C/D commands. It allowed them."
  fix_rationale: "Match the lexically normalized name (no filesystem resolution), against both git's root resolution and the cwd resolution, in addition to the existing canonical check."
  blind_spots: "Case-insensitive volumes (.ENV vs .env when no working-copy file exists); symlink targets under readRoots outside staging (glob never applied there) are covered by the same lexical check but were not separately run; no integration run through the real hook entry (runHook), only decideToolCall."

## Symptoms

expected: With denyReadGlobs ['**/.env','**/*.pem'] and a working copy where `.env` is a symlink to `config/dev.env`, `git show HEAD~1:.env` / `git show :.env` are denied (deny-secret-read).
actual: Not reproduced by the reporter ("fix it"); traced-not-reproduced in 02-26-REVIEW.md CR-01 (BLOCKER). Now reproduced (see Evidence).
errors: none
reproduction: 02-HUMAN-UAT.md Test 2
started: found in owner UAT after gap-closure plan 02-26

## Eliminated

- hypothesis: "cat/head/Read of a working-copy symlink at a secret name is a second, separate gap"
  evidence: "cat reads the target's bytes, so judging the resolved target is correct and intended. link.txt -> .env is denied (E); .env -> config/dev.env is allowed and prints only dev.env content. Not a gap."
  timestamp: 2026-11-07
- hypothesis: "A working-copy file that is absent (deleted, present in history) escapes the glob"
  evidence: "canon() appends a non-existent tail literally, so <staging>/.env is matched and denied (B). Only an EXISTING or DANGLING symlink at the name, or a symlinked parent, diverts the path."
  timestamp: 2026-11-07

## Evidence

- timestamp: 2026-11-07
  checked: src/domain/hook-decision.ts:230-249 (readRule/checkRead), 502-514 (checkGitObjects), src/adapters/fs/canonical-path.ts
  found: checkGitObjects -> checkRead([abs(staging,path), abs(cwd,path)]) -> canon() = realpath per component, dangling symlink followed through its target, non-existent tail appended literally -> readRule matches denyReadGlobs on canonical.slice(staging.length+1) (only when canonical is under staging).
  implication: The glob always sees the resolved target, never the name git reads.
- timestamp: 2026-11-07
  checked: Scratch repro /Users/aphan/.claude-edu/jobs/eebeb914/tmp/repro.mts (real decideToolCall, real canonicalAbsolute, real git, globs **/.env **/*.pem)
  found: "A: .env -> config/dev.env. `git show HEAD~1:.env`, `git show :.env`, `git show :0:.env` all ALLOW(shell-identity) and git prints the sentinel (history and index versions)."
  implication: Reproduced; CR-01 is real, not just traced.
- timestamp: 2026-11-07
  checked: Same repro, dangling symlink .env -> nowhere.txt (C)
  found: "git show HEAD:.env and :.env ALLOW and git prints the secret. canon follows the dangling link to <staging>/nowhere.txt."
  implication: A second variant: the bypass does not need a live target.
- timestamp: 2026-11-07
  checked: Same repro, directory symlink secrets -> vault with glob **/secrets/** (D)
  found: "git show HEAD~1:secrets/key.txt ALLOW and git prints the secret. (git show HEAD~1:secrets and secrets/ allowed too, but print only a tree listing / nothing secret.)"
  implication: The directory-symlink variant is the same defect.
- timestamp: 2026-11-07
  checked: Same repro, deleted working-copy file (B), regular .env baseline (E)
  found: "B: DENY(deny-secret-read). E: DENY for git show HEAD:.env, git show HEAD:link.txt, cat link.txt, cat .env."
  implication: Absent file = lexical behavior (correct). Resolution of a symlink to a secret target for cat is correct.
- timestamp: 2026-11-07
  checked: A, the `./` and `..` spellings and a subdirectory cwd
  found: "git show HEAD~1:./.env, HEAD~1:config/../.env are DENIED, and git show HEAD~1:.env from cwd=<repo>/sub is DENIED. accident.mts shows why: checkSegment (hook-decision.ts:631) first runs checkRead on the WHOLE operand as a path (<cwd>/HEAD~1:./.env), whose canonical form has `.env` as its last segment so the glob matches by chance. The plain form `HEAD~1:.env` becomes the segment `HEAD~1:.env`, which **/.env does not match."
  implication: Only cwd == staging root with a plain name (the contained run's normal cwd) bypasses. The existing deny of the dotted forms is incidental, so the fix must not rely on it. Existing unit tests (hook-decision.test.ts:1122-1128) pass because their injected canon has no symlink for these names.
- timestamp: 2026-11-07
  checked: Prototype of the proposed fix on a scratch copy (tmp/patched/domain/hook-decision.ts): before the existing checkRead, for base in [staging, canon(cwd)] take posix.normalize(base + '/' + path), and if under staging and not staging itself, matchesAny(remainder, denyReadGlobs) -> deny-secret-read
  found: "A, C, D now DENY(deny-secret-read) (git still prints the secret, so the refusal is not vacuous); cat/head/ls verdicts unchanged; B and E unchanged. The 147-test unit file runs 146 pass with the prototype; the one failure is a spike fixture file missing from the scratch copy, unrelated."
  implication: Direction validated. Side effect: git show HEAD:.env is now denied even when HEAD stores a symlink (git prints only the link text); this over-deny is acceptable and consistent.
- timestamp: 2026-11-07
  checked: node scripts/check-boundaries.ts --root-as domain on the prototype
  found: "forbidden-import node:path (domain may import only relative paths plus node:crypto)."
  implication: The fix needs a small pure lexical normalizer written in src/domain (no posix.normalize), or an injected function; src/domain has no existing one.

## Resolution

root_cause: "checkGitObjects (src/domain/hook-decision.ts:510) judges the path part of a git object name with checkRead, which canonicalizes through the working copy's symlinks (canonicalAbsolute follows live and dangling links and symlinked parents) and then matches denyReadGlobs on the RESOLVED path in readRule (line 237). Git does not consult the working copy for <rev>:<path>, :<path>, :N:<path>; it reads the blob stored under that literal name in the revision tree or the index. A working-copy symlink (live or dangling) at a secret-glob name whose target matches no glob, or a symlinked parent directory under a directory-anchored glob, makes the hook judge a different path than the one git reads, so the secret blob in history or the index is printed. The plain-name forms from the contained run's cwd (the clone root) are the exposed ones; the ./ and .. spellings and sub-directory cwds are denied only because checkSegment first path-checks the whole operand string, which is incidental."
fix: (not applied: find_root_cause_only)
verification: reproduced before fix; fix direction validated on a scratch copy only
files_changed: []
