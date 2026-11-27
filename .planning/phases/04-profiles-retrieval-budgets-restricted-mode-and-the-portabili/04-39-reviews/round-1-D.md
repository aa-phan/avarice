# Round 1, group D: cli-reference.md, config-reference.md, interactive-shell.md

Reviewed at HEAD 8c6eaa7. SHA-256 of the reviewed files:

- docs/system/cli-reference.md 31aad86b759f5f9ac661d964ccb7a327edab8a79ee8515d1f8eaa0fc2c31685e
- docs/system/config-reference.md fc1411d0a48cd9efbd7ca586319c58d75160bac4fe6f62609103510093ae0b9b
- docs/system/interactive-shell.md 324b86ff610ab1b2a13ac0be9cae00f5d347564dc365bddccf4a73a6acc8fcd8

Severity: BLOCKER = a claim the code contradicts or a hard-rule violation; WARNING = quoted text that differs from the code, an incomplete claim, or a style-rule breach that needs rework; NIT = polish.

Result: 2 BLOCKER, 4 WARNING, 4 NIT. Most severe first.

## BLOCKER

### B1. config-reference.md says the config home is placement-checked; the code and cli-reference.md say it is not

- Document and location: config-reference.md, `AVARICE_CONFIG_HOME` row (line 20), and the rows for `AVARICE_DATA_ROOT` (line 23, "The same placement rules as the config home apply") and `AVARICE_WORK_ROOT` (line 24, "Same placement rules as the config home").
- Claim: "It must not sit under any `~/.claude*` directory or under the real path of `CLAUDE_CONFIG_DIR`, and must not nest with the other roots; otherwise every command that opens the profile refuses."
- Evidence: `checkRoots` in src/domain/root-rules.ts takes only `dataRoot` and `workRoot` (RootInputs, lines 12-17; checkRoots, lines 70-86). Its single call site, src/adapters/fs/profile-paths.ts:103-108, passes those two roots and never the config home. The only handling of the config home is that `mkdirSync` creates it with mode 0700 (profile-paths.ts:123-125). cli-reference.md:65 states the opposite and is the correct one: "Placement is judged for the data root and the work root only; the config home is not checked."
- Confidence: high.
- Fix: in line 20 drop the placement sentence for the config home, for example "Created with mode 0700 when absent. Unlike the data and work roots, its placement is not checked." In lines 23 and 24 replace "the same placement rules as the config home" with a pointer to profiles-and-credentials.md#roots-and-isolation, and state the rules once: not under a `~/.claude*` directory or `CLAUDE_CONFIG_DIR`, not containing the home or Claude configuration directory, the two roots not nested, the data root on local storage.

### B2. The order of the start checks is wrong in two places

- Document and location: cli-reference.md line 223, and config-reference.md line 340 (Run limits, "Start refusal order").
- Claim (cli-reference.md:223): after the project, active record, record compatibility and restricted-record checks come "the profile's `retrieval` and `limits` sections, the number of runs that have not ended, the repository preflight, and the contract compile". Claim (config-reference.md:340): "`record-incompatible`, `restricted-record` and `active-runs` are judged before them" (before `revision-mismatch`, `not-descendant`, `stale-commits`, `stale-age`, `no-conventions`, `no-planning`).
- Evidence: src/app/run-start.ts, function `startRun`. The order is: policy (195), GSD admitted (200-214), brief read and parse (219-224), project (226-227), active record (231), record compatibility (236), restricted record (239-245), repository facts, the six preflight rules and `conventions-invalid` (247-284), retrieval section (287-288), limits section and `active-runs` (293-303), contract compile (306 on). `active-runs` is judged after the preflight rules, not before, and the `retrieval` and `limits` reads also come after the preflight.
- Confidence: high.
- Fix: cli-reference.md:223 should read "... whether a restricted record needs a restricted run, the repository preflight, the profile's `retrieval` and `limits` sections, the number of runs that have not ended, and the contract compile with its static checks." config-reference.md:340 should say `record-incompatible` and `restricted-record` are judged before the six preflight rules and `active-runs` after them. Better, keep the order only in cli-reference.md and make the config-reference row a link.

## WARNING

### W1. The enterprise-remote refusal message is quoted wrongly

- Document and location: cli-reference.md:82 (Profile selection table, second row).
- Claim: `refused: the repository's remote belongs to <profile>, not <chosen>; run it under <profile>`.
- Evidence: src/cli/main.ts:156 prints `refused: the repository's remote belongs to ${enterprise}, not to ${selected.value}; run it under ${enterprise} (--profile ${enterprise})`. The document drops "to" and the trailing `(--profile <profile>)`. The first row (line 81) matches main.ts:148.
- Confidence: high.
- Fix: quote the message as printed: `refused: the repository's remote belongs to <profile>, not to <chosen>; run it under <profile> (--profile <profile>)`.

### W2. "The name must be one of the seven below" omits the retrieval names a start accepts

- Document and location: config-reference.md:294 (routine preset budgets).
- Claim: "The name must be one of the seven below, and the number must be finite and above 0".
- Evidence: src/domain/run-contract.ts:282-294 and 366-380 accept the seven names of BUDGET_OVERRIDE_NAMES and also `retrieval.searches`, `retrieval.fullReads` and `retrieval.fullReadBytes` (RETRIEVAL_OVERRIDE_NAMES), which must be integers above 0 and not above their ceilings. The document lists those three names itself at line 274, and cli-reference.md:218 lists them, so the sentence contradicts its own document.
- Confidence: high.
- Fix: "The name must be one of the seven below or one of the three retrieval names (`retrieval.searches`, `retrieval.fullReads`, `retrieval.fullReadBytes`; see The `retrieval` section)."

### W3. Sentences over the 35-word hard cap in running prose

- Counts are words after stripping markup, with code fences, table rows and headings excluded. Exit-code enumerations that start with "Exit:" (cli-reference.md lines 318, 471, 508, 553, 595, 672, 828) and the side-effect lists (298, 555) are reference lists and are not flagged.
  - cli-reference.md: :3 (37), :48 (42), :69 (61), :120 (37), :154 (82, one bullet), :168 (47), :181 (47), :201 (38), :203 (40), :223 (68), :245 (51), :296 (38), :337 (41), :480 (43), :489 (37, 54 and 47 words in three sentences), :547 (44).
  - config-reference.md: :41 (70 and 49), :94 (36), :121 (36), :138 (44), :408 (57), :410 (47), :459 (41).
  - interactive-shell.md: none found.
- Rule: style.md sets an average near 20 words and a hard maximum of 35.
- Confidence: medium on the exact counts (my splitter keeps code spans whole), high that the listed sentences are over the cap.
- Fix: split each at its colon or semicolon. The worst are cli-reference.md:69, :154 and :223 (turn the enumerations into bullet lists) and config-reference.md:41.

### W4. Delivery history in prose

- Document and location: interactive-shell.md:105 (Line editing and completion).
- Claim: "Only the twenty command names are offered (the fifteen of the first release and `approve`, `doctor`, `evidence`, `pr` and `comment`)".
- Evidence: the CLAUDE.md house rule and the core skill's hard rule bar delivery history in `docs/system/` prose. src/cli/main.ts:20 holds the twenty names in one array; no "first release" exists in the code. The count 15 + 5 = 20 is correct.
- Confidence: high that it is delivery narrative.
- Fix: delete the parenthesis: "Only the twenty command names are offered, never flags, subcommands or IDs."

## NIT

### N1. Antithesis construction

- config-reference.md:408: "Lowering `costUsdPerInvocation` therefore shrinks the corpus; it is not only a ceiling on spend." Banned "not X but Y" form. Fix: "Lowering `costUsdPerInvocation` shrinks the corpus as well as capping spend." Confidence: medium.

### N2. Same constant stated in several places inside config-reference.md

- The lease time-to-live (180000 ms, `AVARICE_LEASE_TTL_MS`) is in the variable row (line 28), the Run limits table (line 349) and the Timeouts table (line 430). The wait margins are in lines 276-279, 348 and 351. The flag table at lines 263-284 repeats defaults that cli-reference.md owns, and the section itself says "The full flag contract is in cli-reference.md". One fact, one home: keep each value once and link the rest. Confidence: high.

### N3. Test-only variable list is partial and not labelled so

- config-reference.md:41 names `AVARICE_PHASE4_CEILING_USD`, `AVARICE_PHASE4_LEDGER` and `AVARICE_PHASE4_PLAN`, but test and script sources also read `AVARICE_PHASE2_*`, `AVARICE_PHASE3_*`, `AVARICE_LIVE*`, `AVARICE_TEST_HOLD`, `AVARICE_TEST_EXIT_LOG`, `AVARICE_TEST_OUTER_SANDBOX` and `AVARICE_TEST_ANCESTRY` (grep over test/ and scripts/). The paragraph reads as the full set. "Nothing in the shipped source references any of them" is correct. Fix: say "Examples of test-only variables" or point to the test README, and reconsider whether variable names that carry phase numbers belong in a reference of what the CLI reads. Confidence: medium.

### N4. Width wording

- cli-reference.md:96 says the width is "100 when stdout is not a terminal". src/cli/render/table.ts:72-74 also yields 100 when a terminal reports no column count. interactive-shell.md states the broader rule ("or 100 when it reports none"). Fix: "or 100 when stdout reports none". Confidence: high, trivial.

## Checked and not flagged

- Mechanical sweep: no em dash, en dash or ` -- ` in any of the three files. Headings are sentence case with no question forms. All relative links and anchors in the three files resolve (script check of every link target and anchor against the target headings). No file path, function name, phase number, plan ID or threat ID in the prose outside the opening paragraphs; the openings name modules once, as CLAUDE.md requires. No ticket keys, SHAs or changelog sections.
- cli-reference.md, verified against code: the twenty command names and the dispatch table (src/cli/main.ts:20-107); the parser rules, boolean flags per command and the three repeatable flags (src/cli/args.ts, each command's `booleanFlags`); every usage check and which commands have one; exit codes of every command; error and output strings for start, resume, cancel, approve, digest, schedule, evidence, pr, comment and doctor; the profile gate and its exit 3 versus 70 split (src/cli/profile-gate.ts); the thirteen start refusal codes and their messages; wait polling (250 ms for start, resume and decide; 200 ms for cancel), the 24-hour bound, the 15-minute margin and the 60-second cancel lease; schema version 4 (four migrations); `context --budget` rules; manual input limits (16000 bytes, 2 MiB, 200 and 500 characters); the attended hook (matcher `Bash`, 5-second timeout, `onFailure: block`, 1 MiB settings cap, 256 KiB skill cap); the skill front matter; status and inbox JSON field lists against RunStatus and ProjectStatus; control-character stripping and the invisible set; money, width and table rules.
- config-reference.md, verified against code: the eleven `AVARICE_*` variables read and the eight constants; the 14-key closed profile config set and the four keys AVARICE writes; the six `limits` defaults and the `maxConcurrentChecks` cap of 2; the nine retrieval caps and the lower-only rule; the notify keys, defaults, limits and refusal behavior; the 64 KiB profile config cap; the routine preset budget numbers; lease TTL parsing; which sections stop which commands (composition.ts:315-352); `NO_COLOR` and `TERM` handling; `AVARICE_DEBUG_TRANSCRIPTS=1`.
- interactive-shell.md, verified against src/cli/shell/ and src/cli/main.ts: the open condition and the exit 64 path; both refusal messages; the eight menu items and their keys; every prompt string; list and "no match" strings; watch contents (four checkpoints, six events, four scalar entries, 28 characters), the one-second poll and the stop states; the line editor keys and completion rules; history file name, mode, 1000-line cap, redaction and failure behavior; the home view layout; the personal-local profile of the shell's own reads; the `exit N` and `running ... ...` display; the quirks.
- Not checked in depth: the retrieval selection algorithm in cli-reference.md:489, the human-view line formats of `status` beyond the field lists, and the `.avarice/config.json` reader tables in config-reference.md (they belong to modules outside this review group). The sandbox, proxy, admitted-version and onboarding-preset tables were read for internal consistency only.

Verdict: FAIL
