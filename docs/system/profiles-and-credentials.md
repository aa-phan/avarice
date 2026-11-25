# Profiles and credentials

A profile is a named, separate set of directories and a store, and everything AVARICE keeps about secrets is scoped to it. This document describes profile identity and selection as implemented in the profile rules and the command dispatcher (`src/domain/profile.ts`, `src/cli/main.ts`, `src/cli/profile-gate.ts`), and the roots, configuration file, binding registry and sibling-profile registry (`src/adapters/fs/profile-paths.ts`, `src/adapters/fs/profile-config.ts`, `src/adapters/fs/profile-bindings.ts`, `src/adapters/fs/profile-registry.ts`). The composition that checks all of it before a store opens is `src/cli/composition.ts`. Credential references and the broker are in `src/domain/credential-ref.ts`, `src/app/credentials.ts` and `src/adapters/credential/`. Redaction is in `src/domain/redactor.ts`, `src/domain/secret-patterns.ts`, `src/adapters/redaction/process-redactor.ts`, `src/adapters/fs/redacting-artifact-store.ts` and `src/adapters/host-claude/transcript-collector.ts`.

A command runs under exactly one profile, chosen before any directory or store exists. The profile fixes where the data, the work copies and the configuration live, which credential providers it may use, and which policy applies. The policy side is in [policy-and-approvals.md](policy-and-approvals.md). Defaults for every key are in [config-reference.md](config-reference.md), the flags and exit codes in [cli-reference.md](cli-reference.md), and the tables in [data-model.md](data-model.md).

## Profiles

A profile name is `personal-local`, `personal-extended` or `enterprise-` followed by an organization name of 1 to 31 lower-case letters, digits and hyphens, starting with a letter or a digit. The name becomes a directory name under the configuration home, the data root and the work root, so the grammar also keeps a name from walking out of them. The class follows the prefix: the two personal names are `personal`, and every `enterprise-` name is `enterprise`.

The class changes three things. An enterprise profile can have an organization policy file at rank 1, and a missing or invalid one denies every privileged action. An enterprise profile's own policy can only tighten. An enterprise profile may claim repositories by remote. Separately, the credential providers differ by name: `personal-extended` alone may use a vendor CLI that holds its own credential.

## Selecting a profile

The dispatcher chooses the profile in this order, and the first source that applies wins.

1. The profile the repository at hand is bound to.
2. The `--profile` flag.
3. The `AVARICE_PROFILE` environment variable.
4. `personal-local`.

A command that names a repository (`repo add <path>`, `onboard <path>`) is judged by that repository. Any other command is judged by the repository its working directory is inside, if any. A flag that names a profile other than the bound one is refused with exit 3 and a message naming the bound profile. A personal profile selected for a repository that an enterprise profile claims is refused with exit 3 as well. The environment variable never overrides a binding, and an invalid value is refused with exit 64 only when it is the value that would be chosen. A flag with no value, or with a name outside the grammar, exits 64 before anything is created.

**The binding registry.** A binding records the profile a repository belongs to, keyed by the repository's real git root and its root commit. The registry is one file in the configuration home, written with mode 0600, schema 1, holding at most 1,000 bindings. It sits outside every store so the profile can be chosen before any store is opened. It is read without following a symbolic link, only as a regular file of at most 64 KiB, and a file with any invalid entry is refused whole. A skipped entry would let a bound repository open under another profile. A binding is create-only: a repository bound to one profile is never re-pointed, and an attempt to bind it to another is a conflict.

Every write of the registry holds a lock file beside it, which names the process that holds it and the time the lock was written. A writer waits for a live holder at most 2 seconds. A lock is taken over, not waited for, in four cases. The first is a holder whose process no longer exists, and a lock that names the process looking at it counts here, because a process never leaves one behind while it runs. The second is a lock whose text does not name a process and a time, for example one never fully written, and whose file is older than the 2-second wait. The third is a live process that now holds the holder's process ID but started more than 2 seconds after the lock was written, so it cannot be the writer: the ID was reused. AVARICE reads that start from the elapsed time `ps` reports for the process. The fourth is a live holder whose lock file is older than 60 seconds and whose start cannot be judged. That is the case when `ps` is absent, fails or prints output that does not parse, and when the time in the lock is not a date. That last rule is a residual: without `ps`, a live holder that hangs for more than 60 seconds loses its lock. A takeover holds no lock of its own, so a third writer that creates a lock while a stale one is being moved aside can share the lock with another writer until the first releases. Any other lock holds the writer out, and after 2 seconds the write fails as unavailable and names the process. The registry is read again under the lock, so a binding another process added meanwhile is kept, and a backfill of several projects holds the lock for all of them. The new registry is written to a temporary file with mode 0600, flushed to disk and renamed over the registry. A crash therefore leaves the old registry or the new one, never an empty file.

`repo add --profile <name> <path>` writes the binding after registering the repository. Without `--profile` nothing is bound. Separately, the first command that may write also binds every project of the store that has no binding yet, to the store's profile, so a project already in a store belongs to that profile. A project whose repository path no longer exists is skipped, and read-only commands write no bindings.

**Enterprise claims.** Each enterprise profile's configuration can list `remotePatterns`: at most 64 globs of at most 256 characters, in the form `host/path`. A repository whose `origin` matches one is claimed by that profile, and a personal profile never runs it and never takes its binding. The remote is reduced before matching: no scheme, user, password or port, no trailing `.git` or slash, lower case. `*` stands for characters within one path segment, so `host/org/*` matches `host/org/tool` and not `host/org` or `host/org/team/tool`. Both `https://user:token@host/org/repo.git` and `git@host:org/repo.git` reduce to `host/org/repo`.

**Refusals.** A registry, or an enterprise configuration, that cannot be trusted (a link, over 64 KiB, not JSON, a malformed list) ends the command with exit 3, never with the repository treated as personal. One that cannot be read ends it with exit 70. Git is not run at all when nothing is bound and no enterprise profile claims a remote.

## The configuration file

The file is `config.json` in the profile's directory under the configuration home, hand-edited, mode 0600. AVARICE writes it once, when it is absent, with the profile and its two roots, and never rewrites it. Every command reads it back. It is opened without following a symbolic link and used only as a regular file of at most 64 KiB, so a planted link or a large file cannot steer a command. A missing file means the defaults.

The key set is closed, and a key outside it is refused by name. A file the parser refuses ends the command with exit 70. `schema` and `profile` may be left out of a hand-written file. When present, `schema` is 1 and `profile` is the selected profile's name, or an object with `id` and `class` that agree with it. The roots are checked for shape only (at most 4,096 characters, no control characters). Each section stays raw until the module that owns it parses it, so a bad value is reported by the command that reads it.

| Key | Holds | Read by | Refused when |
|---|---|---|---|
| `schema` | The number 1 | The parser | Any other value |
| `profile` | The profile's name, or `{ id, class }` | The parser | It names another profile or a class the name does not have |
| `dataRoot` | Where the store and artifacts live | Root resolution | Not an absolute path or `~/` path |
| `workRoot` | Where clones and scratch live | Root resolution | The same |
| `notify` | Destinations, digest times, quiet hours, batching | The notifier | Per its own rules |
| `limits` | Six resource bounds | Composition, which keeps the defaults when the section is bad, and `start`, which refuses it | An unknown name, a value that is not a whole number above 0, or more than 2 concurrent checks |
| `retrieval` | Nine caps on what a run may retrieve | The retrieval guard, when a run starts or a pack is built | An unknown name, or a value above its built-in cap |
| `credentials` | Named credential references and approved helpers | Every command that is not read-only | A reference that is not valid |
| `adapters` | `context`, the context sources to build, and `knowledgePass`, a boolean | Composition | An unknown source, a source listed twice, a value that is not a list, or a non-boolean `knowledgePass` |
| `retention` | `transcripts`: `summary` or `full` | Every command that is not read-only | Any other value |
| `policy` | `organizationFile` and the user's `schema` and `rules` | The policy loader | Per the policy file rules; for an enterprise profile also an `organizationFile` that is not a string, is empty, is over 1,024 characters or holds a control character |
| `remotePatterns` | The remote globs an enterprise profile claims | The profile gate | A list over 64 entries, or an entry that is empty or over 256 characters |
| `workspaceRoots` | Not read by any code | None | Never |
| `freshnessWindowHours` | Not read by any code | None | Never |

`limits` names `contextTokens`, `maxConcurrentChecks`, `artifactQuotaMiB`, `maxActiveRuns`, `maxEventRows` and `checkOutputBytes`. `retrieval` names `indexEntries`, `returnedBytes`, `searchHits`, `queryTimeoutMs`, `snippetLines`, `snippets`, `fullReads`, `fullReadBytes` and `maxPages`. `adapters.context` names `gsd-intel`, `gsd-graph`, `gsd-planning` and `git-files`, defaults to all four, and may be an empty list, which selects no source and so no pack. `adapters.knowledgePass` defaults to true, and false records the knowledge index step as disabled and starts no knowledge invocation. A bad `credentials` or `retention` section stops every command that is not read-only with exit 70, naming the key, and a bad `adapters` section stops every command, read-only ones included. Read-only commands otherwise still run so the owner can diagnose. A bad `limits` section does not stop composition: the defaults stay in force so a typo never removes a bound, `start` refuses the run, and `doctor` names the section.

## Roots and isolation

A profile has three directories: the configuration home, the data root and the work root. The configuration home comes from `AVARICE_CONFIG_HOME` or defaults under the user's home. Each of the data root and the work root comes from an environment variable (`AVARICE_DATA_ROOT`, `AVARICE_WORK_ROOT`) for the selected profile. Without the variable it comes from the absolute or `~/` path in the profile's configuration, and without that from a default under the user's home for that profile. A relative root in the configuration is refused.

Before anything is created, each root is resolved through its nearest existing ancestor's real path and judged. Neither root may sit under a `.claude*` directory of the home (any first segment that starts with `.claude`). Neither may sit under the Claude configuration directory or contain the home or that directory, and the two may not be nested. The data root must be on a local mount, because SQLite's write-ahead log is unsafe on a network mount. Only then are the directories created with mode 0700 and the configuration written.

**Store scoping.** A store records the profile it was created for. A store that names another profile is closed untouched, before any migration, backup or record write, and the command exits 70 naming both profiles. A store that holds a project bound to another profile fails composition the same way for every command that is not read-only.

**Moved-root denial.** The sandbox of a run and of an onboarding invocation denies reads of every other profile's data root, work root and configuration home, and of the configuration homes in use and by default. The denial covers declared checks, validation, the baseline, the dependency install and the host's file tools, with the run's own clone and scratch allowed again after the denies. The roots come from every profile configuration found under the configuration home in use and the default one, whatever an environment variable moved. These entries are left out of the list: a directory that is not a profile name, and a link or a file standing where a profile directory belongs. A root that a readable configuration states as a relative path is also left out, as is the selected profile's own configuration. One odd entry therefore does not lock the machine. A configuration that cannot say where its profile put its roots is different, because skipping it would take that profile's roots out of the deny list. One kind is a configuration that is corrupt: not valid JSON, a refused key, a symbolic link, a file that is not regular, or one over the size cap. The other is one that the system refused to read: a mode that forbids it, or a sandbox deny. In both cases the command goes on and denies the whole root of that profile. That is its profile directory under the configuration home where it was found, and the default data root and work root of its name. A damaged or hostile file can therefore add a denial and never open a path, and it never stops another profile's commands. Any other failure to read it stops the command with exit 70 and the message `cannot read the other profiles of this machine`, naming the cause and the profile. A profiles directory that cannot be listed, and a profile directory whose type cannot be read, fail the command with exit 70 too. A list that could not be computed must not read as a shorter one.

**What stays open.** A profile whose configuration was never seen from the configuration home in use or the default one cannot be found, so its moved roots are not denied. A root that a configuration states as a relative path denies nothing until it is repaired. A configuration that is corrupt, or that the system refused to read, cannot say where its profile moved its roots, so only that profile's directory and its default roots are denied. A root it moved elsewhere is not. A root changed by environment variable after the configuration was written is not known to the registry.

The detached supervisor and the digest LaunchAgent carry `AVARICE_PROFILE` with the other three variables, because a supervisor has no repository to read a binding from. A store of another profile is refused there as it is everywhere.

## Credentials

A credential is named by a reference, never copied. A reference is `keychain:` and a service name, `cmd:` and a helper name, or `delegated:` and a CLI name. A name is 1 to 128 letters, digits, dots, underscores and hyphens, and is not all dots. `env:` in any letter case and every other scheme are refused in every profile, because an environment variable leaks to child processes, crash reports and shell history.

| Provider | What it does | Profiles that may use it |
|---|---|---|
| `keychain` | Runs the macOS `security` tool to read a generic password by service name | All |
| `cmd` | Runs an owner-approved helper through the sandboxed executor and takes its output | All |
| `delegated` | Checks that the named CLI is an executable on `PATH` and returns a handle with no value | `personal-extended` only |

The keychain provider runs by argument list, never a shell, with an environment of `PATH` and `HOME` alone and a 5-second timeout. The value arrives on standard output and is capped at 16 KiB. Exit 44 means no item. Any other exit is reported as unavailable with the exit status, a value over 16 KiB is invalid, and a timeout is its own error that the audit records as unavailable. The tool is macOS only, so the provider is unavailable elsewhere. The helper provider runs only helpers listed in the profile's `credentials.helpers`, a map from helper name to absolute path with no control characters and no `.`, `..` or empty segment. It runs with the network denied, `PATH` and `HOME` only, a 5-second timeout, and a 16 KiB output cap. Its output is trimmed on both sides, and its error stream is never read. A helper's output is too large only when standard output was cut at the cap, which shows as the truncation marker at its end. The volume of the error stream does not matter, so a helper that writes a lot to standard error and a short credential to standard output resolves.

The `credentials` section maps names to references: `credentials.<name>` is a reference string, and `credentials.helpers` is the allow-list. `helpers` cannot be a credential name. A provider the profile's class forbids is refused as denied whether or not one is wired, and a provider the class allows but composition did not build is unavailable.

**The handle.** A resolved value lives in a private field of a handle. It is not a property, and the handle's string, JSON and inspect forms are all the placeholder `[SecretHandle]`. The value leaves only as the argument of the one callback the handle accepts. A delegated handle holds the empty string and names the CLI.

**The audit.** Every resolution attempt, whatever its outcome, appends one `credential.resolve` event. Its data is the reference, the stated purpose, the calling module, the profile, the outcome (`resolved`, `unavailable`, `denied` or `invalid`) and the duration in milliseconds, with strings cut at 160 characters and control characters replaced. The run and invocation IDs ride on the event's own columns. The event never carries the value, its length or a digest. It is written at level info for a resolution and warn otherwise. An attempt whose event cannot be written does not hand out a value.

**Seeding.** A provider seeds the process redactor with each value before it returns the handle, so everything written afterwards shows `[REDACTED:seeded]` in its place. A value under 8 characters is refused as invalid, since a short value is a common word and redacting it would mangle the evidence it was meant to protect.

## Redaction

One redactor serves the process. It replaces every match of seven secret patterns with `[REDACTED:<kind>]` and every seeded literal with `[REDACTED:seeded]`. The kinds are `github-token`, `jwt`, `aws-key`, `private-key`, `authorization`, `url-userinfo` and `gsd-scan`. Digests, IDs and repository paths match none of them. Overlapping seeded matches merge into one marker, and the longest literal is found whole.

Redaction happens at these boundaries.

| Boundary | What is redacted |
|---|---|
| Events | Every string in an event's data, before it is bounded and hashed, so the stored text holds no secret and the row hash covers exactly what is stored. The hook and the ledger share the one redactor. |
| Shell history | Each entry, after control characters are removed |
| Host transcript | Each complete line as it arrives, before the size cap counts it, so a secret the cap would have split is never stored |
| Artifacts | The text kinds `transcript`, `transcript-summary`, `check-output`, `test-inventory`, `knowledge-manifest`, `gsd-quick-record`, `context-pack`, `manual-context`, `manual-evidence`, `restricted-plan`, `restricted-patch` and `restricted-decisions`, decoded as UTF-8, redacted and re-encoded before the store hashes them |
| Briefs and the comment text the owner prints | The process redactor, seeded values included, before the brief is parsed and before the comment is printed |
| Hook read records | A path that holds a secret-shaped string is stored redacted with a 16 character hash suffix |

Map documents and map snapshots are stored as given, because validation already refuses a map that holds a secret, and rewriting accepted bytes would change their recorded digests. A payload that is not valid UTF-8 is stored as given, and so is any kind not on the list. A test scans the code for the kinds it stores, so a new kind cannot be added without deciding which side it is on.

**Limits.** Object keys in event data are not redacted. The transcript boundary redacts line by line, so a multi-line secret that arrives spread over several raw lines is matched per line. Events and artifacts pass whole strings through the redactor, which removes a private-key block whole. The seed list is per process: the detached supervisor seeds its own redactor, and the hook's child process starts empty and applies the patterns only. The line editor of a live shell keeps the typed text in memory until the shell exits. The redaction is pattern based, so a secret format the patterns do not know can pass.

## Transcript retention

The profile key `retention.transcripts` is `summary`, the default, or `full`. With `summary`, a run keeps a redacted summary artifact and the digest of the redacted transcript. The summary holds the session ID, the number of turns, the cost, the tool uses and the result text. With `full`, it also stores the whole redacted transcript as an artifact. Setting `AVARICE_DEBUG_TRANSCRIPTS=1` stores the whole transcript whatever the profile says. The invocation's finish event carries the transcript digest in both modes.

## Quirks

- No command or stage resolves a credential yet. The broker is wired into the dependencies and tested, and has no caller outside composition.
- A repository registered in two profiles' stores locks the second store for every command that is not read-only until the stray project is dealt with.
- A process that dies while it holds the bindings lock leaves the lock file. The next writer takes it over once the holder is gone or its process ID belongs to a later process. A writer that finds a live holder for more than 2 seconds fails, and nothing is written. Where `ps` cannot be read, or the time in the lock is not a date, a hung live holder is taken over after 60 seconds.
- The first `config.json` records the roots in effect when it was written, including any environment override of that moment, and the file is never updated.
- A cmd helper cannot reach the network, so a helper that must contact a server fails as unavailable.
