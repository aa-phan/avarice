---
last_mapped_commit: 41879bed6e93c1c65cce57e3120db26dae739e5c
last_mapped_at: 2026-11-02
---
# Codebase Structure

**Analysis Date:** 2026-11-02

## Directory Layout

```
staging/                       # repo root
├── .claude/                   # Claude Code config dir (contains tracked `.cc-writes`)
├── .github/workflows/         # CI: ci.yml
├── .planning/                 # GSD planning state (config.json, codebase/ docs)
├── docs/                      # guide.md (placeholder doc)
├── scripts/                   # build.sh (placeholder build step)
├── src/                       # TypeScript sources
│   ├── features/              # 12 feature modules, one directory each
│   │   ├── billing/           # types.ts, handler.ts, index.ts
│   │   ├── catalog/
│   │   ├── checkout/
│   │   ├── inventory/
│   │   ├── invoices/
│   │   ├── notifications/
│   │   ├── orders/
│   │   ├── profiles/
│   │   ├── reports/
│   │   ├── search/
│   │   ├── sessions/
│   │   └── shipping/
│   ├── util/                  # strings.ts
│   ├── index.ts               # root module; computes total
│   ├── x.ts                   # exports x = 1
│   └── y.ts                   # exports y = 2, z = 3
├── test/                      # one *.test.ts per feature, plus strings.test.ts
├── package.json               # name, version, build script only
├── package-lock.json          # empty lockfile (no dependencies)
├── tsconfig.json              # strict TypeScript config, includes src/ only
├── README.md                  # one-line project description
└── .gitignore                 # node_modules, .env
```

## Directory Purposes

**`src/features/<name>/`:**
- Purpose: Domain code, one folder per feature
- Contains: `types.ts` (request interface), `handler.ts` (handler function), `index.ts` (barrel)
- Key files: `src/features/checkout/handler.ts`, `src/features/billing/types.ts`

**`src/util/`:**
- Purpose: Shared pure helpers
- Contains: `strings.ts` (`upper`)
- Key files: `src/util/strings.ts`

**`test/`:**
- Purpose: Assertion scripts; files are flat, not nested
- Contains: `<feature>.test.ts` for each feature folder, plus `strings.test.ts`
- Key files: `test/inventory.test.ts`, `test/strings.test.ts`

**`scripts/`:**
- Purpose: npm script targets
- Contains: `build.sh`

**`docs/`:**
- Purpose: Human documentation
- Contains: `guide.md`

**`.github/workflows/`:**
- Purpose: GitHub Actions
- Contains: `ci.yml`

**`.planning/`:**
- Purpose: GSD workflow state and generated codebase maps
- Contains: `config.json`, `codebase/` (output directory for these documents)
- Committed: No for `.planning/` as a whole at the time of analysis (shown as untracked in git status)

## Key File Locations

**Entry Points:**
- `src/index.ts`: Root module; exports `total`
- `scripts/build.sh`: Build entry (via `npm run build`)
- `.github/workflows/ci.yml`: CI entry

**Configuration:**
- `tsconfig.json`: TypeScript compiler options
- `package.json`: Package metadata and scripts
- `.planning/config.json`: GSD settings
- `.gitignore`: Ignore rules

**Core Logic:**
- `src/features/*/handler.ts`: Feature handlers
- `src/features/*/types.ts`: Feature request types
- `src/util/strings.ts`: Shared string helper

**Testing:**
- `test/*.test.ts`: All tests; no config file or runner

## Naming Conventions

**Files:**
- Lowercase single-word file names: `handler.ts`, `types.ts`, `index.ts`, `strings.ts`
- Test files: `<feature-name>.test.ts` in `test/`
- Feature directories: lowercase plural nouns (`invoices`, `notifications`, `profiles`)

**Directories:**
- Lowercase, single-word, under `src/features/` and `src/util/`

**Identifiers:**
- Handlers: `handle<PascalFeature>` (e.g. `handleCheckout`, `handleBilling`)
- Request types: `<PascalFeature>Request` (e.g. `CheckoutRequest`, `BillingRequest`)
- Constants: lowercase names (`x`, `y`, `z`, `total`)

## Where to Add New Code

**New Feature:**
- Primary code: `src/features/<name>/` with `types.ts`, `handler.ts`, `index.ts` following the same shape
- Tests: `test/<name>.test.ts`, importing from `../src/features/<name>/index.ts`

**New Shared Helper:**
- Implementation: `src/util/<topic>.ts` (follow `src/util/strings.ts`)
- Tests: `test/<topic>.test.ts`

**New Root-Level Module:**
- Implementation: `src/` alongside `index.ts`, with `.ts` extensions on relative imports

**Documentation:**
- `docs/` for guides; `.planning/codebase/` for generated codebase maps

## Special Directories

**`.planning/`:**
- Purpose: GSD planning artifacts
- Generated: Yes (by GSD commands)
- Committed: No, at time of analysis (untracked)

**`.claude/`:**
- Purpose: Claude Code project configuration
- Generated: Partially
- Committed: Yes (`.claude/.cc-writes` is tracked)

**`.git/`:**
- Purpose: Git metadata
- Generated: Yes
- Committed: Not applicable

---

*Structure analysis: 2026-11-02*
