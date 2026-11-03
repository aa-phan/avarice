---
last_mapped_commit: 41879bed6e93c1c65cce57e3120db26dae739e5c
last_mapped_at: 2026-11-02
---
# Technology Stack

**Analysis Date:** 2026-11-02

## Languages

**Primary:**
- TypeScript (strict mode) - all source and tests: `src/`, `test/`
  - Compiler config: `tsconfig.json` (`target: es2022`, `module: nodenext`, `strict: true`, `include: ["src"]`)
  - Imports use explicit `.ts` extensions (e.g. `src/index.ts` imports `./x.ts`)

**Secondary:**
- POSIX shell - build script: `scripts/build.sh`
- YAML - CI workflow: `.github/workflows/ci.yml`

## Runtime

**Environment:**
- Node.js (implied by `npm` usage and `module: nodenext`); no version pinned
- No `.nvmrc`, `.node-version`, or `engines` field detected

**Package Manager:**
- npm
- Lockfile: present but empty of dependencies - `package-lock.json` (lockfileVersion 3, only the root package entry)

## Frameworks

**Core:**
- None. No application framework (no web server, no ORM, no UI library) detected.

**Testing:**
- None installed. Tests are plain TypeScript scripts that `throw new Error(...)` on failure (see `test/strings.test.ts`, `test/inventory.test.ts`). No test runner config (no jest/vitest/mocha config) detected.

**Build/Dev:**
- `tsc` is implied by `tsconfig.json` but not installed as a dependency
- `scripts/build.sh` - placeholder build step (echoes `building`)

## Key Dependencies

**Critical:**
- None. `package.json` declares no `dependencies` or `devDependencies`.

**Infrastructure:**
- None detected. No `node_modules/` present; `.gitignore` excludes `node_modules` and `.env`.

## Scripts

Defined in `package.json`:
- `build`: `sh scripts/build.sh`

Not defined (but referenced):
- `test` - CI runs `npm test` (`.github/workflows/ci.yml`), but `package.json` has no `test` script, so the CI step will fail as written.

## Configuration

**Environment:**
- No environment variables are read by tracked source files.
- `.env` is git-ignored (`.gitignore`); its presence is not confirmed and its contents were not read.

**Build:**
- `tsconfig.json` - TypeScript compiler options
- `scripts/build.sh` - build entry
- `.github/workflows/ci.yml` - CI on every push (`ubuntu-latest`, `actions/checkout@v4`)

**Planning tooling:**
- `.planning/config.json` - `commit_docs: false`, `text_mode: true`, `intel.enabled: true`, `graphify.enabled: true`

## Platform Requirements

**Development:**
- Node.js and npm; a TypeScript-aware runner or `tsc` for the `.ts` sources and tests (none is declared in `package.json`)

**Production:**
- Not applicable - no deployable artifact or deployment target is configured.

---

*Stack analysis: 2026-11-02*
