Commands run at HEAD 0632fd4 on 2026-11-06 in the worktree.

Code files of the packet:
- src/adapters/sqlite/ledger.ts: covered in part (lines 96-345, 440-520 and 605-1538 read; project, activation and onboarding read paths 165-260 and 551-605 not re-read)
- src/adapters/sqlite/migrations/0002-run.ts: covered
- src/app/checks.ts: covered in part (evidence kinds, check.finished, artifact kinds, step recording read; install and sandbox logic not read, no data-model behavior)
- src/app/run-stages/blocked.ts: covered
- src/app/run-stages/finish.ts: covered in part (handoff.fetched, evidence kinds gsd-verdict and diff, gate G4 read)
- src/app/run-start.ts: covered (single-transaction start, contract file, start:preflight step)
- src/cli/composition.ts: covered (two migrations, read-only migrate path, adapter_configs upserts)
- src/cli/shell/history.ts: covered
- src/domain/ids.ts: covered
- src/domain/run-lifecycle.ts: covered
- src/hook/pre-tool-use.ts: covered in part (event writes, hook_reads, budget charge read; rule logic belongs to containment)
- src/ports/ledger.ts: covered in part (method list only)

Counts:
- Tables, 23 of 23: `git grep -c "CREATE TABLE" -- src` gives 20 in 0001 and 3 in 0002; 21 with a writer (INSERT or UPDATE search per table under src), 2 without (task_refs, approvals)
- Event kinds, 28 of 28: `git grep -h -o -E "type: '[a-z_]+\.[a-z_.-]+'" -- src | sort -u | wc -l` gives 28; every appendEvent, insertEvent and appendEventRow call site (`git grep -n -E "(appendEvent|insertEvent|appendEventRow)\(" -- src`) has a literal type
- Artifact kinds, 7 of 7: `grep -rn "recordArtifact" src` and the kind constants at those sites
- Schema migrations, 2 of 2: the MIGRATIONS array in src/cli/composition.ts
- Run lifecycle, 11 states and 37 transitions: `node -e "import('./src/domain/run-lifecycle.ts').then(m=>console.log(m.RUN_STATES.length,m.RUN_TRANSITIONS.length))"`; only the counts are restated in runs.md, not here
- ID prefixes, 8 of 8: src/domain/ids.ts
- Run step names, 17: grep of step literals and constants under src/app and src/cli
- Triggers, 8 (4 and 4) and indexes, 2: the two migration files
- Ledger methods with no production caller, 4: `grep -rlE "\.<method>\(" src` per method, and the same under test

Liveness: every table and event kind has a production writer except task_refs and approvals (dead: no statement in src names them outside the migration). createRun, storeRunContract, upsertWorkItem and listHookReads are test-only (no caller in src outside the ledger and port). Accepted but never written: decision states other than open, work item type harden, run step status reconciled, evidence external reference.

Not checked: the fields of every run.transition caller; the meaning of evidence kinds and statuses (owned by checks-and-evidence); rule logic of the hook; onboarding stage code; the project record builder (its statements are kept as they were); the staging clone refactor beyond its header and first function.
