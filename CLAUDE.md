# AVARICE

## Documentation

Two kinds of documentation live in this repository, and they are edited differently.

- `docs/system/` is the living documentation of the built system and the source of truth for built behavior. Any change that alters behavior, adds a command, flag, config key, table, event or external integration, or changes an exit code updates the matching `docs/system/` document in the same change. Update `docs/system/coverage.md` when a count it records changes.
- `docs/` outside `docs/system/` (requirements, architecture, design documents, `docs/decisions/` ADRs) is the proposal that unbuilt work is planned from. Do not edit it to match the code. Change it only when a design decision changes, and record the decision. An accepted ADR is never rewritten; supersede it with a new one.
- When code and a proposal disagree, the code and `docs/system/` describe what is; add one line with `file:line` to `docs/system/findings.md` for the owner to decide which side moves.
- Load the `technical-writer:technical-writing` skill for any documentation prose here. `docs/system/` documents name their modules once in the opening and keep file paths, function names and delivery history (phase numbers, plan IDs, threat IDs) out of the prose.
