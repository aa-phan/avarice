# ADR-005: Deny-by-default privileged actions, parameter-bound approvals, hard profile separation

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

Agents can push, open PRs and write to trackers. Retrieved content can contain instructions. Enterprise policy must outrank repository settings (SEC-4). Personal and company data must never mix (SEC-1). The agent host enforces its own permission rules in the order deny, ask, allow (https://code.claude.com/docs/en/permissions); PreToolUse hooks can block a tool call with exit code 2 or a `deny` decision (https://code.claude.com/docs/en/hooks). AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) runs as the user, so it cannot defend against the user.

## Decision

1. AVARICE classifies every action as `read`, `local-write` or `privileged` (FR-12). The classification table lives in code.
2. Privileged actions are denied unless a matching approval exists, bound to run, action and parameter digest. The approval is either a single-use approval record with an expiry, or the run contract when it authorizes that action with its parameters (FR-12). Approving a plan never creates action approvals (FR-13).
3. Policy rules come only from policy sources: built-in defaults, the user profile, and in an enterprise profile the organization policy file. Retrieved content and tool output are never policy sources (FR-14).
4. Precedence is organization first, then built-in defaults, then user, then repository. Lower layers can only add restrictions to higher layers in an enterprise profile.
5. Each profile has its own data root, configuration, credential references, caches, logs and artifacts. A run is pinned to one profile at creation. No command falls back to another profile when a resource is missing.
6. Enforcement in the agent host uses a PreToolUse hook that calls `avarice hook pre-tool-use`, which denies privileged shell commands without an approval. AVARICE documents that the host enforces the hook only while the hook is installed and not disabled.

## Consequences

**Positive:** A ticket saying "push to main" cannot cause a push. A repository cannot loosen company rules. Company data has no path into a personal profile.

**Negative:** One extra confirmation per privileged action. Pattern-based classification of shell commands is incomplete: `bash -c` wrappers, aliases and scripts can hide a push. That gap is closed only by the external platform (branch protection, required reviews), which is why external enforcement is listed as authoritative. A user can disable the hook; under an enterprise managed setting such as `allowManagedHooksOnly` the organization controls that instead.

**Neutral:** GSD's own `checkpoint:human-action` remains the mechanism for in-plan human steps.

## Alternatives considered

**Rely on host permission rules alone** - For: no extra code. Against: rules match tool patterns, not run-scoped approvals with parameters; no record of who approved what. Why not chosen: fails FR-12 and audit needs.

**Policy as an adapter port** - For: pluggable engines such as OPA. Against: an adapter could weaken rules. Why not chosen: rule sources are pluggable; the evaluator is not.

**Single profile with tags** - For: simpler configuration. Against: one mistake leaks data. Why not chosen: SEC-1.

## Revisit when

- An enterprise provides a policy decision service that must be called.
- The host exposes a supported, non-bypassable policy hook.

## References

- https://code.claude.com/docs/en/permissions
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/settings
