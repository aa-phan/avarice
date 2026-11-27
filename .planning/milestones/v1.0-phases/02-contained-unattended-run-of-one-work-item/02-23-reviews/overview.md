Reviewed: docs/system/overview.md sha256 43fc9049b52d29dd768254481a16afd69e73bd5a199f07ad34fce83a4f324e73 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKS: 3 WARNING findings remain (sentence cap, unsupported "run on every change", "one implementation per port"); 0 BLOCKER.

BLOCKS: 3 WARNING findings remain (sentence cap, unsupported "run on every change", "one implementation per port"); 0 BLOCKER.

Target: docs/system/overview.md, SHA-256 43fc9049b52d29dd768254481a16afd69e73bd5a199f07ad34fce83a4f324e73 (matches dispatch). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.

## Findings

### 1. WARNING (high): sentence over the 35-word cap
Location: line 21, "A source-tree test holds this: only the proxy may import a network module or listen, and only the supervisor spawn may detach a child on purpose, apart from the two adapters that start a process group of their own so that they can kill it as a unit." (48 words, counted).
Fix: split at "and only": one sentence for the network-module/listen rule, one for the detach rule and its two exceptions.
Evidence: test/unit/footprint.test.ts (network and detach scans, SUPERVISOR_SPAWN and groupLeaders exemptions) supports the content; only the length is the defect.

### 2. WARNING (high): "A lint run on every change" is unsupported
Location: line 27, "A lint run on every change enforces the import rule for the inner three."
Evidence: package.json:15 defines only a manual script check:boundaries; there is no CI workflow (no .github), no git hook, and CLAUDE.md and README.md do not mandate running it. test/unit/boundaries.test.ts proves the rules on generated files and does not run the lint over src/. Nothing makes it run on every change.
Fix: "A lint (npm run check:boundaries, run by hand) enforces..." or drop "run on every change"; state who runs it. Also replace "It passes at the pinned commit over 79 files": no commit is named and "pinned commit" is delivery-flavored. Verified: `node scripts/check-boundaries.ts` prints "ok (79 file(s))" at HEAD, so the count is right.
Rules checked against scripts/check-boundaries.ts:7-14 (domain: relative inside dir plus node:crypto, no process access; ports: domain and itself; app: no adapters/cli; dynamic import/require single literal): all stated correctly.

### 3. WARNING (high): "One implementation per port" is false, and the dormant adapter is not stated
Location: line 34, Adapters row, "One implementation per port: ... local clone staging, ...".
Evidence: src/adapters/git/staging-strategy.ts:15-21 selects between CloneStagingWorkspace and WorktreeStagingWorkspace (worktree is dormant; STAGING_STRATEGY = 'clone', line 12); src/adapters/host/unavailable-host.ts is a second agent-host implementation that src/cli/composition.ts:130-135 and :193-196 chooses. House rule: alive, dormant and dead are stated; onboarding.md:117 already states the dormant one.
Fix: "One production implementation per port, plus the refusing host (see below) and a dormant worktree staging adapter ([onboarding.md](onboarding.md))."

### 4. OBS (medium): containment claim in the opening is unlabeled
Location: line 7, "Everything a contained model does happens inside a clone, under a generated permission set, an OS sandbox and a fail-closed hook".
True (src/hook/pre-tool-use.ts:5-7 exit 2 on any problem; composition.ts:137-138 admits the host only when enforcement is 'enforced'), but it does not say which controls prevent, detect or recover, nor route to the owner. Fix: append "[containment.md](containment.md) labels each control as prevention, detection or recovery."

### 5. OBS (low): "Where to read next" omits README.md and coverage.md
Both exist. Optional.

## Verified and deliberately not flagged
- Ten commands: COMMANDS in src/cli/main.ts:11; ten files in src/cli/commands/.
- Bare avarice shell rule and exit 64 (main.ts:54-64; shell.ts:532).
- Eleven ports plus capability descriptor: 12 files in src/ports.
- Run ports optional in AppDeps (deps.ts, run ports block), always composed (composition.ts return).
- Descriptor recording and read-only behavior (composition.ts, readOnly guards; read-only host is UnavailableAgentHost, no probe).
- Overrides never passed by production: bin/avarice.ts calls main(argv) only.
- Proxy: 127.0.0.1 ephemeral port, CONNECT to exact host:port (allowlist-proxy.ts:1-5, 45-50, 89-95, 115); port 443 per registry host (src/app/checks.ts:355); registry-only install (checks.ts:333-335).
- Hand-off: refs/heads/avarice/<runId> create-only, nothing else (src/adapters/git/run-workspace.ts:9-10, 392, 412).
- install-host writes one skill file (src/adapters/host-claude/skill-install.ts:2).
- Hook imports adapters and opens ledger directly (src/hook/pre-tool-use.ts:12-19); lint scope is domain, ports, app only.
- Supervisor spawn in src/cli/spawn-supervisor.ts (detached, stdio ignore, unref); no child_process import under src/app.
- External tools in the boundary table all present: sandbox-exec, pgrep, ps, mount, git.
- Hook matcher covers every tool (src/adapters/host-claude/settings.ts:129 '.*').
- Anchor containment.md#the-pretooluse-hook resolves (containment.md:180); all link targets exist.
- Mechanical: no em/en dashes or " -- "; headings sentence case; no changelog or last-updated field; no secrets, absolute home paths or transcript text; no embedded instructions; quirks section present; opening names the three modules once; no function names or line numbers in prose. Only line 21 exceeds 35 words (lines 7 and 41 are 32).
- Not flagged: the status banner (matches other drafted documents); findings.md/unknowns.md not applicable.

## Digest reviewed
43fc9049b52d29dd768254481a16afd69e73bd5a199f07ad34fce83a4f324e73

## git status --porcelain
?? .planning/config.json
?? .planning/milestone.lock
(both untracked before the run; no tracked file touched)

## Answers

Applied: findings 1 to 4 (the long sentence is split; the lint is described as run by hand, with the npm script named; the adapters row names the refusing host and the dormant worktree staging adapter; the opening routes to containment.md for the control labels). OBS 5 (README.md and coverage.md in "Where to read next") is left as is: the section routes to the subject documents, and the index is the README itself.
