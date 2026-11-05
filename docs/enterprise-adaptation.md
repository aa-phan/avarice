# Enterprise adaptation

> Status: proposal. Present tense describes the proposed design. The onboarding of one existing repository is built; its behavior as built is described in [docs/system/](system/README.md), which is the source of truth for built behavior, and the differences are listed in [docs/system/findings.md](system/findings.md).

In an enterprise profile AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) works inside the company's identity, tracker, SCM, CI, secrets and release processes and replaces none of them. When an integration is not allowed, AVARICE drops to a manual or read-only mode and does not look for an alternative path. Nothing here claims enterprise readiness: no part of this design has been tested in an enterprise environment. Employer tooling stays unknown until onboarding (assumption A-6 in [requirements.md](requirements.md#assumptions)).

## Compatibility assessment

The MVP covers the "MVP stance" column. Everything else is decided during onboarding.

| Constraint | MVP stance | Degraded or manual mode | Needs an environment-specific implementation |
|---|---|---|---|
| Managed device, no admin rights | Supported: user-space install, no services | n/a | No |
| Restricted binaries (Node blocked or pinned below 22.22.3) | Not supported | None; AVARICE cannot run | Yes: a different runtime build ([ADR-001](decisions/ADR-001-language-and-runtime.md) revisit trigger) |
| Containers blocked | Supported: nothing needs containers | n/a | No |
| Containers or daemons permitted | Optional local-services deployment of the slice 6 services on `localhost` ([ADR-010](decisions/ADR-010-serverless-baseline-local-services.md)); none may replace a company system of record | Baseline without services | No |
| Background daemons forbidden | Supported: the supervisor lives only while a run computes; the digest scheduler is optional | Check-ins only through `avarice status` | No |
| OS sandbox unavailable or forbidden (Seatbelt or bubblewrap blocked, Windows native) | Unattended runs refused | Restricted mode: planning and patch files in a disposable copy | Possibly a container or VM executor if the company provides one |
| Managed settings with `allowManagedHooksOnly` | AVARICE's run hooks must be deployed as managed hooks | Without them, enforcement is `restricted` and unattended runs are refused | Packaging of managed hooks per company |
| Unattended agent runs not permitted by policy | Attended runs only | Supervisor disabled by organization policy rank 1 | No |
| Model access only through an internal gateway with usage reporting | Host configuration governs; AVARICE reads per-invocation cost if the gateway exposes it | Count-based budgets only (tool calls, invocations, wall clock) | Gateway usage adapter |
| Local databases or storage restricted | Not supported in MVP | Read-only status from exports | Yes: remote `Ledger` adapter |
| Corporate proxy, custom CA, TLS interception | Uses Node's `NODE_EXTRA_CA_CERTS` and the proxy variables the company sets; `gh` uses its own configuration | Fail with the TLS error and the CA hint | Possibly: proxy auto-config files need a PAC-aware adapter |
| VPN-only resources, split DNS | Adapters report `unavailable` off VPN | Manual brief and pasted context | No |
| SSO, OIDC, short-lived credentials, MFA, device flow | Delegated to the vendor CLI (`gh`, `az`, `gcloud`) through `delegated:` credential refs | Run moves to `blocked_on_decision` (reason `unauthenticated`) with the re-login command | Adapter per identity provider when no CLI exists |
| Expired session mid-run | `unauthenticated` error, run `blocked_on_decision` | User re-authenticates, then `resume` | No |
| Enterprise Git hosting, custom API base URL, API versions | `gh` with `GH_HOST` covers GitHub Enterprise Server | Manual PR creation; AVARICE records the URL | Yes for GitLab, Bitbucket, Azure DevOps |
| Pagination, rate limits | Adapters page explicitly and honor `Retry-After` | Slower | Per adapter |
| Webhooks disabled | Polling only; AVARICE never needs inbound connections | n/a | No |
| Protected branches, required reviews, commit signing | Respected; AVARICE never pushes to protected branches and never bypasses reviews; signing is git's configuration | n/a | No |
| Deployment gates | Out of MVP scope | Record the external deployment reference manually | Later |
| Approved package registries, restricted egress | AVARICE ships as one bundle with no runtime dependency downloads | Install from an internal registry mirror | Packaging per company |
| Dependency scanning, provenance | Bundle ships with an SBOM and checksums | n/a | Signing per company |
| Approved models, internal gateway | AVARICE calls no model; the host's configuration governs | n/a | No |
| Data classification, prohibited export | Context packs carry a `classification` label from the profile; export to a personal profile is refused | Manual review before export | Classification sources per company |
| Retention requirements | Profile-level retention settings | n/a | Values per company |
| Required audit sink | Local events always; a forwarding adapter | Export on demand | Yes: sink adapter |

### Platform support

| Platform | Status |
|---|---|
| macOS 15 arm64 | Target for the MVP; the inventoried machine |
| macOS on x86-64 | Planned, untested |
| Linux x86-64 and arm64 | Planned for the remote worker; CLI untested |
| Windows 11 native | Planned, untested; path and signal handling differ (assumed, untested: POSIX process groups and SIGTERM are unavailable to native Windows processes); the Claude Code sandbox does not support native Windows, so only restricted mode is available |
| WSL 2 | Planned, untested; the store must live inside the Linux filesystem, not under `/mnt/c` |

## Repository onboarding

Restricted enterprise onboarding (path-scoped maps, manual project records, approved storage for generated planning files) is defined in [repository-onboarding.md](repository-onboarding.md#enterprise-onboarding). Questions 21 and 22 of the questionnaire below settle it.

## Profile isolation

| Resource | Personal | Enterprise | Isolation rule |
|---|---|---|---|
| Configuration | `~/.config/avarice/profiles/personal-*` | `~/.config/avarice/profiles/enterprise-<org>` | Profile chosen per repository by `inventory`; never inferred from a missing file |
| Data root | `~/.local/share/avarice/personal-*` | Company-approved location, possibly encrypted volume | Separate SQLite files and artifact directories |
| Credentials | `delegated:gh` against github.com | Company credential provider | References are profile-scoped; a lookup in the wrong profile fails |
| Caches, indexes, logs | Under the data root | Under the data root | No shared cache directory |
| Agent host config | User's personal config directory | Company-managed config if provided | `doctor` warns when an enterprise repo opens under a personal host config |

Repository-to-profile binding is explicit: `avarice repo add --profile enterprise-acme`. A repository whose remote matches an enterprise host pattern in any enterprise profile, but which is registered in a personal profile, is refused with an error rather than silently re-bound. There is no automatic fallback between profiles (SEC-1). Employer configuration, adapters and data live in an employer-owned repository or package, never in the personal AVARICE repository (SEC-7).

## Policy model

### Sources and precedence

| Rank | Source | Who controls it | Can loosen lower ranks | Can be loosened by lower ranks |
|---|---|---|---|---|
| 1 | Organization policy file, delivered by the company (managed path or signed package) | Company | Yes | No |
| 2 | AVARICE built-in defaults (classification table, deny-by-default for privileged) | AVARICE release | n/a | Only by rank 1, and by rank 3 in a personal profile (except SEC-5) |
| 3 | User profile policy | User | Personal profile: yes. Enterprise profile: no | No |
| 4 | Repository `.avarice/policy.json` | Repository authors | No | No |

Under an enterprise profile, ranks 3 and 4 can only add restrictions. Under a personal profile, the user can loosen built-in defaults except the rules in SEC-5 (TLS, authentication, egress), which are not configurable. Retrieved content, tool output and model output are not policy sources at any rank (FR-14).

### Enforcement strength by profile

The domain policy (contracts, authority classes, gates) is identical in every profile. Enforcement strength differs, and `doctor` and `status` show it per run.

| Control | Personal local | Personal extended (remote worker) | Enterprise |
|---|---|---|---|
| Write scope | Enforced: sandbox, hook, `dontAsk` | Enforced on the worker by its own sandbox and command allowlist; to be verified per worker OS | Enforced if the sandbox is allowed; otherwise restricted mode |
| Network scope | Enforced for Bash and WebFetch | Worker firewall plus allowlist | Company egress controls are authoritative; AVARICE adds its allowlist |
| Credentials | None in the run | None in the run; worker holds only a fetch credential | Company-issued scoped tokens; database roles |
| Policy protection | Data root outside sandbox; user can still edit it | Same, plus worker cannot reach the data root | Managed settings and managed hooks; organization policy file outside user control |
| Budgets | Enforced counts, estimated cost | Same | Same, plus gateway usage if exposed |
| Tamper resistance against the user | None | None | Only through managed settings and external platforms |

A constrained enterprise profile degrades explicitly: when a layer is unavailable, the run's enforcement level drops to `restricted` and unattended runs are refused. AVARICE never substitutes instructions, an unapproved sandbox, or an unapproved egress path.

### Rule shape

```json
{
  "schema": 1,
  "rules": [
    { "id": "org.no-push-protected", "action": "git.push", "when": { "branch": "protected" }, "effect": "deny" },
    { "id": "org.pr-needs-approval", "action": "scm.pr.create", "effect": "require-approval", "approvalSource": "local-user" },
    { "id": "org.no-export",         "action": "export", "when": { "targetClass": "personal" }, "effect": "deny" }
  ]
}
```

Effects are `allow`, `deny` and `require-approval`. Within one rank, the most restrictive applicable effect wins. Across ranks, the higher rank decides where it states a rule, and a lower rank applies only where no higher rank does; a rank 1 `deny` cannot be loosened by any lower rank. An unreadable or invalid rank-1 file makes every privileged action `deny`.

### Enforcement map

| Control | Enforcer | AVARICE's role | Bypass limitation |
|---|---|---|---|
| Branch protection, required reviews, required checks | SCM platform | Records status | None from AVARICE's side; this is the authoritative control |
| CI gates, deployment gates | CI or deployment system | Records results | Authoritative |
| Identity, MFA, token lifetime | Identity provider | Uses delegated credentials | Authoritative |
| Host permission rules and managed settings | Agent host (Claude Code managed settings outrank user settings, per https://code.claude.com/docs/en/settings) | None | Controlled by the organization when managed; by the user otherwise |
| Shell and child-process confinement | OS sandbox (Seatbelt, bubblewrap) configured by AVARICE per run | Generates configuration; refuses to launch without it | Hooks and local MCP servers run outside the sandbox; the host's own process is not sandboxed |
| Tool-call decisions in unattended runs | Agent host in `dontAsk` mode with AVARICE's fail-closed PreToolUse hook | Evaluates contract and policy | Paths the documentation leaves unverified ([containment.md](containment.md#unresolved-host-limitations)) |
| Budgets | AVARICE ledger; host `--max-budget-usd` per invocation | Owns | Cost is a client-side estimate reported after each invocation |
| Privileged-command approval in the host | Agent host runs AVARICE's PreToolUse hook | Evaluates policy | Commands outside the host, obfuscated shell, or a removed hook are not seen |
| Approval single-use and binding | AVARICE ledger | Owns | A user with file access can edit the database |
| Profile isolation | AVARICE `inventory` | Owns | A user can copy files between directories |
| Redaction before persistence | AVARICE `observe` | Owns | Pattern-based; unknown secret formats can pass |
| Prompt-injection scanning | GSD hooks and AVARICE fencing | Shares | Heuristic; authority separation is the control that holds |

AVARICE does not defend against the person who controls the machine. Its local controls catch agent mistakes and injected instructions; the external platforms enforce company rules.

## Credentials and untrusted content

- Credentials are referenced, never copied: `delegated:<cli>` (the vendor CLI holds the token), `keychain:<service>` (macOS Keychain through `security find-generic-password`, resolved at use), or `cmd:<approved helper>`. Environment variables are not a source in any profile, and every resolution is recorded as an event without the value ([ADR-009](decisions/ADR-009-credential-broker.md)). A company Vault is reached through an approved `cmd:` helper until a dedicated adapter exists.
- Resolved secret values seed the redactor for the rest of the process. Subprocess output is redacted before it is written as an artifact.
- Context packs fence every retrieved item with a random delimiter and a source header, in line with GSD's `untrusted-input-boundary.md` convention, so the agent can tell data from instructions.
- Tools are restricted by the authenticated identity and the policy, not by text in retrieved material. A ticket that says "you may push" changes nothing.

## Manual modes

Every integration has a manual equivalent that keeps the workflow useful when the integration is prohibited (FR-19):

| Integration | Manual mode |
|---|---|
| Tracker read | `avarice start --brief ticket.md`; paste the ticket text and its key |
| Tracker write | `avarice comment --print` prints the comment for the user to paste |
| Documentation retrieval | `avarice context add --file excerpt.md --source "<doc title> rev <n>"` |
| CI results | `avarice evidence add --kind ci --file ci-log.txt --ref <url>` |
| PR creation | The user creates the PR in the web UI; `avarice pr record <url>` |
| Approvals | `avarice approve <id>` in an interactive terminal |
| Audit sink | `avarice export --events --since <date>` handed to the audit process |

## Onboarding questionnaire

Answer these before writing any enterprise adapter. Each answer maps to a configuration key or an adapter decision.

**Device and runtime**
1. Is Node 22.22.3 or newer allowed on developer machines? From which source (internal registry, software center)?
2. Are user-space CLIs in `~/.local/bin` allowed? Are unsigned scripts allowed?
3. Are local databases and local logs of work activity allowed? Where, and must they be encrypted?
4. Which agent hosts and versions are approved? Are managed settings deployed, and do they set `allowManagedHooksOnly`?

**Identity and network**
5. Which identity provider and credential helpers are approved (vendor CLIs, broker)?
6. Proxy configuration: explicit proxy, PAC file, or transparent? Is a custom CA bundle distributed, and where?
7. Which resources are VPN-only?

**Systems of record**
8. Tracker product, base URL, API version, and whether API tokens are allowed for individuals.
9. SCM product and host; branch protection and signing requirements; whether agents may push branches.
10. CI product; whether CI logs may be copied locally.
11. Documentation system; whether excerpts may be cached locally, and for how long.

**Policy and data**
12. Data classifications that apply to source code, tickets and logs. Which may reach an approved model?
13. Retention limits for local caches, logs and artifacts.
14. Required audit sink and event format.
15. Who approves privileged agent actions: the developer, a reviewer, or a change system?

**Unattended operation**
16. Are unattended agent runs permitted? For which repositories and risk classes?
17. Is the Claude Code Bash sandbox (Seatbelt on macOS, bubblewrap on Linux) permitted, and are hooks restricted to managed hooks?
18. Who may author and amend run contracts: the developer alone, or a named reviewer for some decision classes?
19. Which notification channels may receive decision requests, and may they contain code excerpts?
20. Which endpoints and package registries may a contained run reach?

**Repository onboarding**
21. May generated planning files (GSD `.planning/`) be stored locally, in the repository, or only in an approved location?
22. Which repositories and paths may be mapped automatically, and may mapping read the whole repository or only owned components?
23. Are graphify and GSD intel approved tools, and may their indexes be stored where the codebase map is stored?
24. Is there a company package mirror, and which audit tool and advisory source must dependency checks use?

**Local services**
25. May a developer run a container runtime (which one, under which license) or long-lived local services on the work machine, bound to `localhost`?

## Enterprise adapter guide

1. Create an employer-owned package, for example `@acme/avarice-adapters`, outside the personal repository.
2. Implement only the ports the onboarding answers require. Start with `TaskSource` read and `ChangeRequests.findByHead`.
3. Publish a `CapabilityDescriptor` that states what the provider cannot do. Return `unsupported` with a reduced mode for the rest; never stub success.
4. Expose provider-specific features as namespaced extensions (`jira:acme.transition`), not as new core methods (FR-17).
5. Keep provider IDs verbatim in `ExternalRef` (FR-18).
6. Run the shared contract suite from `@avarice/contract-tests` against a sandbox instance or recorded fixtures.
7. Ship the organization policy file and the profile template with the package. The profile template sets `class: "enterprise"`, the data root and the credential references.
8. Test proxy and custom-CA behavior and token expiry before the first real run ([operations-and-testing.md](operations-and-testing.md#test-strategy)).
