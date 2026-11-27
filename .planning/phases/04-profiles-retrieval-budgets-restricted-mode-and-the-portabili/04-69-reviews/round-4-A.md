VERDICT (round 4, group A): PASS. 0 BLOCKER, 0 WARNING, 0 NIT within scope.

Reviewed at HEAD e5b33bae6d49f4637110b645aa2a008f2717121a (confirmed with `git rev-parse HEAD`).

| Document | sha256 (my own `shasum -a 256`) | Matches dispatch |
|---|---|---|
| docs/system/policy-and-approvals.md | b6f371ec9b122a4dd193277bb17f2f056dc9f23c6e0e77f1298f4185e0c66962 | yes |
| docs/system/containment.md | 0bdf47a8b35b064e614ad8fe2bc90d336c260a591e83d0a4a069c0e2234b6d16 | yes |
| docs/system/diagrams/approve-privileged-action.puml | 0f5cfa1268c1d34cce59eaef66dec72e6d3b93deab3aa00ddb29a46a61e4524e | yes |
| docs/system/processes.md | d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51 | yes |
| docs/system/cli-reference.md | 30cd0bba18f5b7f305739bfa1f0378e813e1011679de2096e58a68a7902d66fc | yes |
| docs/system/data-model.md | f1badee031dc5cf7bee8d7db7468c53d5da798fd835df7996d775b686b663cbc | yes |

`git diff 08db6a5 HEAD --stat` over the six documents shows only docs/system/policy-and-approvals.md changed (4 insertions, 3 deletions). The other five have no changed line and are checked by digest only.

FINDINGS: none

## What I checked in the changed lines and did not flag

Changed lines: gate steps 6 and 7 in "How an action reaches an approval", and the git-alias and brace-expansion bullets under "Three outcomes". I read each with its whole section.

- **Gate order (steps 6 and 7).** The code agrees with the new text.
  - src/app/authorize.ts runs policy, then the open-start check, then the allow path, then the contract source, then `consumeApprovalAndStart`.
  - Only after those does it call `unshowableReason`. When that returns a reason, it denies with `UNAPPROVABLE_RULE` and writes no request (authorize.ts, the "An approval is asked for only when" block). The `approval-required:` request ID comes after that.
  - `UNAPPROVABLE_RULE` is `privileged:unapprovable` (src/domain/privileged-commands.ts:42).
  - The reference "see Parameters and digest" matches the heading at line 56. Line 148 already cites it the same way. It is not a link, and I did not count that as a defect.
  - The "Parameters and digest" section says the same about the gate. That is routing, not a second decision, so I did not flag it as a one-home violation.
- **Cannot-be-shown-whole cases.** I checked them against src/domain/approval.ts: the 80-character key/value limit, the 400-character combined limit, the 512-character working directory, control characters, no canonical form, and the secret patterns. They agree with the section the new step 6 points to.
- **Attended reasons for alias and brace expansion.**
  - src/domain/privileged-commands.ts:946 says "the line defines a git alias or a config include, which cannot be checked; run the command it stands for".
  - Line 528 says "a brace expansion or a glob decides which command runs; write the command without it".
  - src/hook/pre-tool-use.ts:721 and the denial near lines 640-660 show these as the reason shown to the owner.
- **Run behavior.** src/domain/hook-decision.ts:821 refuses an `unparseable` line with `shell-syntax`. `GIT_RULE_REASONS` has no entry for `shell-syntax` (hook-decision.ts:669-674), so the reason comes from `shellRuleReason` in src/domain/run-shell-rules.ts:35. That matches "A run denies the line as `shell-syntax` with that rule's own reason". The alias and expansion cases reach `unparseable` through privileged-commands.ts:957-972 and 1032-1057.
- **House rules in the added lines.**
  - No em dash, en dash or spaced double hyphen (grep count 0).
  - No sentence over 35 words. The longest added sentence is about 30 words.
  - No file path, function name, phase number, plan ID or threat ID in the prose.
  - Rule names appear in code spans as identifiers, consistent with the rest of the document.
- **Terms.** "attended session" and "run" are used consistently with the rest of the document.

## Outside the scope (not counted)

In an attended session the full hook message wraps the alias and brace reasons. It reads `the command could not be checked for privileged actions (<reason>); split it into shorter commands, or write files with the Write tool`, so it adds advice that does not fit these two causes (src/hook/pre-tool-use.ts, the `denyUnparseable` emit, near line 660). The document speaks only of "the reason", which is accurate, so I made no change request.

## Read-only proof

`git status --short` output:
```
 M .planning/STATE.md
 M .planning/state.json
?? .planning/config.json
?? .planning/milestone.lock
```
These four entries match the status snapshot at the start of the session. I did not touch them and did not read anything under `.planning/`. I wrote no file anywhere.
