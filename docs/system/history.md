# History

> Status: drafted, not yet reviewed.

This document records what the git history of this repository shows about how the built system arrived, dated by commit. It is historical: entries are not revised when the code changes. Inference about intent is labeled as inference and names what it is inferred from. The current behavior is described in the other documents of this tree, never here.

## Summary

The repository started on 2026-11-01 as a specification package with no code. Between 2026-11-02 and 2026-11-05 the onboarding slice was built: one existing repository is taken to an active project record by contained Claude Code invocations, with GSD as the mapper. The history shows 287 commits over those five days (`git log --format=%ad --date=short | uniq -c`).

| Date | Commits |
|---|---|
| 2026-11-01 | 8 |
| 2026-11-02 | 108 |
| 2026-11-03 | 56 |
| 2026-11-04 | 87 |
| 2026-11-05 | 28 |

## 2026-11-01: specification package

- The specification package (requirements, architecture, containment, contracts and state, onboarding, the ADRs) was added with no implementation (`9858bd0`).
- Pre-build spike results were recorded and applied to the specification the same day (`c67a82e`, `22769b7`). The spike notes live in `spikes/2026-11-01-pre-slice-0/README.md`.

## 2026-11-02: the onboarding slice end to end

The first implementation day built the whole path from an empty store to an active record, first against a fake host and then against the real one:

- Pure domain contracts (`eeb74bf`) and live host spikes (`64c6816`).
- The SQLite store, its writers and `avarice status` (`e7a1e50`, `414084b`); leases, `avarice resume`, the pre-migration backup and the checksum refusal (`5c10e15`, `db8a36c`).
- `avarice init` with the root placement rules, the local-mount check and the SQLite version gate (`5d1230b`).
- Staging, first as a linked worktree (`03c1953`), then as a local clone chosen by the owner (`c2f8bca`); preflight and `avarice repo add` (`a949e2c`).
- GSD location and mapping (`00197b3`, `e43b63d`), map validation and the project record (`bace2c3`, `e05c3d2`).
- The contained launch: invocation scope, generated settings, environment allowlist, agents file and launch preflight (`adb5b06`, `2768a53`); the PreToolUse hook and persisted budgets (`8ef2a5d`, `9fddd17`); the sandboxed executor (`f828062`).
- The code graph, the index step registry and activation's scope check (`aa86b3a`, `04c5449`, `8cb06c3`).
- The real Claude Code host adapter, the stream-json parser and outcome classification (`c99cdf0`, `84a1378`).
- GSD intel, `avarice context` (`c5277fd`, `a4f9e42`) and the knowledge pass with AVARICE's own graph merge (`a3bf131`, `84ac660`).

## 2026-11-03: mutation probing and the first real target

- Mutation probing closed four weak spots in the launch preflight, the document-node text cap, the hook's glob handling and the subagent concurrency limit (`a620ed3`, `6a89140`, `d102659`, `7dc21d1`).
- Exit-run tooling was added (`ef2c983`). Running against a real repository led to fixes in the existing-map answer, full-map stamping, path-reference rules and budget derivation (`8cc18b6`, `ef1ae0b`, `34eac4b`, `6477c32`), and to splitting the knowledge pass so the model has no shell (`7ffc697`).
- Claude Code 2.1.317 was admitted after a green live containment run (`07b16ca`).

## 2026-11-04: confinement hardening

- Resume reaps every interrupted launch, not only the mapping launch (`5d558e9`).
- The staging diff judges ignored untracked files (`c7756a1`).
- Hook reads were confined to staging, read roots and allowed reads; option values and operands are judged (`84910d3`, `f144eb4`); the work root is denied except the invocation's own staging (`630f7f8`).
- Shell `grep` was removed from the admitted read commands, so searches go through the host's Grep tool (`99dd4fb`).
- Knowledge coverage began to be counted per document after the merge (`8054cb8`). Inferred from the commit subject and its gap reference: this followed a live run in which the knowledge agent read the wrong copies of the documents.

## 2026-11-05: review fixes and phase close

- Code review findings were fixed: option-name parsing, `gsd_run` argument checks, sandbox probe retry and the exit-run spend guard (commits under the `261105-2i2` quick task, ending at `4ac1127`).
- The planning records closed the onboarding phase (`5457f85`).
