VERDICT (round 4, group B): PASS. 0 BLOCKER, 0 WARNING, 0 NIT within scope.

HEAD checked: e5b33bae6d49f4637110b645aa2a008f2717121a

| Document | sha256 (computed) | Matches dispatch |
|---|---|---|
| docs/system/runs.md | 3fe2166132fab036a22a554a139386d2ea9b864186ff1b32c767f06ef32af879 | yes |
| docs/system/profiles-and-credentials.md | d1dfa303f68a07902d39545da1ec178a23db6bf710ff09670db6743b1165f368 | yes |
| docs/system/integrations.md | eaf1bdfc43485735699ca07f7ca0d27a4ff4779cfb22a288b01232c681192858 | yes |
| docs/system/indexes-and-context.md | 21f6c1dd1783b19018eb498a258217db571bb0793c88b04453324c613d4ec4bc | yes |
| docs/system/README.md | e76c486216137e1e30694b9d03b7a14e3ce652c320060633a4b250e16dd66f53 | yes |

Only indexes-and-context.md has changed lines since 08db6a5, in two hunks (lines 138 and 285). The other four have no diff and are bound by digest alone.

FINDINGS: none.

Checked and not flagged:
- Line 138, anchor: the link `#knowledge-record-fields` resolves to the heading "### Knowledge record fields" (line 212). The word "corpusCap" and the surrounding claims are unchanged.
- Line 285, retry report:
  - "says how many items were reused" matches `reuse.reused`, built at src/app/context.ts:537 and typed at :92.
  - An item the retry picks and cannot reuse is read again and listed with source, ID and reason (context.ts:468-470, `refetch.push` with `cacheMiss`). The reasons come from the five-miss list, whose order matches src/domain/cache-scope.ts:47-53 (revoked, profile, access-scope, format, revision).
  - A revoked handle is left out before anything is read and listed in `refetch` as `access_revoked` when the earlier pack held it (context.ts:427-433).
  - "Any other earlier item that the retry does not pick is not listed" is right: `refetch` is filled only inside the picked loop and the revoked branch.
- Line 285, ledger sentence: the sentence about references and a fresh supervisor is unchanged.
- Rules: every sentence in the changed lines is at most 35 words (the longest is 34). There is no em dash, en dash or spaced double hyphen in the file. The changed lines contain no file path, function name or delivery history. The `runs.md#reference-refresh-on-resume` link in the adjacent unchanged paragraph resolves to the heading at runs.md:462. The retry-report fact stays in this section.

Outside the scope (not counted):
- One edge case sits slightly outside the new sentence about revoked items. When a source refuses a read as denied or unauthenticated, the handles are omitted with `access_revoked` (context.ts:482-485) but are not added to `refetch`. The sentence says an earlier item "whose access was revoked" is listed, which holds for revoked references and not for a refused read. The edge is narrow and the claim is not misleading.

Read-only proof, `git status --short` after the run (the same four entries as at dispatch, none under docs/ or src/):
```
 M .planning/STATE.md
 M .planning/state.json
?? .planning/config.json
?? .planning/milestone.lock
```
I did not read or touch anything under .planning/.
