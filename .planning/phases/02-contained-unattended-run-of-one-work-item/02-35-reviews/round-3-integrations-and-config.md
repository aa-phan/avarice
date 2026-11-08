Verdict: PASS

I could not compute a SHA-256 digest of either file because this review had no shell access, so the verdict is not bound to a digest. I also could not run the code or the tests. Everything below comes from reading the source.

Severity: a **BLOCKER** cannot ship, a **WARNING** needs rework, and an **OBS** is worth noting.

**BLOCKER:** none.

**WARNING:** none.

**OBS**

1. **The egress proxy is described in two places** (integrations.md, the paragraph under the proxy response table: "The proxy resolves an allowlisted host name itself, outside the sandbox, and checks every address the name resolves to. It then connects to the first checked address rather than to the name, so the name is resolved once.")
   - Problem: containment.md, section "The egress proxy" (lines 367 to 368), states the same two facts. The two pages can drift apart the next time either one changes.
   - Fix: keep only one clause here, such as "checks and pins the resolved address", and link to [containment.md](containment.md#the-egress-proxy). The table row already links there.
   - Confidence: medium.

2. **The pin refusal reads like a quoted error message** (integrations.md, "Staging and run clones": "Onboarding refuses the 64-digit pin … as not a valid commit id when it prepares the staging clone …")
   - Problem: the actual reason text is "a full lowercase commit SHA is required" (`src/adapters/git/staging-base.ts:75`). "As not a valid commit id" can be taken for the message itself. The sentence also leaves out that the onboarding contract has already stored the 64-digit pin by this point (`src/domain/onboarding-contract.ts:410` does not check it).
   - Fix: write "refuses the 64-digit pin as invalid when it prepares the staging clone, after the project, the onboarding and its contract are recorded."
   - Confidence: medium.

3. **The run-resume sentence names only one cause** (integrations.md, "Reaping by session ID": "A run's resume stops instead when a launch row is left `started` …")
   - Problem: a run's resume also stops when a `started` launch recorded no session ID (`src/app/run-resume.ts:84`). The run-resume diagram shows both causes.
   - Fix: add "or when a started launch recorded no session ID", or link to runs.md for the full rule.
   - Confidence: high.

**Verified against the code**

- **Proxy outcomes** (`src/adapters/exec/allowlist-proxy.ts:108-121` and `181-211`):
  - A name with an address that is not public, or with no address, gets 403 and is recorded as refused.
  - A failed lookup or an unreachable target gets 502 and is recorded as allowed.
  - Every resolved address is checked.
  - The proxy connects to the first address, not to the name.
  - The test-only resolver bypasses the check, and production never passes it (lines 123-126 and 238-241).
- **registryHosts rules** (`src/domain/conventions.ts:222-239`):
  - `localhost` and any name under it are refused.
  - A single-label name is refused.
  - A last label that is all digits or a `0x` form is refused.
  - An IPv6 literal fails the label pattern, so "no spelling of an IP address" holds.
- **Credential locations:**
  - The list is relative to the home directory (`src/domain/invocation-scope.ts:387-406`).
  - It applies to the GSD verbs (`src/adapters/gsd/gsd-onboarding.ts:106`).
  - It applies to checks, install and list commands, together with the data root and the default parent directories (`src/app/checks.ts:121`).
- **SHA-256 refusal and pin format:**
  - The commit-id pattern is 40 lowercase hex digits (`src/adapters/git/staging-base.ts:24`).
  - HEAD of a SHA-256 repository is refused with an error naming the object format (`src/adapters/git/run-source.ts:42`).
  - Run start reads HEAD before it creates anything, and that error exits 70 (`src/app/run-start.ts:49` and `198-199`).
  - Onboarding records the project and the onboarding first (`src/app/stages/register.ts:59-91`) and refuses later, when the staging clone is prepared (`src/app/stages/workspace.ts:49`).
- **Commit paths and trailers** (`src/adapters/git/staging-base.ts:87-96`; `src/adapters/git/run-workspace.ts:68-76` and `168-185`):
  - Paths are split at a slash only.
  - The parents of HEAD are read back together with the trailers.
- **Reaping on resume:**
  - An onboarding's resume skips the reap when the host has no reap capability (`src/app/resume.ts:29`).
  - A run's resume stops in that case (`src/app/run-resume.ts:83`).
- **Links:** the anchors `#generated-settings-in-effect`, `#the-egress-proxy` and `#limits-of-containment` all exist in containment.md, and `#run-source` exists in integrations.md.

**House style:** I found no em dashes, en dashes or double hyphens, no phase or plan IDs, and no file paths in the prose. No changed sentence is over 35 words. The changed text does not contradict containment.md, processes.md, runs.md or findings.md.

The changed passages are accurate and well grounded. In particular, the 403 and 502 split in the proxy table matches the code exactly.
