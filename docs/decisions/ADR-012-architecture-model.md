# ADR-012: Hold code to a repository-owned, machine-checkable architecture model

| | |
|---|---|
| **Status** | Proposed; amends ONB-2 through [requirements.md](../requirements.md#codebase-onboarding) |
| **Date** | 2026-11-01 |
| **Deciders** | aa-phan |

## Context

AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment) has GSD's prose `ARCHITECTURE.md`, a code graph from onboarding (ONB-13), and symbol-level checks per work item (AUT-17). Nothing states which components exist and which may depend on which, so nothing can flag a change that crosses a boundary the design never allowed. This was gap G-4 in the [comparison](../reference-system-comparison.md#g-4-validated-architecture-model).

3dmk solves it with Magi: a typed graph of running parts and edges, every data edge naming its model, checked against code at each epic's close (3dmk documentation: `concept-to-seed.md`, `reconciliation.md`). ONB-2 forbids AVARICE from creating a competing architecture index, because GSD owns architecture discovery.

## Decision

1. A repository may declare an **architecture model** in `.avarice/architecture.json` (FR-25). It lives in the repository, is committed, and is versioned by git. It restates the design in checkable form and does not replace GSD's prose.
2. The model lists:
   - **components**, each with an ID, a kind (`service`, `module`, `library`, `process`, `datastore`, `interface` or `external`) and path globs;
   - **edges** between components, each with a kind (`imports`, `calls`, `reads`, `writes`, `publishes` or `subscribes`) and, for data edges, the symbols of the contract that crosses it;
   - **shared resources**, each with a UUID, so a database or outside service has one identity in every repository of a project group (FR-21), as Magi's shared IDs do.
3. AVARICE drafts the first model deterministically from the code graph: top-level packages and directories become components, and observed imports become edges. The draft is a proposal in the onboarding staging worktree. It becomes the repository's model only through promotion and the user's approval.
4. An `architecture-model` check compares the code graph at a revision with the model and reports four finding types:
   - a component whose paths match no code;
   - code outside every component and outside declared exclusions;
   - an import between components with no declared edge;
   - a contract symbol named on an edge that the code does not define.

   The check runs at G4 when the repository declares it. Inside G2, a new cross-component import with no declared edge is an AUT-17 finding.
5. The agent cannot change the model: `.avarice/**` is a protected path in every contract. A finding that needs a design change becomes a decision. As in 3dmk, only an approved model changes the design.
6. ONB-2 is amended. A repository-owned model that the user approves is not an AVARICE index; AVARICE stores only its path, digest and check results.

## Consequences

**Positive:**
- Boundary violations become machine-detectable findings with evidence.
- The model travels with the repository into any environment, including an employer's.
- Shared-resource UUIDs give cross-repository runs (slice 7) a common vocabulary.

**Negative:**
- The repository's maintainers, who approve the model, must keep it current; a stale model produces noise until it is updated.
- The deterministic draft reflects the code as it is, including existing boundary violations, which the user must prune.
- Import-level edges cannot see runtime calls such as HTTP or queue messages; those edges are declared by hand and checked only for contract symbols.

**Neutral:** GSD's `ARCHITECTURE.md` stays the prose description; the review-only reconciliation (FR-23) can compare the two.

## Alternatives considered

**Store the model in the AVARICE ledger** - For: no file in the repository. Against: a competing architecture index, which ONB-2 forbids, and invisible to the employer's review process. Why not chosen: the repository is the right owner.

**Generate the model from `ARCHITECTURE.md` with a model pass** - For: no manual drafting. Against: model output becomes the design without approval, and prose is ambiguous about boundaries. Why not chosen: the draft must be deterministic and the approval human.

**Language-specific architecture linters (dependency-cruiser, import-linter, ArchUnit)** - For: mature rules per language. Against: one tool and configuration format per language, and no shared-resource identity across repositories. Why not chosen: a repository may still declare one as an ordinary check; the model gives AVARICE one format across languages.

## Revisit when

- Findings on the brownfield benchmark are dominated by stale-model noise.
- GSD adds a machine-readable architecture artifact, which the model should then reference instead of restating.

## References

- [repository-onboarding.md](../repository-onboarding.md)
- [contracts-and-state.md](../contracts-and-state.md#phase-gates)
- [reference-system-deep-dive.md](../reference-system-deep-dive.md#magi-and-reconciliation-design-held-against-code)
- 3dmk documentation, version 2.1.3: `concept-to-seed.md`, `reconciliation.md`
