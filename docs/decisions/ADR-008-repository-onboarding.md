# ADR-008: GSD maps and plans; AVARICE onboards in a contained staging worktree and records provenance

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

UC-9 requires bringing existing repositories under AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment), and ONB-2 forbids a second architecture index, conventions store, requirements store or roadmap. GSD 1.17.0 provides the semantic side: `/gsd-onboard` routing, `/gsd-map-codebase` (full, `--fast`, `--paths`), `stamp-codebase-map`, `verify codebase-drift` and `/gsd-ingest-docs` ([repository-onboarding.md](../repository-onboarding.md#verified-gsd-onboarding-surfaces)). Inspection on 2026-10-29 also found gaps that matter for authority and trust:

- The mapper agent has `Bash` and `Write` and only prompt-level limits; its prompt has no untrusted-input boundary (`agents/gsd-codebase-mapper.md:4`).
- `.planning/` is hardcoded to the repository root (`bin/lib/planning-workspace.cjs:144`), so GSD writes into whatever checkout it runs in.
- `init onboard` calls `loadConfig`, which can rewrite `config.json` (`bin/lib/planning-workspace.cjs:173-174`).
- Map completeness is file existence only, and the stamp records only a commit and a date, with no mode, scope or completeness.
- `/gsd-new-project --auto` chains into `discuss-phase --auto` (`workflows/new-project.md:1141`).
- No loop points exist for onboarding, so a GSD capability cannot gate it.

## Decision

1. AVARICE owns operational and trust onboarding. GSD owns semantic mapping and planning content. Enterprise systems stay authoritative for their records.
2. All GSD onboarding work runs in a **staging worktree** at the recorded revision. Each top-level GSD workflow runs in one contained headless invocation with a read-only command allow list and the fail-closed hook. Its sandbox can write only the staging `.planning/` (for the knowledge pass in decision 7, only `.avarice-knowledge/`) and reaches no network. Commits stay off (`commit_docs=false`, `git commit` not allowed) unless the contract authorizes promotion by commit.
3. AVARICE runs `init onboard` only in staging, runs `stamp-codebase-map` itself after fast maps, and records mode, scope and completeness in its own project record.
4. Planning initialization uses `/gsd-ingest-docs --manifest --mode new`, never `/gsd-new-project --auto`.
5. A versioned **project record** in the ledger references GSD artifacts by path, digest and stamp, and holds only operational metadata. Accepted artifacts reach the user's checkout only through an explicit promotion mode.
6. A `GsdOnboarding` port, pinned to GSD 1.17.x, wraps these operations so domain code never sees slash-command syntax.
7. Onboarding has an index stage, on by default, that builds GSD intel and the GSD-managed graphify graph in staging (ONB-13). The graph build is a sandboxed command with no model call; the intel refresh is a contained invocation. The project record keeps each index's build commit, and context assembly queries the indexes before whole files (FR-20). A failed index build drops that index and never blocks activation. The index stage also runs a knowledge pass that adds document nodes for stable documents (ONB-14) in one contained invocation, merged into the same graph. Fast-changing GSD phase files join the pass only once incremental refresh exists (ONB-15).

## Consequences

**Positive:** GSD's mapping and planning stay the single source of meaning. The user's checkout and uncommitted changes are untouched by default. Mapping is contained even though GSD's mapper is not restricted by GSD. Partial maps can never pass as complete, because AVARICE records completeness itself.

**Negative:**
- Mapping covers the committed revision only; uncommitted work is reported as not mapped.
- A staging worktree costs disk space and one extra step (promotion) before the user sees the files in their own checkout.
- The adapter depends on text-mode prompts in `map-codebase` (the existing-map question, the secret-scan pause) and must be re-tested on every GSD upgrade.
- Because the mapper may not run repository commands, its TESTING and STACK documents describe commands it never executed; active validation is a separate step.
- The index stage adds graphify 0.9.53 as an optional tool dependency and two more model invocations (the intel refresh and the knowledge pass) to the onboarding budget. Document nodes are model output; they rank below code nodes and are data only.

**Neutral:** Repositories that already use GSD keep their `.planning/` unchanged unless the user promotes new artifacts.

## Alternatives considered

**Run GSD onboarding directly in the user's checkout** - For: no promotion step; GSD's normal flow. Against: GSD writes `.planning/` and may rewrite `config.json` in the user's working tree; uncommitted user edits under `.planning/` could be replaced; the sandbox would have to allow writes into the live checkout. Why not chosen: conflicts with ONB-3 and ONB-6.

**Symlink `.planning` to an external staging directory instead of a worktree** - For: GSD supports it (`bin/lib/project-root.cjs:62-84`); no second checkout. Against: requires creating a symlink inside the user's checkout, and the mapper would still read the live working tree including uncommitted changes. Why not chosen as the default: it mutates the checkout. It remains the enterprise option when local planning files are prohibited.

**AVARICE builds its own codebase index (embeddings, structure graph)** - For: machine-readable scope and freshness. Against: a competing architecture index, which ONB-2 forbids. Why not chosen: duplicates GSD, which already manages intel and a graphify graph; decision 7 builds and queries those instead.

**`/gsd-new-project --auto` for planning** - For: one command from a brief. Against: chains into `discuss-phase --auto`, which answers without asking, and skips brownfield context. Why not chosen: violates AUT-1.

## Revisit when

- GSD adds loop points or a headless mode for onboarding, or records scope and completeness in its stamp.
- GSD relocates `.planning` through configuration.
- Mapping cost in staging exceeds the onboarding budget for typical repositories in the brownfield benchmark (AC-14).

## References

- [repository-onboarding.md](../repository-onboarding.md)
- `~/.claude/gsd-core/workflows/onboard.md`, `workflows/map-codebase.md`, `workflows/scan.md`, `workflows/ingest-docs.md`
- `~/.claude/gsd-core/bin/lib/onboard-projection.cjs`, `bin/lib/gate-codebase-drift.cjs`, `bin/lib/drift.cjs`
