Verdict: BOUNCE

Severity: a **BLOCKER** cannot ship, a **WARNING** needs rework, an **OBS** is worth noting.

I could not run git or a shell command. I did not recompute digests and did not diff against a base. I read the diff file and the current files under `src/` and `docs/system/`.

**Verified against the code (no finding):**
- **Proxy table rows and paragraph.** The 403 for a name with no address or any non-public address, the 502 for a lookup error, both recorded as allowed, and the connection to the checked first address. Source: `src/adapters/exec/allowlist-proxy.ts:108-121` and `:181-196`.
- **SHA-256 refusal at run start.** Source: `src/adapters/git/run-source.ts:42`. The refusal maps to internal, exit 70, before anything is created (`src/app/run-start.ts:49`, `:198-199`).
- **Onboarding pin refusal after registration.** The register stage runs before the workspace stage (`src/app/stages/register.ts:59-77`), and the staging clone refuses the pin at `src/adapters/git/staging-base.ts:75`.
- **40-digit commit id.** Source: `src/adapters/git/staging-base.ts:24`.
- **Slash-only path split.** Source: `src/adapters/git/staging-base.ts:87-93`.
- **HEAD parents read back with the trailers.** Source: `src/adapters/git/run-workspace.ts:170-176`.
- **Reap difference.** An onboarding's resume skips the reap (`src/app/resume.ts:29`) and a run's resume stops (`src/app/run-resume.ts:83`).
- **Hosts the conventions refuse.** Source: `src/domain/conventions.ts:231-238`.
- **Credential locations based on the home directory.** Used by the GSD verbs, checks and graphify: `src/domain/invocation-scope.ts:403`, `src/adapters/gsd/gsd-onboarding.ts:106`, `src/app/checks.ts:121`.

**WARNING**
- **Location:** integrations.md, Quirks, sentence "The local registry in the tests reaches the proxy only through a test-only resolver that production never passes."
  - **Problem:** The direction is reversed. In the tests the install reaches the proxy as usual. The test-only resolver replaces name resolution and the address check, so the *proxy* can dial the loopback registry. The code says so at `src/adapters/exec/allowlist-proxy.ts:123-126`: "it replaces resolution and the address check so a test can dial a loopback server".
  - **Fix:** "In the tests, the proxy reaches the local registry only through a test-only resolver that skips the address check; production never passes it."
  - **Confidence:** high.

**OBS**
- **Location:** integrations.md, "Reaping by session ID", sentence "A run's resume stops instead, with every launch row still `started`, because that host may still be running…"
  - **Problem:** "that host" could mean the host adapter named in the previous sentence ("a reap capability on the host"), but the meaning is the launched host process. The sentence also does not say that the stop happens only when a launch row is left `started` (`src/app/run-resume.ts:72-84`).
  - **Fix:** "A run's resume stops instead when a launch row is left `started`, leaving every row `started`, because the launched host may still be running and nothing may read the clone beside it."
  - **Confidence:** medium.
- **Location:** integrations.md, "Staging and run clones" ("Run start refuses such a repository with a message that names the object format.") and "Run source" ("A repository with SHA-256 object names is refused when HEAD is read…").
  - **Problem:** The same run-start refusal is stated twice in one document, which breaks one fact in one place.
  - **Fix:** Keep the full statement in "Run source". In "Staging and run clones", replace the sentence with a link to that section.
  - **Confidence:** medium.
- **Location:** integrations.md, "Run source", "with an invalid error that names the object format".
  - **Problem:** "an invalid error" uses the internal error kind as an adjective and reads as a typo.
  - **Fix:** "with an error that names the object format".
  - **Confidence:** medium.
- **Location:** integrations.md, failure table row "An install that reaches any target the proxy refuses, an address that is not public included".
  - **Problem:** The trailing absolute phrase reads awkwardly.
  - **Fix:** "An install that reaches any target the proxy refuses, including a name that resolves to an address that is not public".
  - **Confidence:** low.
- **Location:** integrations.md (GSD verbs paragraph and gh paragraph) and config-reference.md (HOME row is unlinked; Limits bullet links to "containment.md").
  - **Problem:** The links "listed in [containment.md](containment.md)" point at the top of a long document. The list itself is in the "Generated settings, in effect" section.
  - **Fix:** Link to `containment.md#generated-settings-in-effect`.
  - **Confidence:** medium.
- **Location:** integrations.md, proxy paragraph, "It then connects to the checked address rather than to the name, so the name is resolved once."
  - **Problem:** containment.md's egress proxy section already states this, more precisely ("the first address it checked"). The integrations table and paragraph repeat that section's rules.
  - **Fix:** Either say "the first checked address" to match containment.md, or cut the integrations paragraph down to the integration facts and link to `containment.md#the-egress-proxy`.
  - **Confidence:** low.

The rest of the changed text is accurate, follows the house style (no dashes, sentences within 35 words, no delivery history), and agrees with containment.md, processes.md and runs.md. That includes the registryHosts refusal list and its "no spelling of an IP address" conclusion, the HOME row, the Limits bullet, and the gh paragraph.
