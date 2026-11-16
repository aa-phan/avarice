Verdict: BOUNCE

Severity: a **BLOCKER** cannot ship as written, a **WARNING** needs rework, and an **OBS** is worth noting.

Limits: I had only Read, Grep and Glob. I did not run git, so I could not check the diff against HEAD or compute digests. I checked the changed text against the files in `src/` at the working directory.

**BLOCKER**

1. **Location:** integrations.md, "Staging and run clones", the sentence "A repository with SHA-256 object names is refused at the first read that names a commit."
   **Problem:** This is not true for onboarding. Registration runs `git rev-parse HEAD` and `git ls-tree -r -l -z <pin>` on the 64-digit pin without refusing it (`src/adapters/git/repo-facts.ts:125-133`). It then registers the project and creates the onboarding row with that pin (`src/app/stages/register.ts:59-90`). The refusal comes only later, when preparation validates the pin (`src/adapters/git/staging-base.ts:75`, called from `src/app/stages/workspace.ts:49`). The run side is correct: `src/adapters/git/run-source.ts:42` refuses on the first HEAD read.
   **Fix:** Delete that sentence. The next two sentences already say where each path refuses. If the onboarding sentence stays, say the project and onboarding are already registered when preparation refuses the pin.
   **Confidence:** high.

**WARNING**

2. **Location:** integrations.md, the paragraph after the proxy table: "an IPv4 address inside an IPv6 address is judged as the IPv4 address."
   **Problem:** The claim is broader than the code. `isPublicAddress` judges by the embedded IPv4 address only for IPv4-mapped addresses (`::ffff:0:0/96`) and the NAT64 prefix `64:ff9b::/96` (`src/adapters/exec/allowlist-proxy.ts:97-98`). The deprecated IPv4-compatible form is refused outright (`:99`). 6to4 (`2002::/16`) and Teredo addresses also carry an IPv4 address, but the code treats them as public whatever that address is (`:100-104`). The same wording is in containment.md:367.
   **Fix:** "An IPv4-mapped IPv6 address, or one under the NAT64 prefix `64:ff9b::/96`, is judged by the IPv4 address it carries." Make the same change in containment.md.
   **Confidence:** high.

3. **Location:** integrations.md, the new quirk "A registry that is reachable only on a private network is unsupported…". Also config-reference.md, the `registryHosts` row: "Refused: `localhost`… No spelling of an IP address is therefore accepted." and "The proxy also refuses a name that resolves to a non-public address…".
   **Problem:** This breaks the one-fact-one-place rule. containment.md:449 already states this limit and the conventions refusal: no private-network registry, no IP spelling, no `localhost`, no single-label name. containment.md:367 already states the address check. The fact now lives in three documents, and the IPv6 wording in finding 2 already has to be fixed in two of them.
   **Fix:** Pick one owner. containment.md is the natural one for the limit. Elsewhere, replace the repeated sentences with a link. The config-reference row can keep only the refusal rules for host names.
   **Confidence:** medium.

**OBS**

4. **Location:** integrations.md, proxy table row "Allowlisted target that cannot be reached, or whose name does not resolve | `502`".
   **Problem:** A lookup that succeeds but returns no address is answered 403 and recorded as refused, not 502 (`src/adapters/exec/allowlist-proxy.ts:118`, `:189-191`). With `all: true` this case is rare.
   **Fix:** Leave the row as it is, or add "a name with no address is 403" to the 403 row.
   **Confidence:** medium.

5. **Location:** integrations.md, proxy table, the word "reserved".
   **Problem:** The code blocks `0/8`, `224/4` and above, and `198.18/15` (`allowlist-proxy.ts:80`, `:85`). It lets the documentation ranges through (`192.0.2/24`, `198.51.100/24`, `203.0.113/24`). "Reserved" suggests a fuller list.
   **Fix:** Name the ranges, or write "multicast and the 240/4 block".
   **Confidence:** medium.

6. **Location:** integrations.md, "gh": "…a read-denied credential location (`~/.config/gh`) in the sandbox profiles. The others are listed in [containment.md]."
   **Problem:** "The others" most naturally points back to "three places", so it reads as if `gh` appears in more places than three.
   **Fix:** "The other credential locations are listed in [containment.md](containment.md)."
   **Confidence:** high.

7. **Location:** integrations.md, run source paragraph: "Run start therefore stops with its internal error before it creates any row or file."
   **Problem:** "Its internal error" is vague. The claim itself is verified: `src/app/run-start.ts:198-199` returns `internal` (exit 70) before `createRunWithContract` at `:250`.
   **Fix:** "Run start therefore exits 70 before it creates any row or file."
   **Confidence:** medium.

**Claims verified correct:**
- The proxy refuses a non-public address with 403, recorded as refused. A failed lookup or connect is 502, recorded as allowed. The proxy connects to the checked first address, not the name. All in `allowlist-proxy.ts:108-121`, `:181-211`.
- The `registryHosts` refusals (`src/domain/conventions.ts:236-239`).
- The data root and credential locations denied by GSD verbs and supervisor commands (`src/adapters/gsd/gsd-onboarding.ts:106`, `src/app/checks.ts:121`), and the list in `invocation-scope.ts:387-400`. `HOME` as the base of those locations.
- The 40-digit commit id (`staging-base.ts:24`), the 64-digit pin refused at preparation, and run start's message naming the object format (`run-source.ts:42`).
- Paths split at a slash only (`staging-base.ts:93`, used by `run-workspace.ts:72`), and the parents read back with the trailers (`run-workspace.ts:170-176`).
- An onboarding's resume skips the reap when the host has no reap capability (`src/app/resume.ts:29`). A run's resume stops with the rows unmarked (`src/app/run-resume.ts:83`).

The changed text has no dashes, delivery history, file paths or headings to flag, and no sentence over 35 words.
