# S2-D: `git commit` inside the Seatbelt sandbox (host limitation 8)

Plan 02-18 Task 1. Measures which writes under a run clone's `.git` a `git commit` needs when it runs inside AVARICE's own Seatbelt sandbox, and whether a commit with only the object store and the run ref writable fails. No model is involved and no spend was recorded.

Limitation 8: resolved

## What was run

Reproducer: `node --test test/containment/sandbox-commit.test.ts` (skipped when `/usr/bin/sandbox-exec` is absent).

1. A scratch repository under the realpath of the temp directory, `git init -b main`, one commit, then `git checkout -b avarice/run_s2d` and one staged change. This is the state the supervisor commits from: it stages outside the sandbox.
2. `git commit --no-verify --no-gpg-sign -q -m ...` under `SandboxedExecutor`, cwd the clone, `writePaths` set to entries under the clone's `.git`, environment only `PATH`, `HOME`, `LANG`, `GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null` and the author and committer names. The executor closes the cwd for writing and re-allows only the listed paths, so `.git` is writable only where the list says.
3. Starting from the set the plan expected to be enough (the object store and the run ref), the entry named by each failure was added until the commit passed. Then each entry was removed in turn to prove none is spare.

Host: macOS 15.5, Apple Git-154 (git 2.39.5), Node v26.9.0, measured 2026-11-06.

## Result

| Step | Write set under `.git` | Outcome |
|------|------------------------|---------|
| 1 | `objects`, `refs/heads/avarice` | fails, exit 128: `Unable to create '.git/index.lock': Operation not permitted` |
| 2 | step 1 plus `index`, `index.lock` | fails: `could not open '.git/COMMIT_EDITMSG': Operation not permitted` |
| 3 | step 2 plus `COMMIT_EDITMSG` (and `logs`) | fails: `cannot lock ref 'HEAD': Unable to create '.git/HEAD.lock': Operation not permitted` |
| 4 | step 3 plus `HEAD.lock` | passes; only `refs/heads/avarice/run_s2d` moved, `main` did not |

The minimal set, asserted exactly by the test (removing any one entry makes the commit fail):

| Entry (relative to the clone's `.git`) | Why the commit needs it |
|----------------------------------------|-------------------------|
| `objects` | the new blob, tree and commit objects |
| `refs/heads/avarice` | the run ref and its `.lock` file |
| `logs/HEAD`, `logs/refs/heads/avarice` | the reflogs git writes for a non-bare clone (`core.logAllRefUpdates` default) |
| `index`, `index.lock` | the index is rewritten through a lock file that is renamed over `index`; without `index` git reports `unable to write new_index file` |
| `COMMIT_EDITMSG` | the message file written before the commit is created |
| `HEAD.lock` | HEAD is locked while its reflog entry is written; HEAD itself is not rewritten |

Other observations, all asserted by the same file:

- `git add` of a new file needs only `objects`, `index` and `index.lock`.
- Under the minimal set a write to `hooks/`, `config`, `info/exclude`, `refs/heads/main` or a new ref outside `refs/heads/avarice/` fails and leaves the file unchanged.
- A commit with only `objects` and the run ref fails (step 1), so the plan's first guess was not enough: the index and the lock files are part of the set.

## Verdict and consequences

- Limitation 8: resolved. An in-sandbox commit succeeds, but only with eight writable entries that include the index, the object store, the reflogs and two lock files in `.git`.
- Per D-03 this does not change the design. AVARICE commits from the supervisor, outside any invocation, after G2, and the agent's `.git` stays in `denyWrite`. No agent receives any of these paths: a writable object store and index would let a contained process build a commit of any content, which is the thing D-03 keeps out of the model's hands. T-02-60: this record changes no runtime behavior.
- `docs/containment.md` marks limitation 8 resolved with this result and states the D-03 decision.

## Caveats

- This drives AVARICE's `SandboxedExecutor`, not Claude Code's sandbox. Both use Seatbelt on macOS, but the host also treats `.git` as a protected path under `dontAsk`, and the host's own handling of `allowWrite` entries inside `.git` was not exercised. For the in-host question the answer is the same as before: nothing relies on it.
- macOS only. A Linux bubblewrap run is not measured; no Linux sandbox backend exists yet.
- The set is specific to this git version and to a default configuration. A repository that sets `core.logAllRefUpdates=false`, a commit hook, a signing program or `commit.template` changes it. The supervisor commit sets `--no-verify --no-gpg-sign` for that reason and does not depend on this set.
