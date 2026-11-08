# AVARICE

## Documentation

Two kinds of documentation live in this repository, and they are edited differently.

These rules apply only where `docs/system/` exists in your checkout. If your branch or worktree has no `docs/system/`, do not create it or any file in it: list the documentation updates your change needs in your plan summary instead, and they are applied after the branch is rebased onto `main`.

- `docs/system/` is the living documentation of the built system and the source of truth for built behavior. Any change that alters behavior, adds a command, flag, config key, table, event or external integration, or changes an exit code updates the matching `docs/system/` document in the same change. A new subsystem gets its own `docs/system/` document, written from the code (never copied from a proposal), named after the proposal it implements when the scope matches and after the built subsystem otherwise, and listed in `docs/system/README.md` (documents table and proposal counterparts table) and `docs/system/coverage.md`. Update `docs/system/coverage.md` when a count it records changes.
- `docs/` outside `docs/system/` (requirements, architecture, design documents, `docs/decisions/` ADRs) is the proposal that unbuilt work is planned from. Do not edit it to match the code. Change it only when a design decision changes, and record the decision. An accepted ADR is never rewritten; supersede it with a new one.
- When code and a proposal disagree, the code and `docs/system/` describe what is; add one line with `file:line` to `docs/system/findings.md` for the owner to decide which side moves.
- Every phase ends with a documentation plan, planned as the phase's last plan and depending on all others. It compares the phase's diff with `docs/system/`, writes or updates the documents for whatever the phase built (grounded in the code, per the `technical-writer:documenting-legacy-codebases` skill), updates the two tables in `docs/system/README.md`, `coverage.md` and `findings.md`, and has each new or changed document reviewed by a fresh `technical-writer:prose-reviewer` before it is marked reviewed in `coverage.md`. The phase's success criteria include this, so verification checks it.
- Load the `technical-writer:technical-writing` skill for any documentation prose here. `docs/system/` documents name their modules once in the opening and keep file paths, function names and delivery history (phase numbers, plan IDs, threat IDs) out of the prose.

## Merging into main

Work reaches `main` only through a pull request merged with a merge commit.

- Do the work on a branch, push the branch, and open a pull request into `main`.
- Merge the pull request with the merge-commit method (`gh pr merge --merge`). Do not squash, rebase or fast-forward. The merge commit marks where the branch landed and lets `git revert -m 1` undo it as one unit. It also keeps every commit hash that plan summaries and review dispositions cite.
- Do not commit or push directly to `main`, and do not merge locally (for example with `git merge` or `git fetch . HEAD:main`) and then push.
- After the merge, delete the branch on the remote and locally.
