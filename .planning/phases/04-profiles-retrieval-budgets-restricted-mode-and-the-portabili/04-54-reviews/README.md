# Plan 04-54 documentation review records

Status: no round has run. The executor of plan 04-54 had no way to dispatch a fresh `technical-writer:prose-reviewer` (its toolset has no agent-dispatch tool, and the `prose-review` skill dispatches one reviewer per file), and the plan forbids a self-review. Every document below therefore stays `changed after review` in `docs/system/coverage.md`. Nothing here is a pass.

Code under review: `96a0718` (the last commit that touched `src`). Documents under review: the 04-53 changes (`792536d..HEAD -- docs/system`), the post-merge regression-fix statements (`54fc813`), and the ledger edits of `e6651c3`.

## Review groups

Groups follow `04-53-doc-worklist.md` (A to D) and the plan's expected groups. The worklist's group D (runs, onboarding, indexes) was not in the plan's file list, so no `round-1-D.md` is named in the plan's `files_modified`; it is added here because three changed documents belong to no other group. `unknowns.md` (changed after its earlier review, in no earlier group) joins group C.

| Group | Documents | sha256 of the version to review | Reviewer checks against the code |
|---|---|---|---|
| A | `policy-and-approvals.md` | `4613ac8b66aca649ac95179b1b79ab72f455fc40bc97fd47d92ffbfb5f9a9f9d` | the classifier, the two hook modes, the approval gate, the enforcement-map row |
| A | `diagrams/approve-privileged-action.puml` | `f18ec888c1e2cd1db95a3dd960c4df5e1ae5cd49fee0951fe48252ab31e9d25d` | read with `processes.md` |
| A | `processes.md` (approve flow) | `6600cb9ca1fd1ba76a775f021a0af2743ba03aa0fb0da03aeafc72b2c8f412fd` | the approve steps against the hook and `approve` command |
| A | `doctor.md` | `215bba2b3345e44eff89e61c0b9a9d470c2b53c8e01839f6efd69ba456f9f1e9` | the extensions probe and finding row |
| A | `profiles-and-credentials.md` | `7aab552cf430b8a96e285323f3af0f2bd7e4880b1e84c70fdf8f9c9b05be7b4c` | the bindings lock, the moved-root denial including the permission-refused case (`src/adapters/fs/profile-registry.ts`, `src/cli/composition.ts`), the `cmd` helper size rule |
| A | `findings.md` | `8aeb50be9c39704d131e2d288aed191fa3a29aedc815614187624e979da0595c` | every added, closed and moved line at its cited `file:line` |
| B | `cli-reference.md` | `937882f0f9ce43bfb859b7a35c0034930f71340f20c9d53613e74301f1e53cf2` | install-host and approve, the other-profiles bullet, the context item field `codeNode` |
| B | `config-reference.md` | `fc7997ff6625882f89b27411fb8b244e6c6296525b134fe7862510b3fcd68964` | the retrieval rows and the read-exclude row |
| B | `README.md` | `da33eb7bafce92c1b3aca7ade312c91fbd057fb3d76af93f4c461afa0eb66e58` | both tables against the files and the proposals (new ADR-016 row) |
| C | `containment.md` | `bed1886525aacb7654d7665439f13cc74cd021c0fd90c10373bcef6703afa901` | the rule list and counts (40, 35, 6), the Read charge, restricted patch rules, other profiles' roots |
| C | `data-model.md` | `f1eecef5b28def08309c4f3d5a5ce07d9f997ede3262ff743374aee557c23bae` | the event rows, the lock file row |
| C | `integrations.md` | `cb3ae44f51034f00e2d8b886999e7f5b2b2c84c1003214fb06b61f46e20ed894` | credential helper rows, install-host refusals |
| C | `unknowns.md` | `9b444a7440670e4b0097645424a465523e6f3d6e2edfc605a945a81a684611d7` | the entries against the files they cite |
| D | `runs.md` | `455375071b9bb30bab5a79834f4975ef9b0018f4b881770d25741210e846a48a` | the restricted stage, the resume re-block, spec derivation from code nodes |
| D | `onboarding.md` | `4f47f8ad1547a2996cd78586a6271785e3f568283adc3266c677ee89dafde8e2` | the scoped-map refusal, the promotion path rule, the reap refusal |
| D | `indexes-and-context.md` | `b8861ce4f5eaf0083420925909cb557489a48a616ebbb128a52eb82d53fbc444` | the cost cap, the heading parser, exclusion at any depth, the untrusted marking and `codeNode` |

Each reviewer should read every sentence that states a limit (65,536 characters, 8 levels, 16 prefix words, 2 seconds, 1 MiB, 440 characters, 2,000 characters) against the constant in the code.

Round budget: at most three rounds per group, each by a fresh reviewer that has not seen an earlier round. Each report is stored verbatim as `round-<n>-<group>.md`. A group passes when its last round records no BLOCKER and no WARNING. A document is marked `reviewed` in `coverage.md` only after its group passed, naming the round file. An edit after a passing round voids the verdict.

## Review rounds

| Round | Group | Report | Verdict | Found and done |
|---|---|---|---|---|
| (none run) | | | | |
