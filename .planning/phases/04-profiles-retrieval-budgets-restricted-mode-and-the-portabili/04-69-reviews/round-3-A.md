VERDICT (round 3, review group A): FAIL. There are 0 BLOCKERs and 2 WARNINGs. The remaining findings are NITs.

Severity terms used here: BLOCKER (hard-rule violation, or a claim the code contradicts in a way that misleads the reader), WARNING (a claim the code only partly supports, or a structural defect), NIT (polish).

## Header: documents and verified digests

All six digests match the dispatch. Reviewed at HEAD 08db6a5, diff base 96a0718.

| Document | sha256 | Match |
|---|---|---|
| docs/system/policy-and-approvals.md | ed2bc30336e554da773ddfedc703be5f1a11b20cebe1c20222c9b490d13bfa7b | yes |
| docs/system/containment.md | 0bdf47a8b35b064e614ad8fe2bc90d336c260a591e83d0a4a069c0e2234b6d16 | yes |
| docs/system/cli-reference.md | 30cd0bba18f5b7f305739bfa1f0378e813e1011679de2096e58a68a7902d66fc | yes |
| docs/system/data-model.md | f1badee031dc5cf7bee8d7db7468c53d5da798fd835df7996d775b686b663cbc | yes |
| docs/system/diagrams/approve-privileged-action.puml | 0f5cfa1268c1d34cce59eaef66dec72e6d3b93deab3aa00ddb29a46a61e4524e | yes |
| docs/system/processes.md | d329315f11e8e047e666d34fcf2952382b2be0371be46d99ed474e0c6890ac51 | yes |

## Findings, most severe first

### W1. WARNING (confidence high). The gate's step list omits the unshowable-values denial and contradicts the paragraph above it.
- Location: docs/system/policy-and-approvals.md:86, "6. With no source, the action is denied with the rule `approval-required:` and the request ID, and the message names the command the owner runs."
- Defect: the list is introduced as "It runs in this order". The gate has a step between 5 and 6 that the list never mentions. Parameters that cannot be shown whole are denied with `privileged:unapprovable` and no request. Step 6 says every sourceless action gets `approval-required:`. That contradicts the Parameters and digest paragraph at line 65. The same fact has two homes, and the ordered list is the incomplete one.
- Evidence:
  - src/app/authorize.ts:159-162 returns `UNAPPROVABLE_RULE` before the pending-request lookup at :164.
  - src/app/authorize.ts:154-157 shows that a contract or an approval already on record still allows the action first.
  - The code comment at src/app/authorize.ts:11-12 states the order.
- Fix: insert a step before step 6. For example: "If the parameters cannot be shown to the owner whole (see Parameters and digest), the action is denied with the rule `privileged:unapprovable` and no request is written." Then make step 6 start "Otherwise".

### W2. WARNING (confidence high). The "cannot be checked" reason texts are stated as if both modes give them, but a run gives the generic shell-syntax text.
- Location: docs/system/policy-and-approvals.md:122 (git alias or config include bullet) and :123 (brace expansion or glob bullet). Quotes: "The reason says the line defines a git alias or a config include, which cannot be checked, and asks for the command it stands for to be run." and "The reason says a brace expansion or a glob decides which command runs and asks for the command written without it."
- Defect: these bullets sit under "Three outcomes", which applies to a run and to an attended session. Only an attended session shows the classifier's reason to the agent. A run converts any unreadable line to `shell-syntax` and gives the fixed shell-syntax reason. The agent in a run is never told about the alias or the brace expansion.
- Evidence:
  - src/domain/hook-decision.ts:820-821: `classified.kind === 'unparseable'` returns `refuse('shell-syntax')`.
  - src/domain/run-shell-rules.ts:35-36: the reason is "one plain command per call, written without ...".
  - Attended: src/hook/pre-tool-use.ts:659 appends the classifier reason in parentheses.
- Fix: scope both sentences, for example "In an attended session the reason says ...; a run denies the line as `shell-syntax` with that rule's own reason." The same scoping applies to the other reasons in the list.

### N1. NIT (confidence medium). "The rule over-refuses in two places" undercounts.
- Location: docs/system/policy-and-approvals.md:125, "The rule over-refuses in two places."
- Defect: the code refuses in more cases than the two named, so the number is wrong.
  - A shell or `su` command with a brace word that begins with `{` or `-` is refused. `bash {a,b}.sh` is refused, while `bash scripts/{a,b}.sh` is not. I ran `classifyLine` read-only to confirm both.
  - The same holds for an `su` or `watch` option word, and for `find` (which the text names).
  - The text also says the words in "the arguments of any other program" are not refused. A shell operand of that form is refused.
- Evidence: src/domain/privileged-commands.ts:1066-1072 and :1081-1085 (`formsOption`, applied to shells and `su`), and :1026-1029.
- Fix: "The rule also over-refuses, for example: ..." and add the shell and `su` case. Or drop the count.

### N2. NIT (confidence medium). "Such a line is refused." is detached from its list.
- Location: docs/system/policy-and-approvals.md:127.
- Defect: after the six-bullet list comes a long paragraph on expansion words. The sentence that states the outcome of "cannot be checked" now sits below that paragraph, and "Such a line" is ambiguous. The conclusion is buried.
- Fix: move "A line that cannot be checked is refused. No limit and no failure to read is taken as 'not privileged'." directly under the "Three outcomes" lead, before the bullets.

### N3. NIT (confidence medium). The same moved-root denial fact has three homes, with no link from containment.md.
- Location: docs/system/containment.md:185 (the corrupt-configuration definition and the whole-root definition) and the "Another profile's roots" bullet in the limits section; docs/system/cli-reference.md:68.
- Defect: the owner is docs/system/profiles-and-credentials.md, "Moved-root denial" and "What stays open". The definition of a corrupt configuration is restated word for word in three documents. containment.md links only `profiles-and-credentials.md#redaction`, not `#roots-and-isolation`. The restatements are accurate today, but they can drift.
- Fix: keep the consequence each document owns (exit 70 in the CLI reference, the sandbox denial in containment) and link to `profiles-and-credentials.md#roots-and-isolation` for the definition of corrupt and unreadable.

### N4. NIT (confidence low). The list of what makes a configuration corrupt is not exhaustive.
- Location: docs/system/containment.md:185, docs/system/profiles-and-credentials.md (Moved-root denial), docs/system/cli-reference.md:68.
- Defect: "(not valid JSON, a refused key, a symbolic link, a file that is not regular, or over the size cap)" reads as the full list. Other `invalid` outcomes also deny the whole root: the file is not a JSON object, the schema is not 1, the `profile` field names another profile, and a root value of the wrong shape.
- Evidence: src/domain/profile.ts:166-182 and :138-143; src/adapters/fs/profile-config.ts:51-65. The registry denies the whole root for any `invalid` error at src/adapters/fs/profile-registry.ts:82.
- Fix: add "or any other refusal by the configuration parser", or say "for example".

### N5. NIT (confidence low). "Record something" is ambiguous in the manual-equivalents section.
- Location: docs/system/policy-and-approvals.md:222, "Three commands record something: `context add`, `evidence add` and `pr record`."
- Defect: `approve` also writes (an approval) and is listed in the same table. The sentence "they need no terminal" is what separates the three from `approve`, but the lead does not say so.
- Fix: "Three commands record manual input: ...".

### N6. NIT (confidence low). Two small term and detail points.
- docs/system/cli-reference.md (approve output) says "shown in full" where policy-and-approvals.md says "shown whole". Use one term.
- docs/system/policy-and-approvals.md:65 says the refusal reason "names the key and its length". For an over-long key the code names "a parameter name", not the key (src/domain/approval.ts:109).

## Checked and not flagged (coverage)

All claims below were checked against the code at HEAD and found correct.

**Numbers and limits**
- Approval display limits: 80 characters per key or value, 400 characters for the entries other than `cwd`, 512 for `cwd` under its own cap, 917 maximum stored summary (400 + " cwd=" + 512, under the 1,024 event-string limit in data-model.md:181), and the 30-minute TTL. See src/domain/approval.ts:8-17, :100-125.
- Refusal cases for a value that cannot be shown whole:
  - The six listed cases (key or value over 80, `cwd` over 512, entries over 400, control character, no canonical form, secret-pattern match with `cwd` included) match `unshowableReason`.
  - Reason text: "a bound value cannot be shown whole (...); the owner can run the command at their own terminal".
- Classifier limits:
  - 65,536 characters (src/domain/privileged-commands.ts:76).
  - 8 nesting levels (:77, :423).
  - 16 prefix words (:582, :717).
  - Backquote nesting of more than 2 (:327).
  - A run's 16,384-character cap, applied after `trim()` (src/domain/hook-decision.ts:140, :816).
- Counts: 7 forms, 6 actions, 20 wrapper names (the doc's 11 + 9 equals the `WRAPPERS` keys), 18 enforcement controls (grep `^    id: '`), and the 40 rule IDs (6 allow, 35 deny, 1 overlap).
- Policy parser: at most 256 rules, 64 KiB, `when` with 1 to 8 names and values of at most 128, `approvalSource` pattern (src/domain/policy.ts:59-69).
- Other constants checked: restricted closure 32 files / 512 KiB, restricted patch 1 MiB, containment finding paths first 10, retrieval caps 20 reads / 262144 bytes, prompt 32 KiB, seven `config-set` values, `PACK_ITEM_FORMAT` 1, schema version 4.

**Classifier behavior**
- Followed forms: wrappers, `coproc`, `command -v`/`-V`, `taskset -p`, shells with `-c` or a here-string (with `-s` or `-`), `eval`, `su -c`/`--command`/`-lc`, `trap` (single operand, `-` and `-p`/`-l` cases), `find -exec` family, `parallel`, `watch -x`/`--exec`, and gh options between group and subcommand.
- I ran `classifyLine` read-only on `gh pr -R o/n create`, `gh release -R o/n create v1`, `git add src/{a,b}.ts`, `mkdir -p src/{a,b}`, `git push origin {main,dev}`, `find {src,test} -type f`, `FOO=* ls` and `git push origin refs/heads/*`. All matched the doc, apart from N1.
- Expansion-word definition: brace group, glob, and the exclusions (`${...}`, `$*`, `$?`, case patterns, `{owner}`).
- Alias and config-include forms: `-c` and `--config-env` keys, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_PARAMETERS` including via an outer assignment.
- Residual list: matches the privileged-commands.ts header and the enforcement-map text, including the `builtin` and npm-option differences recorded in findings.md (cited line numbers 557 and 856 are right).

**Attended and run behavior**
- Which command a run judges: only `commands[0]` (src/domain/hook-decision.ts:823).
- Refusal when a value cannot be shown whole:
  - In a run, no request and one `policy.denied` with the digest and reason (src/hook/pre-tool-use.ts:458-461, :364-385).
  - In an attended session, `privileged:unapprovable` before anything is consumed (:723-731).
- The `cwd` canonicalization, the session-ID pattern, and the four attended outcomes.
- Attended multi-command line: one denial per missing command, with a waiting request named again.
- Events and the gate:
  - `action.started` data, including `approvalId` and "hook only in an attended session" (src/adapters/sqlite/approval-rows.ts:54).
  - The gate's `interrupted-action-open` rule, and that an end with no open start is refused (src/app/authorize.ts:205-216).
- The rule that a policy file sits only in its own slot, and the `invalid` error from the sources builder (policy.ts:227-258).

**Profile roots and CLI**
- What is denied for another profile with a corrupt or unreadable configuration: the profile directory plus the default data and work roots of its name (profile-registry.ts:50-53, :80-85).
- Permission refusals deny the same roots; other read failures return `unavailable` and exit 70 with "cannot read the other profiles of this machine" (composition.ts:313). A profiles directory that cannot be listed also fails the command.
- The `approve` exit-64 additions (approve.ts:84-88, :60-69) and the `context add` refusal inside a run.

**Mechanical sweeps**
- Dash forms: none (em, en, ` -- `) in any added line.
- Sentence cap (35 words, table rows and code fences excluded): the longest added sentences measure 35 with the bullet marker counted and pass. Re-count the two policy-and-approvals.md sentences at the cap if the wording changes.
- No delivery history, plan IDs or threat IDs in the changed prose. File paths appear only in the processes.md source-column table.
- No new headings. Frontmatter is not touched.
- Links: every link in the five markdown documents resolves, file and anchor, by a heading-slug check. This includes `profiles-and-credentials.md#selecting-a-profile`, `#roots-and-isolation`, `runs.md#records-written-by-a-successful-start` and `policy-and-approvals.md#approvals`.

**Bindings lock rule**
- Documented in docs/system/profiles-and-credentials.md, in "The binding registry" paragraph under "Selecting a profile". integrations.md:23, :38 and :387 and profiles-and-credentials.md:120 echo parts of it.
- The data-model.md:13 link `profiles-and-credentials.md#selecting-a-profile` resolves.
- The four takeover cases, the 2-second wait, the 2-second start margin and the 60-second stale age all match src/adapters/fs/profile-bindings.ts:147, :181, :186, :202-209 and :308-358.
- The data-model.md:13 wording "ID and the time the lock was written" matches `LockHolder.startedAt`.

**Diagram**
- The puml branches match the hook and approve.ts.

## Read-only proof
- `git status --short` after the run shows only `.planning/state.json` (modified), `.planning/config.json` and `.planning/milestone.lock` (untracked), all present in the starting snapshot.
- It also shows an untracked `.planning/phases/04-.../04-69-reviews/round-3-B.md`, which is not from this run. It is presumably the parallel group B reviewer's output.
- I edited no repository file. The scratch files I created are outside the repository (`/tmp/rv3`).
