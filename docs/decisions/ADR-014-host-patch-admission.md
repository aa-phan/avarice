# ADR-014: Admit host versions by patch range with a launch self-check

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-11-15 |
| **Deciders** | aa-phan (owner decision D-20) |

## Context

AVARICE starts the contained host only when `claude --version` reports an admitted version ([containment.md](../containment.md)). Until now admission was a constant list of exact versions, and a version joined the list only after a live T3 run on it showed no containment failure ([LIVE-CASES.md](../../test/containment/LIVE-CASES.md)). Five versions are on the list: 2.1.312, 2.1.316, 2.1.317, 2.1.318 and 2.1.319.

Claude Code releases a patch often, and the installed host updates itself. Each update left the next contained run refused until a live run on the new patch was recorded and the list edited. The five admission runs so far recorded 0 containment failures on every patch, and the patches differed little. The owner judged the delay and the live spend per patch larger than the risk they remove.

Two facts bound what a cheaper check can prove. The offline probes that exist (settings keys, hook configuration, hook self-test, sandbox probe) show that AVARICE wrote its settings and that its own script and the operating system behave. None of them exercises the host: whether the host calls the hook for every tool, obeys a `deny`, refuses Bash when its sandbox cannot start, or honours `dontAsk` and an empty `--setting-sources` is shown only by a live run (spike S4-C, sections 4 and 5). A flag-presence read of `claude --help` is cheap and catches a host that dropped or renamed a flag the launch line uses. It proves presence, never behavior.

## Decision

1. The admission of a host version is a pure predicate over the reported version, `admitHostVersion`, with three outcomes:
   - **verified**: the version is in the verified list (the five above). A version is added to the list only after a recorded live T3 run on it with 0 containment failures.
   - **unverified patch**: the version is in a verified minor and its patch is at or above that minor's lowest verified patch. Today the only verified minor is 2.1, from patch 312, so 2.1.313 to 2.1.315 and every 2.1 patch above 312 that is not on the list qualify.
   - **refused**: any other minor (2.2.0, 3.0.0, 2.0.500), a patch below the lowest verified patch (2.1.311), or a version that is empty or not three decimal numbers.
2. Versions compare per component as numbers. 2.1.100 is above 2.1.99 and 2.1.312 is above 2.1.40.
3. An unverified patch launches only when every probe below passes at launch. A failing probe refuses the launch with `enforcement_failure:{reason}` naming the probe:
   - **flag presence**: `claude --help` lists each of `--setting-sources`, `--permission-prompts`, `--permission-mode`, `--max-budget-usd`, `--settings`, `--plugin-dir` and `--agents` (`host-flag-missing:{flag}`; `host-unavailable` when `--help` cannot be read);
   - **sandbox probe** (`sandbox-unavailable`) and **hook fail-closed self-test** (`hook-self-test`), which already run before every launch;
   - **settings keys and hook configuration** (`settings-key:{path}`, `hook-missing`, `hook-not-blocking` and the others), which already run before every launch.
4. A verified version skips the flag probe. The refusals for the version itself are `host-minor-unverified`, `host-patch-below-range` and `host-version-unknown`; an output that does not start with a version stays `host-version-unreadable`.
5. The host descriptor carries the attribute `admission` with the value `verified` or `unverified-patch`. `doctor` renders the second as `admitted (unverified patch)`, so an owner sees which hosts ran on probes alone.
6. A new minor, or a patch whose probe fails, stays refused until a live T3 run on it passes. The admission rule and how each admission is recorded are in [LIVE-CASES.md](../../test/containment/LIVE-CASES.md#admission-rule-adr-014).

## Consequences

**Positive:**
- A patch upgrade of Claude Code no longer blocks contained runs while a live run waits for budget and an owner.
- A host that dropped or renamed a flag the launch line relies on is refused before the launch, at no model cost.
- The descriptor and `doctor` show which admitted hosts rest on probes alone.

**Negative:**
- A patch can change containment semantics without failing any offline probe: the host might stop calling the hook for a tool, ignore `onFailure: "block"`, or run Bash without its sandbox. Every offline probe would still pass and the run would proceed contained in name only. The behaviors only a live run proves are listed in the table below. The owner accepts this risk for patches within a verified minor. It is closed after the fact, not prevented: a live T3 canary on the installed version records whether the version held, and a failure there removes the version from use. Owner: aa-phan.
- The flag probe reads names from help text. A flag that is listed and no longer behaves as before passes.
- A version number is whatever the binary prints. A renamed or wrapped binary can report a version it is not; the probe set does not detect that.
- The verified list no longer bounds what runs. The verified minors and the lowest patch per minor are a second constant to keep in step with the live evidence.

**Neutral:**
- `ADMITTED_CLAUDE_VERSIONS` stays exported as an alias of the verified list for the importers that read it.
- The live harness's test-only admission override still names a version that is not verified and maps it to a verified one for the preflight; it never changes the list.

Behaviors that only a live T3 run shows (spike S4-C, section 5):

| Behavior | Why no offline probe shows it |
|---|---|
| The host starts the PreToolUse hook and obeys its verdict for each tool | The hook self-test runs the script directly, not through the host |
| The host refuses Bash when its own sandbox cannot start; `allowUnsandboxedCommands: false` and the strict network allowlist hold | The sandbox probe shows Seatbelt applies a profile, not that the host starts its own |
| `dontAsk`, `disableBypassPermissionsMode` and an empty `--setting-sources` have the assumed effect | The settings check shows the keys were written, not that the host reads them |
| `--restricted` removes the code-running tools, ignores user settings and confines the file tools; the hooks still run under it | Only its help text states this |

## Alternatives considered

**Keep the exact-version list, one live run per patch.** For: every admitted version has direct evidence, and the rule is simple. Against: the delay and spend recur with each patch release, and the evidence so far shows the patches differed little. Why not chosen: the owner judged the friction larger than the risk.

**Admit every version of the verified minor with no probe.** For: no new code and no added launch time. Against: a host that dropped a flag the launch line uses would start a run that cannot be contained as designed. Why not chosen: the flag probe costs one process start and catches that case.

**Admit any version and rely on the launch self-check alone.** For: nothing to maintain, no refusal for a new minor. Against: a new minor is where a change of semantics is most likely, and the offline probes cannot show it. Why not chosen: a new minor still waits for a live run.

**Admit an unverified patch only after a live canary on that version.** For: closes the residual risk before the first run. Against: that is the friction the owner wanted removed. Why not chosen: the canary runs on the installed version after admission instead, which detects a change without blocking the upgrade.

## References

- Spike S4-C, the flags the installed host lists and what each offline probe proves (`spikes/phase-4-wave-0/S4-C-host-probes.md`)
- [containment.md](../containment.md), the launch checks
- [LIVE-CASES.md](../../test/containment/LIVE-CASES.md), the live T3 cases and the admission records
