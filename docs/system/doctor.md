# Doctor

`avarice doctor` reports what is installed and what is wrong with it, and gives a fix for each problem. This document describes it as implemented in the read model, the command, the dependency set and the probes (`src/app/doctor.ts`, `src/cli/commands/doctor.ts`, `src/cli/doctor-deps.ts`, `src/adapters/diagnostics/probes.ts`, `src/ports/diagnostics.ts`). The host admission rule it applies is in `src/domain/host-admission.ts` and the launch checks it mirrors are in `src/adapters/host-claude/launch-preflight.ts`.

Doctor explains the problems that make the other commands refuse to start. It therefore runs when the rest of AVARICE does not: with a store written by a newer build, a missing or incompatible GSD, or a host that is absent or refused. It reads and never writes, except for the one repair behind a flag. The flags and exit codes are in [cli-reference.md](cli-reference.md), the profile it reports on in [profiles-and-credentials.md](profiles-and-credentials.md), and the host and launch checks in [containment.md](containment.md).

## Reads and writes

Doctor has its own dependency set instead of the normal composition. It runs no migration, takes no backup, takes no lease, requires no GSD and composes no host. It resolves the profile as every command does, which creates the profile's directories and configuration file when they are absent and nothing else. It opens the store read-only and only when the store is a readable store of this build's schema.

Every probe that starts a process, except the online authentication check, has its own 1-second timeout and is killed without a way to ignore the signal. A hung `claude` or `graphify` therefore costs doctor its bound and no more. The probes get a small environment: `PATH` and a few identity and locale variables, never a variable that carries a credential. Doctor never resolves a credential. A configured reference is shown as the reference it is. A string that does not have the shape of a reference is shown as "not a credential reference", so a secret typed where a reference belongs is never echoed. Every string of the report passes through the process redactor, and the text view strips control characters.

Offline, doctor is expected to finish in under 2 seconds. A test asserts this under a wrapper that denies the network. The code itself enforces only the per-probe bound.

## The command

`avarice doctor` takes no argument and four flags, plus the global `--profile`.

| Flag | Effect |
|---|---|
| `--json` | Prints the report as one JSON document with the same content as the text view |
| `--online` | Adds the `online` section: the authentication check of each `delegated:<cli>` credential reference, the only step that reaches the network |
| `--repair` | Adds the `repair` section and deletes orphaned temporary artifact files |
| `--extensions` | Adds the `extensions` section: the Claude configuration directories and what registers there |

The exit code is 0 when no finding has level `error`, 3 when at least one does, 64 for an argument or an unknown option, and 70 for an internal failure. A warning never changes the exit code. The usage line printed for an error omits `--profile`, which the command accepts.

**Online.** For each `delegated:` reference, doctor runs the named CLI's `auth status` with an 8-second timeout and reports `ok`, `timed out`, that the CLI was not found on `PATH`, or the failing exit status. Under a profile that does not resolve `delegated:` references, they are listed as not checked. A profile with no such reference reports that there is nothing to check.

**Repair.** The repair deletes files whose names begin `.tmp-`, directly under a shard directory of the artifact store, whose last change is an hour old or more. It reports how many it removed and how many it kept as newer. It opens no store for writing and edits no run, lease or record.

**Extensions.** Doctor reports on the Claude configuration directory in use, and on the default one when another is in use. For each it reports whether the directory exists, how many AVARICE attended hook entries its settings hold, and which AVARICE skills (names that start with `avarice-`) it holds. Each attended entry is also read back: an entry blocks every attended Bash call when its command fails, so the node executable and the hook script that the entry runs must be regular files (a link to one counts). A missing one is an error finding that names the entry's settings file, the role and the path, and its fix is to run `avarice install-host`, which rewrites the entry. Doctor then exits 3. Only a command in the form `install-host` writes can be read this way; an entry written by hand in another form is not checked. The `--json` keys do not change.

## The report

The JSON report has these keys, in this order. The text view prints the same content as labeled rows.

| Key | Holds |
|---|---|
| `profile` | The name, the class, the three roots, whether the data root is local, and each credential as a name and a reference |
| `runtime` | The Node version, the engines rule from the package and whether it holds, and the bundled SQLite version |
| `store` | The path, a state, the schema found and the schema this build writes, the journal mode, the integrity result, the size in bytes, the time of the newest pre-migration backup, and the profile the store belongs to |
| `host` | The `claude` executable, its version, the admission label, the refusal rule, whether restricted launch is available, the enforcement level, the sandbox result, whether the hook entry is readable, whether the attended hook is installed, and the configuration directory |
| `gsd` | A state of `ok`, `incompatible` or `absent`, the version, the location, the admitted range and a detail |
| `graphify` | `present` or `absent`, the version and the path |
| `adapters` | The recorded adapter configurations as name, port and adapter |
| `runs` | Whether the runs were read, the total, a count per state, and each interrupted run or onboarding with the command that resumes it |
| `records` | Each active project record: project, repository path, version, onboarded revision, the GSD version it was built under, a compatibility of `compatible` or `incompatible`, and the reason |
| `events` | Whether the events table was read, its row count, its bound, and the debug events refused since it reached the bound |
| `findings` | Each finding as a level, an area, a message and a fix |
| `online`, `repair`, `extensions` | Present only when the flag asked for them |

The store state is one of `absent`, `ok`, `older`, `newer`, `foreign`, `unreadable` or `unchecked`. `runs`, `records` and `events` are filled only when the store is `ok`, a readable store of this build's schema. The integrity result is SQLite's quick check, which reads the pages without cross-checking every index against its table, so it stays inside the bound on a store of any size.

## Findings

A finding has a level, an area and a fix. An `error` is a problem that stops something AVARICE does. A warning is worth knowing. Eleven areas produce findings.

| Area | Error | Warning |
|---|---|---|
| `profile` | The profile could not be prepared; the `credentials` section is not an object; a credential is not a string; a reference is refused, an environment variable reference among them | A reference whose provider the profile does not resolve |
| `runtime` | Node does not satisfy the engines rule; the SQLite version cannot be read | None |
| `store` | The store cannot be opened read-only; it belongs to another profile; it is a newer schema than this build writes; it fails the integrity check | An older schema or no recorded migration; a journal mode other than `wal` |
| `host` | None | `claude` not found; `claude --version` did not answer; the host is not admitted; the OS sandbox did not apply a profile; the hook entry cannot be read; the attended settings cannot be read as JSON |
| `gsd` | A gsd-core found but without an identity; a found package or version outside the admitted range | No gsd-core found |
| `records` | An active record that is incompatible with the installed GSD | None |
| `runs` | The runs could not be read | None |
| `limits` | The profile's `limits` section cannot be used | None |
| `events` | None | Debug events refused because the events table reached its bound |
| `online` | None | A delegated CLI that is absent, timed out or failed its authentication check |
| `extensions` | An attended hook entry whose node executable or hook script is not a regular file now | The attended hook registered in more than one configuration directory or more than once in one; an AVARICE skill installed in more than one directory; a `CLAUDE.md` line that mentions pushing or opening a pull request without approval |

A host that is not admitted is a warning, not an error, because analysis and planning in restricted mode still work on it. A store written by a newer build is read-only for doctor and untouched, and its finding tells the owner to run the build that wrote it or restore a backup.

## Host admission and enforcement

The `host` section answers whether the host side of a contained run could start (admission, sandbox and hook entry), and why not when it could not. The `gsd` section answers the GSD side.

**Admission label.** The label is one of four.

| Label | Meaning |
|---|---|
| `verified` | The reported version is on the verified list |
| `admitted (unverified patch)` | The version is a patch of a verified minor at or above that minor's lowest verified patch, and the host's `--help` still lists every flag the contained launch line uses |
| `refused` | Any other case; the refusal rule says which |
| `absent` | No `claude` was found |

Doctor applies the admission rule to the version that `claude --version` reports. The verified list, the verified minor, the seven flags the contained launch line needs and the refusal rules are in [containment.md](containment.md#refusals-before-launch). The refusal rule that doctor prints is one of those. `host-version-unknown` cannot appear in doctor's report, because doctor passes on only an answer that starts with three numbers, and a version that is not three decimal numbers is therefore reported as `host-version-unreadable`. The launch preflight does report it.

**Enforcement.** The level is `enforced` when the host is admitted, the sandbox probe applies a profile and the hook entry is readable. It is `restricted` when the host is not enforced and `--help` lists all six flags the restricted launch line uses: `--restricted`, `--settings`, `--setting-sources`, `--permission-mode`, `--permission-prompts` and `--max-budget-usd`. Otherwise it is `none`. A host with a `sandbox` of `unavailable` or an unreadable hook entry is therefore at most `restricted`, and the matching finding names the way out.

**Attended.** `attended` is `enforced (privileged approvals only)` when the Claude configuration directory's settings hold an AVARICE attended hook entry, and `none` otherwise. The entry is described in [policy-and-approvals.md](policy-and-approvals.md).

## Record incompatibility

A project record is tied to the revision and the GSD version it was built under. Doctor derives whether the installed GSD can still be used with it, and never stores the answer. A record is incompatible in three cases.

1. No admitted gsd-core is located.
2. The located gsd-core is outside the adapter's admitted range.
3. The located gsd-core's minor differs from the minor the record was built under.

The finding names the record, its version and revision, the reason, and the fix. The fix is to reinstall the GSD line the record was built under, or to re-onboard after the adapter supports the new version. `start` applies the same rule before it creates anything and refuses with code `record-incompatible` and exit 3. When no gsd-core is admitted at all, `start` still tells a project that has an active record that the record is incompatible, ahead of the generic refusal that GSD was not found.

## Quirks

- The example output in the diagnostics section of [operations-and-testing.md](../operations-and-testing.md) shows an integrity check line, a data root size and an events write-failure line. The built report runs the quick check, shows the data root as local only because profile preparation refuses a non-local root, and has no write-failure line.
- The report lists only the adapter configurations the store has recorded, which are written by the last command that composed a host or store, so it can lag the configuration.

