# ADR-007: Measure test strength with a mutation gate; reuse the adversarial-mutation-test skill, probe in Node

| | |
|---|---|
| **Status** | Proposed |
| **Date** | 2026-10-29 |
| **Deciders** | aa-phan |

## Context

In AVARICE (Agent Verification, Automation, Runtime Integration, and Coordination Environment), gate G4 proves that required checks passed on one revision, but a passing test can still be weak. [containment.md](../containment.md#enforcement-coverage-matrix) lists assertion weakening inside allowed test files as detect-only, AUT-9 forbids weakening tests, and AUT-13 requires test strength on changed lines to be measured with mechanically generated mutants. The implementing agent and GSD's verifier share a model family, so their blind spots correlate.

The `adversarial-mutation-test` plugin 0.35.0 is installed and enabled (inventory in [existing-tooling-assessment.md](../existing-tooling-assessment.md#plugins-skills-and-mcp)). Read on 2026-10-29 from `~/.claude-edu/plugins/cache/rainlanguage-skills/adversarial-mutation-test/0.35.0/`:

- The skill (`skills/adversarial-mutation-test/SKILL.md`) is model guidance with two passes. The **mutation** pass breaks each enumerated behavior and checks that a test notices. The **adversarial** pass treats the spec as the oracle to find real bugs, because "a killed mutant proves the behavior is PINNED, never CORRECT". It never edits a test to pass under a mutation, and it runs long campaigns, fanning out through the Workflow tool for whole repositories.
- `mutation-probe-rs/src/main.rs` is a tested Rust harness. It applies exact-string mutants from a `mutants.toml` file and returns `KILLED`, `SURVIVED`, `NO-RUN` or `HARNESS-ERROR`. Exit code 0 means every mutant was killed, 1 means something was not killed, and 2 means the pass could not be trusted. It refuses to score on a red baseline, on a suite run with no proof line, on a target that does not match exactly once, or on a failed restore.
- The probe installs with `nix run` or a Cargo build. Neither nix nor a Rust toolchain is installed on the target Mac.
- The plugin is licensed under a "DecentraLicense", which has not been reviewed for this design.

## Decision

1. Gate G4 gains an optional **mutation gate** over the lines the run changed. AVARICE generates a **mechanical mutant set** deterministically, with no model involved. The operators are comparison and boundary flips, boolean negation, arithmetic operator swaps, constant and return-value replacement, and removed early returns or guard clauses. The gate requires each mechanical mutant to be killed or explicitly accepted as equivalent.
2. AVARICE ships a **Node mutation probe** written independently from the documented behavior of `mutation-probe`. It uses the same `mutants.toml` format, the same four verdicts, the same exit-code meaning and the same integrity refusals. When `mutation-probe` is installed, AVARICE can use it instead through the same adapter. No plugin code is copied.
3. The probe runs outside the contained agent invocation, in a disposable clone of the run worktree at the verified revision, inside the same OS sandbox configuration as every other check ([containment.md](../containment.md#checks-and-probes-run-sandboxed)). It never mutates the run worktree or the user's checkout.
4. The **skill is reused unchanged** for a `harden` work item type. A `harden` item runs as one contained GSD unit with the skill named in the task. Its contract makes test paths writable and every non-test path read-only, and it uses the narrowed serial scope; Workflow fan-out is not in the contract's tool list. Mutants the skill proposes, plus its adversarial findings, are recorded as `model-review` evidence. They supplement the mechanical set and never replace it.
5. Survivors after the repair budget become a decision record of class `repeated_failure` that carries the surviving mutants. A `NO-RUN` verdict is `inconclusive` and is never scored as a survivor.

## Consequences

**Positive:** Assertion weakening on changed lines becomes measurable instead of review-only. The mechanical set is independent of the implementing agent. Reusing the skill gives the adversarial pass without rebuilding it. No Rust or nix dependency is added.

**Negative:** Each mutant costs one suite run, so the gate needs its own budget and can dominate wall-clock time on slow suites. Mechanical operators produce equivalent mutants (changes with no observable effect) that a human must accept or that inflate escalations. AVARICE must keep the Node probe behaviorally aligned with `mutation-probe` by hand. Mutation proves that tests pin behavior. Whether the behavior is right still depends on acceptance mapping and the adversarial pass, which is model output.

**Neutral:** Whole-repository hardening campaigns stay an attended activity using the skill directly.

## Alternatives considered

**Require `mutation-probe` itself (nix or Cargo)** - For: the tested original, with no duplicate implementation. Against: adds a toolchain that managed machines often block and that this Mac lacks; violates the single-runtime decision in [ADR-001](ADR-001-language-and-runtime.md). Why not chosen: distribution cost; it stays supported where present.

**Language-specific mutation tools (StrykerJS, mutmut, cargo-mutants)** - For: mature operator sets and incremental modes. Against: one tool per language, each with its own configuration and runtime; whole-file or whole-project scope by default. Why not chosen: AVARICE needs one diff-scoped harness with uniform verdicts; these remain options a repository can declare as an ordinary check.

**Let the skill run the probe and report the score** - For: no AVARICE code. Against: the score would be model-reported, and the implementing context would choose its own mutants. Why not chosen: violates AUT-13 (mutants generated without a model) and the independence rule for evidence.

## Revisit when

- The plugin publishes a prebuilt `mutation-probe` binary for macOS and Linux, or an npm package.
- The license is reviewed and permits vendoring.
- Equivalent-mutant escalations exceed 20% of mutation-gate escalations in the benchmark.

## References

- `~/.claude-edu/plugins/cache/rainlanguage-skills/adversarial-mutation-test/0.35.0/skills/adversarial-mutation-test/SKILL.md`
- `~/.claude-edu/plugins/cache/rainlanguage-skills/adversarial-mutation-test/0.35.0/mutation-probe-rs/src/main.rs` (verdicts and exit codes in the header comment)
- `~/.claude-edu/plugins/cache/rainlanguage-skills/adversarial-mutation-test/0.35.0/README.md`
