---
last_mapped_commit: 41879bed6e93c1c65cce57e3120db26dae739e5c
last_mapped_at: 2026-11-02
---
<!-- refreshed: 2026-11-02 -->

# Architecture

**Analysis Date:** 2026-11-02

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 Entry module (`src/index.ts`)                │
│              computes `total = x + y`                        │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
               ▼                              ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│ Constants (`src/x.ts`,   │    │ Shared util (`src/util/`)  │
│ `src/y.ts`)              │    │ `strings.ts` → `upper()`   │
└──────────────────────────┘    └────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│        Feature modules (`src/features/<name>/`), 12 total    │
│   each: `types.ts` → `handler.ts` → `index.ts` (barrel)      │
└─────────────────────────────────────────────────────────────┘
               ▲
               │ imported by
┌─────────────────────────────────────────────────────────────┐
│        Tests (`test/*.test.ts`), one per feature + util      │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Entry module | Composes exported constants into `total` | `src/index.ts` |
| Constants | Exports numeric values `x`, `y`, `z` | `src/x.ts`, `src/y.ts` |
| String util | Shared `upper(s)` helper | `src/util/strings.ts` |
| Feature modules | Per-domain request types and handlers | `src/features/*/` |
| Feature barrel | Public surface of each feature (re-exports handler and types) | `src/features/*/index.ts` |
| Feature types | Request interfaces, e.g. `BillingRequest { id: string }` | `src/features/*/types.ts` |
| Feature handlers | Map a request to a string result | `src/features/*/handler.ts` |
| Tests | Assertion scripts per feature and util | `test/*.test.ts` |

## Pattern Overview

**Overall:** Flat, feature-sliced TypeScript modules with no runtime framework and no layering beyond the feature triple.

**Key Characteristics:**
- No application entry point that runs a process: `src/index.ts` only evaluates a module-level constant.
- Each feature is self-contained with the same three-file shape: `types.ts`, `handler.ts`, `index.ts`.
- Feature handlers are pure functions over an input object; no I/O, state, or side effects were found.
- Modules import each other via explicit `.ts` paths and `import type` for type-only dependencies.

## Layers

**Feature Layer:**
- Purpose: Domain-specific request types and handlers
- Location: `src/features/`
- Contains: 12 feature directories - `billing`, `catalog`, `checkout`, `inventory`, `invoices`, `notifications`, `orders`, `profiles`, `reports`, `search`, `sessions`, `shipping`
- Depends on: Its own `types.ts`; no cross-feature imports were found in the files read
- Used by: `test/` (directly, via `../src/features/<name>/index.ts`)

**Utility Layer:**
- Purpose: Shared pure helpers
- Location: `src/util/`
- Contains: `strings.ts`
- Depends on: Nothing
- Used by: `test/strings.test.ts`; no feature imports were found

**Root Module Layer:**
- Purpose: Top-level composition
- Location: `src/index.ts`, `src/x.ts`, `src/y.ts`
- Contains: Exported numeric constants and `total`
- Depends on: `./x.ts`, `./y.ts`
- Used by: Nothing detected

## Data Flow

### Primary Request Path

Not applicable as a service. The only executable data flow is test-driven:

1. A test imports a feature barrel, e.g. `test/inventory.test.ts` imports `src/features/inventory/index.ts`
2. The barrel re-exports the handler from `src/features/inventory/handler.ts`
3. The handler transforms the request object and returns a string (e.g. `id.toUpperCase()`)
4. The test throws if the result is unexpected

### Module Composition Flow

1. `src/x.ts` exports `x = 1`; `src/y.ts` exports `y = 2` and `z = 3`
2. `src/index.ts` imports `x` and `y` and exports `total = x + y` (3)

**State Management:**
- None. No mutable module-level state was found.

## Key Abstractions

**Feature triple (`types.ts` / `handler.ts` / `index.ts`):**
- Purpose: Standard unit of domain code
- Examples: `src/features/checkout/`, `src/features/billing/`, `src/features/inventory/`
- Pattern: Barrel re-export. `index.ts` exports the handler and types only, e.g. `export { handleCheckout } from './handler.ts'; export type { CheckoutRequest } from './types.ts';`

**Request types:**
- Purpose: Input shape per feature
- Examples: `src/features/billing/types.ts` (`BillingRequest`), `src/features/checkout/types.ts` (`CheckoutRequest`)
- Pattern: Plain exported `interface` with an `id: string` field

## Entry Points

**Module entry:**
- Location: `src/index.ts`
- Triggers: Imported or compiled by `tsc`; no runtime bootstrap
- Responsibilities: Computes and exports `total`

**Feature entry points:**
- Location: `src/features/<name>/index.ts`
- Triggers: Imported by tests and, prospectively, by callers
- Responsibilities: Expose the feature's handler and types

**Build entry:**
- Location: `scripts/build.sh` (via `npm run build`)
- Triggers: `npm run build`
- Responsibilities: Prints `building`; does not compile

**CI entry:**
- Location: `.github/workflows/ci.yml`
- Triggers: Any push
- Responsibilities: Runs `npm test` (no matching script defined)

## Architectural Constraints

- **Threading:** Not applicable; no concurrency primitives or workers.
- **Global state:** None detected.
- **Circular imports:** None detected in the files read.
- **Module system:** `module: nodenext` requires explicit file extensions on relative imports; keep the `.ts` suffix when adding imports.
- **Scope:** Only `src/features/checkout/`, `src/features/billing/`, `src/features/inventory/`, and root/util files were read in full; other feature handlers were inferred from identical file layout and the inventory test.

## Anti-Patterns

### Test scripts without a runner

**What happens:** Tests are top-level scripts that throw on failure (`test/strings.test.ts`), and `npm test` is called from CI with no test script or runner installed.
**Why it's wrong:** CI cannot pass as configured, and failures are not reported as test results.
**Do this instead:** Add a `test` script and runner to `package.json` (for example, a test runner that discovers `test/*.test.ts`) before relying on CI.

### Placeholder build script

**What happens:** `scripts/build.sh` only echoes `building`.
**Why it's wrong:** `npm run build` reports success without compiling `src/`.
**Do this instead:** Invoke `tsc -p tsconfig.json` (after adding TypeScript as a dev dependency) from the build script.

## Error Handling

**Strategy:** Not established. Handlers do not validate input or catch errors; tests use `throw new Error(...)` as their only failure signal.

**Patterns:**
- Direct `throw new Error('<label>')` in test assertions

## Cross-Cutting Concerns

**Logging:** None.
**Validation:** None; request types are compile-time only.
**Authentication:** None.

---

*Architecture analysis: 2026-11-02*
