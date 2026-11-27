VERDICT: FAIL (review group A, round 1). The group has 1 BLOCKER and 1 WARNING. Both blocking findings are in the changed text and are checked against the code at HEAD 632cf05.

Severity vocabulary: BLOCKER means a claim the code contradicts, or a hard-rule violation. WARNING means a rule breach (here the 35-word sentence cap) or a loosely supported claim. NIT means polish or a minor omission.

## Header: documents and verified digests
All six digests match the dispatch. Nothing was edited.

| Document | sha256 |
|---|---|
| docs/system/policy-and-approvals.md | aee16bfa541f30941072cdd159c8ab285c1dd0e37a13210c612cc3612a2eeeb3 |
| docs/system/containment.md | f482d11fff951cec5e5109c9854f3daefb564e2265d231bbfff7d463b8834caa |
| docs/system/diagrams/approve-privileged-action.puml | ef09bc83cf5a77b3df4f3826ffb0bcacda6a6767b56ee034011082db19f88a15 |
| docs/system/processes.md | d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51 |
| docs/system/cli-reference.md | a9a8093a44d1f9016ec1faba98e0342edfb878be677b702e462399a084a1f451 |
| docs/system/data-model.md | 25c4fcf61c9cf74cad6a01dd263333b7bddac54fc2316e4727b03b74e4ad7daf |

## Findings (most severe first)

### F1. BLOCKER (high confidence): cli-reference.md:68 says a corrupt profile configuration is skipped, but the code denies that profile's whole root
- Text: "A configuration the system refuses to open (a forbidding mode or a sandbox deny) does not stop the command. The whole root of that profile is denied and the command goes on, ... A corrupt configuration is skipped."
- Code evidence: src/adapters/fs/profile-registry.ts:85-87 handles `isPermissionRefusal(config.error) || config.error.kind === 'invalid'` in one branch. Both cases add `wholeRootOf(...)` to the deny list and `continue`. Corrupt means invalid JSON, a refused key, a link, or oversize (comment at :7-12 and :80-84). Only an I/O failure or an unlistable profiles directory stops the command (:89-90, :103; message at src/cli/composition.ts:313).
- Contradictions elsewhere: containment.md:214 and :574-575, policy-and-approvals.md's profile-isolation row (line 196), and profiles-and-credentials.md:67 and :69 all say the whole root is denied for both corrupt and refused configurations. findings.md:264 says the same.
- Fix: rewrite the sentence to say that a configuration the system refuses to open, or that is corrupt, does not stop the command and has the whole root of its profile denied. Drop "A corrupt configuration is skipped."

### F2. WARNING (high confidence): changed sentences exceed the 35-word hard cap in style.md:7
Counts come from a mechanical sweep of the added lines. Table rows were excluded. Counts are minimums, because the sweep also split on semicolons. Several are bullets, which the reference-list carve-out may excuse. The long prose sentences are not covered by it.
- containment.md:214: "A configuration that is corrupt (...), and one that the system refused to read (...), have the whole root..." (56 words).
- containment.md:269: "`privileged:unapprovable` is for a command whose effect an approval cannot bind, ..." (62 words); "A command whose values cannot be shown whole is denied in a run under ..." (36 words).
- containment.md:392 (43), :401 "The refusal then says..." (42), :575 "A command name built from a variable..." (52).
- policy-and-approvals.md:65 "The working directory (the `cwd` key...)" (41), :105 wrappers sentence (36) and the `gh` sentence "For `gh` it also reads past options..." (45), :109 (45), :112 (40), :122 (40), :123 (53).
- policy-and-approvals.md:125: three sentences of 43, 56 and 38 words.
- policy-and-approvals.md:149 "A privileged command whose bound values cannot be shown ... is denied with the same `privileged:` rule and no request: ..." (63 words), :154 (46), :167 (41).
- cli-reference.md:567 "For the settings file it is ..." (40).
- Fix: split each at its colon or comma. The 63-word run-denial sentence (policy:149) and the 62-word `unapprovable` sentence (containment:269) should become one claim per sentence. A short list for the "cannot be shown whole" fields is already in place at policy:58-63 and can be reused.

### F3. NIT (medium): two reason texts are attributed more narrowly than the code states
- policy-and-approvals.md:122: "The reason ... says ... that the owner can run the command it stands for". The code text (privileged-commands.ts ALIAS_REFUSAL) is "run the command it stands for", with no named actor.
- policy-and-approvals.md (`trap` rule): "`trap` with one operand, with `-` as its first operand, or with `-p` runs nothing". trapString (privileged-commands.ts) also returns nothing for any option-led first operand, including `-l`.
- Fix: drop "the owner can" or state the actor as the code does, and say "or an option such as `-p`".

### F4. NIT (medium): the residual list and the enforcement-map row disagree on one item
- policy-and-approvals.md (classifier cannot see) lists "an npm option the classifier does not list whose value is the name of an npm command". The `privileged-approval` map row (line 194) and the code table (src/domain/enforcement-map.ts:97) do not.
- Evidence: src/domain/privileged-commands.ts:854 comment names the unlisted-option residual.
- Fix: add it to the row's residual list or to findings.md. The sentence under the map table already points to findings.md for the other wording differences.

### F5. NIT (low): two lock-staleness descriptions omit a case the code covers, identically
- data-model.md:13 and profiles-and-credentials.md:26 both say the 60-second rule applies when "the start cannot be read". src/adapters/fs/profile-bindings.ts:202-208 also applies it when the lock's own time is unparseable (`Number.isFinite(wroteAt)` false).
- This is not a divergence between the two documents; both are equally incomplete. Add "or the lock's time" to both.

### F6. NIT (low): policy-and-approvals.md:206 narrates document history
- "the code table's own text is older and is recorded in findings.md". "Older" describes how the docs and code diverged over time, not current behavior. Reword to "the code table's text differs; see findings.md".

## Checked against the code and found correct
- **Constants:** 80 / 400 / 512 / 917 / 1,024 in approval.ts:12-19 and events.ts:14. 65,536 characters, nesting 8 and 16 prefix words in privileged-commands.ts:76-77 and :582. The run line cap of 16,384 in hook-decision.ts:140 and :816, applied before the classifier. 30 minutes in approval.ts:9. `ISSUE`-style caps were not claimed.
- **Cannot-be-shown-whole conditions:** all six conditions in policy:58-63 match `unshowableReason` (approval.ts:100-122): the 80-character key or value cap, the 512 working directory, the 400 joined entries, a control character, no canonical form, and a secret match over the joined entries with the working directory included.
- **Refusal reason and denial text:** the reason names the key and its length or the cause, never the value, and says the owner can run the command at their own terminal. The run denial text says no approval was asked for.
- **Followed forms:** the wrapper list in policy:105 equals WRAPPERS and `coproc` (privileged-commands.ts:~550-576). The `sh`/`bash`/`zsh`/`dash`/`ksh`, `eval`, `su -c` and `--command`, `trap`, `find -exec/-execdir/-ok/-okdir`, `parallel`, `watch -x` and here-string forms match classifyWords. The seven forms match PRIVILEGED_COMMAND_FORMS.
- **Residual list:** the residual lists (policy:162-171, containment:575, the enforcement-map row at policy:194) match enforcement-map.ts:97 plus the in-code residual comment. The map row's added "A removed hook is caught by the launch preflight" matches the code row.
- **Run and attended paths:** the run denies only the first privileged command (pre-tool-use.ts:456-465). The attended hook refuses unshowable or unapprovable commands before consuming anything (pre-tool-use.ts:723-730) and writes one `policy.denied` per command with the documented data. The gate refuses with `privileged:unapprovable` after the contract and approval sources are checked (authorize.ts:130-162). The data-model `policy.denied` and `action.started` rows match this. The interrupted-action end semantics match authorize.ts:205-215.
- **Policy file limits:** `when` key grammar and `approvalSource` grammar match policy.ts:63-67. The policy-source builder refuses with an `invalid` error (policy.ts:227-259).
- **cli-reference approve:** the `approve` section and exit 64 row match approve.ts. The context `items` row (`codeNode`, `format`) matches app/context.ts:57-64 and :241-245, and cache-scope.ts:17 (`PACK_ITEM_FORMAT` = 1).
- **Restricted-run text:** the restricted-run scope rule, literal exclusion, and "first 10 paths and the count" match item.ts:348-358, restricted.ts:225, and blocked.ts:60 and :160.
- **Diagram and processes.md:** the approve-flow steps agree with the diagram and with the code branches, in order.
- **Bindings lock rule:** data-model.md:13 and profiles-and-credentials.md:26 and :120 describe the bindings lock rule identically in substance. Both state the 2-second wait, the four takeover cases and the 60-second residual, and both match profile-bindings.ts:146-208. The only gap is F5.
- **Mechanical sweep:** no em dash, en dash or ` -- ` in any of the six files. No plan IDs, threat IDs or phase numbers in prose. No file paths or function names in the added prose. The `Sources` table column in processes.md is an existing convention. Anchors cited from the changed text exist: `#records-written-by-a-successful-start`, `#restricted-runs`, `#roots-and-isolation`, `#restricted-mode`, `#owner-commands-and-the-terminal-identity-rule`, `#approvals`, `#privileged-commands-in-the-hook`.

## Read-only proof
`git status --short` after the run shows only `M .planning/state.json`, `?? .planning/config.json` and `?? .planning/milestone.lock`. These were already in the starting snapshot. Nothing under docs/ or src/ was touched.

## Group verdict
FAIL. The BLOCKER is F1, a changed sentence contradicted by the code. The WARNING is the F2 sentence-length breaches. PASS needs F1 fixed and F2 resolved, with F3 to F6 optional.
