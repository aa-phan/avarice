Verdict: BOUNCE

Severity: **BLOCKER** cannot ship, **WARNING** needs rework, **OBS** worth noting.

Limits of this review: I had Read, Grep and Glob only. I could not run git, so I took the diff file as the change set and did not compute a SHA-256 digest. The verdict applies to the working-tree files as I read them on 2026-11-07. I did not run any tests, so the two new load-sensitive test lines are checked against the cited lines only, not against how the tests behave.

## BLOCKER
None.

## WARNING

**W1. containment.md, Settlement paragraph: "A failure or a kill between them leaves all of them unwritten, and a retry charges each amount once."**
- **Problem:** No code retries a settlement. The settlement is called once (`src/app/invocation.ts:179`), and when it fails the error is returned. After a kill, the reservation stays reserved and the next reservation or resume converts it as an orphan (`src/app/budget.ts:98-126`). That conversion charges the invocation unit and the cost reservation only, not the measured wall clock or the reported cost. The paragraph says this itself a few sentences later ("its wall clock is not charged"), so "each amount once" contradicts it.
- **Fix:** Replace the clause with "and the reservation is later converted as an orphan (below)", or delete it.
- **Confidence:** high.

**W2. containment.md, Settlement paragraph: "An invocation that reported a result is charged its reported cost."**
- **Problem:** `wasKilled` (`src/app/invocation.ts:159`) is true when the host timed out or ended by a signal, whether or not a result was seen. Such an invocation is charged the larger of its reported cost and its reservation (`src/app/budget.ts:209`). This includes a run whose lease was lost, because the abort sets `timedOut` (`src/adapters/host-claude/claude-host.ts:313-318`).
- **Fix:** "An invocation that reported a result and was not killed is charged its reported cost."
- **Confidence:** high.

**W3. containment.md, check order step 5: "Every word that git takes as an operand under the option grammar of rule 13 is judged as an object name. For example `git status -M HEAD:.env` is `deny-secret-read`…"**
- **Problem:** The outcome is right, but the example does not work the way the sentence says. The rule 13 walker refuses at `-M` and returns only the operands it had collected before that point, which is none (`src/domain/hook-decision.ts:649`). `HEAD:.env` reaches the object check through the rule 11 parser instead: `'git status': ''` at `:354`, merged into the operand set at `:705`. A reader who follows the sentence would wrongly conclude that the walker continues past a refused option.
- **Fix:** Name both sources, for example: "Every word that the rule 11 parser or the rule 13 grammar takes as an operand is judged as an object name. For example `git status -M HEAD:.env` is `deny-secret-read`: rule 11 reads no value letter for `git status` (git takes the value of `-M` only attached), so `HEAD:.env` is an operand and is judged before rule 13 refuses `-M`."
- **Confidence:** medium.

## OBS

**O1. containment.md, egress proxy bullet: "multicast and everything above it (`224/4`)".**
- **Problem:** `224/4` covers only 224 to 239. The code refuses every first octet from 224 up (`src/adapters/exec/allowlist-proxy.ts:80`).
- **Fix:** Write "(`224.0.0.0` and above)", or `224/3`.
- **Confidence:** high.

**O2. containment.md, Limits, "Registry resolution and tunnels": "The proxy trusts DNS only to name public addresses".**
- **Problem:** The sentence can be read two ways. It still trusts DNS to choose which public address the tunnel goes to.
- **Fix:** "The proxy still trusts DNS to choose among public addresses, and it does not inspect an allowed tunnel."
- **Confidence:** medium.

**O3. containment.md, Read rules: "is judged on its path part twice. Rule 12 describes the two judgements".**
- **Problem:** Rule 12 talks about "two bases", each of which gets both judgements. "Twice" and "two judgements" next to "two bases" invites the reader to count wrong.
- **Fix:** "is judged on its path part in two ways (rule 12): as written, and after the working copy's symlinks are resolved."
- **Confidence:** low.

**O4. containment.md, the new Quirks bullet about `git show <revision>:<path>` and a stored symlink.**
- **Problem:** It repeats rule 12's "The cost is that…" sentence almost word for word, which breaks the one-fact-in-one-place rule.
- **Fix:** Shorten it to one clause with a pointer to rule 12, or keep it only if the Quirks section is meant to be a deliberate summary.
- **Confidence:** low.

**O5. findings.md, new line `src/app/stages/map.ts:57`.**
- **Problem:** It is true but narrower than the code. The intel and knowledge invocations also pass only a timeout signal (`src/app/stages/index-intel.ts:69`, `src/app/stages/index-knowledge.ts:163`), so a lost onboarding lease ends none of the three.
- **Fix:** Name all three call sites.
- **Confidence:** high.

## Verified against the code

**Git object rules**
- Rule 12's two bases, the match as written, `.` segments dropped and `..` applied to the string, and the climb above `/` giving `outside-read-set`: `src/domain/hook-decision.ts:515-525`, `src/domain/normalized-root.ts:12-24`.
- The resolved check after the match as written, the over-deny for a revision that stores a symlink, and the order of the checks for a git command: `hook-decision.ts:527-541`, `:690-706`.
- The corrective sentences for `shell-git-output` and `shell-git-object`, and the deny reason format: `hook-decision.ts:594-599`, `:751`, `src/hook/pre-tool-use.ts:334`.

**Settlement and the run lease**
- One transaction for a settlement and for an orphan conversion with its warning event: `src/adapters/sqlite/ledger.ts:679-685`.
- A crash is charged its reservation: `invocation.ts:153-160`.
- An orphan's wall clock is not charged: `budget.ts:112-125`.
- The abort signal of a run comes from the run lease, the onboarding signal is a timeout, and an abort ends the process group the same way the wall clock does: `run-service.ts:127-161`, `item.ts:526-532`, `claude-host.ts:311-319`.

**Credentials and check output**
- The list of 12 credential locations and where it is used: `invocation-scope.ts:387-406`, `:291`, `:511-514`, `:542`, `checks.ts:121`, `graphify.ts:92`, `gsd-onboarding.ts:106`. The run-only write denial is also confirmed.
- Check output is redacted before it is stored: `checks.ts:227-228`.

**Egress proxy**
- The IPv6 and NAT64 rules, IPv4-mapped addresses, 403 for a name with no address, 502 recorded as allowed for a name that does not resolve, and the connection to the first checked address: `allowlist-proxy.ts:91-121`, `:181-196`.
- The conventions' host refusals: `src/domain/conventions.ts:237`.

**findings.md**
- New lines: `finish.ts:206` (substring match, against the proposal at `docs/contracts-and-state.md:126`), `supervise.ts:35` (no signal handler anywhere in `src`), `settings.ts:109`, `allowlist-proxy.ts:91`, `run-start.test.ts:23`, `shell-supervisor.test.ts:111`, `claude-host.test.ts:705`.
- `(now at …)` annotations checked, all correct (more than 15, across 11 files):
  - `hook-decision.ts` :238, :260, :267, :656, :790, :820
  - `ledger.ts` :213, :469, :485, :507, :579, :719, :739, :954, :1043, :1197, :1271
  - `budget.ts` :115, :130
  - `checks.ts` :91, :121, :156, :159, :201, :206, :235, :366, :450
  - `item.ts` :573, :629, :644, :657, :837, :866
  - `invocation.ts` :177, :405
  - `invocation-scope.ts:500`
  - `run-workspace.ts` :202, :247, :417
  - `run-source.ts:55`
  - `onboard.ts` :13, :31
  - `graphify.ts` :96, :138
- The removed lines (the proxy address check, unredacted check output, and the symlink object-name line) no longer hold in the code.

**House style and cross-document checks**
- No dashes in prose. The two ` -- ` matches in findings.md are inside code spans.
- No file paths or delivery history in the containment prose outside its opening.
- Every sentence I checked is within 35 words.
- The `#the-egress-proxy` anchor resolves.
- `integrations.md:186-189` and `checks-and-evidence.md:239` agree with the changed text.

The proxy address list is accurate and complete apart from O1, and the new Limits bullet on credentials stored elsewhere is a sound statement of the gap.
