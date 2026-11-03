# Testing Patterns

**Analysis Date:** 2026-11-03

## Test Framework

**Runner:**
- Vitest `^5.0.3` for unit tests (`vitest` in `package.json`).
- Config: `vitest.config.ts`. Environment is `jsdom`, `restoreMocks: true`, and the include glob is `tests/unit/**/*.test.{ts,tsx}`.
- Setup file: `tests/setup.ts`, which runs `cleanup()` from Testing Library after each test and stubs `window.matchMedia`.
- Playwright `~1.64.0` for end-to-end tests.
- Config: `playwright.config.ts`. Test directory is `tests/e2e`.

**Assertion Library:**
- Vitest's built-in `expect` (Jest-compatible matchers, including `toHaveLength`, `toContain`, `toMatch`, `toBe`, `toEqual`).
- Playwright's `expect` with web-first matchers (`toHaveAttribute`, `toHaveCount`) and `expect.poll` for values that change over time.
- Testing Library matchers come from the DOM package; `@testing-library/dom` is installed as a peer.

**Run Commands:**
```bash
npm test                                   # vitest run: all unit tests once
npx vitest run tests/unit/theme.test.ts    # one unit file
npx vitest run -t "keeps every toggle"     # tests whose name matches
npm run test:e2e                           # build, then playwright test (chromium and mobile)
npx playwright test tests/e2e/theme.spec.ts  # one e2e spec against the running preview
npm run verify                             # typecheck, lint, format, unit tests, all check:* gates, build, meta, budget, images
```

- There is no watch script defined. Run `npx vitest` (without `run`) for watch mode.
- There is no coverage script and no coverage config.

## Test File Organization

**Location:**
- Unit tests are in `tests/unit/`, separate from source. They import through the `@/` alias, for example `import { useTheme } from '@/hooks/useTheme'`.
- Fixtures used by the lint-boundary tests are in `tests/fixtures/` (`tests/fixtures/sections/Imports.tsx`, `tests/fixtures/anim/Imports.tsx`, `tests/fixtures/app/Page.tsx`).
- Playwright specs are in `tests/e2e/`, with phone-specific specs in `tests/e2e/mobile/`.
- The e2e global setup is `tests/e2e/global-setup.ts`.
- Build-gate scripts are tested in `tests/unit/gates.test.ts`, which runs each `scripts/*.mjs` as a child process.

**Naming:**
- Unit file names are kebab-case and name the unit or behavior: `use-theme.test.tsx`, `motion-preference.test.tsx`, `active-section.test.ts`, `swipe-step.test.ts`, `content-inventory.test.ts`.
- `.test.tsx` when the test renders JSX, `.test.ts` otherwise.
- E2E files are `<feature>.spec.ts`: `theme.spec.ts`, `project-dialog.spec.ts`, `focus-ring.spec.ts`, `geometry.spec.ts`.

**Structure:**
```
tests/
├── setup.ts                 # jsdom setup: matchMedia stub and cleanup
├── unit/                    # vitest, jsdom
│   ├── *.test.ts            # pure logic, content, scripts
│   └── *.test.tsx           # rendered components and hooks
├── fixtures/                # source files that lint rules are run against
│   ├── anim/Imports.tsx
│   ├── app/Page.tsx
│   ├── motion-primitives/Ok.tsx
│   └── sections/Imports.tsx
└── e2e/                     # playwright
    ├── global-setup.ts
    ├── *.spec.ts            # chromium project
    └── mobile/*.spec.ts     # mobile project (Pixel 7)
```

## Test Structure

**Suite Organization:**
Top-level `describe` names the unit under test. Nested `it` names are full sentences that state the behavior. Example from `tests/unit/use-theme.test.tsx`:
```tsx
import { act, render, renderHook, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useTheme } from '@/hooks/useTheme'

beforeEach(() => {
  document.documentElement.setAttribute('data-theme', 'light')
  localStorage.clear()
})

describe('useTheme', () => {
  it('reads html[data-theme] and toggles it', async () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    await act(async () => result.current.toggle())
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})
```

Example from `tests/unit/sections.test.tsx` shows the section-level pattern: the test names the DOM contract (`'is labelled by an h2 named Experience'`) and queries by role.

**Patterns:**
- Setup: `beforeEach` resets global state (`document.documentElement.setAttribute('data-theme', 'light')`, `localStorage.clear()`).
- Teardown: `afterEach` from Vitest for temp directories and stubs. Testing Library cleanup is automatic through `tests/setup.ts`.
- Assertions: prefer queries by role and accessible name: `screen.getByRole('heading', { level: 2, name: 'Experience' })`, `screen.getAllByRole('button', { name: 'Dark theme' })`.
- Use `container.querySelectorAll(...)` only when the contract is structural, such as the count of `<details>` rows or the `picture source` elements.
- Each `it` tests one behavior. Several related checks may share a `describe` and a fixture array.
- Table-driven cases use `it.each` with a `[name, value]` tuple so each row has a readable title (`tests/unit/gates.test.ts`, `tests/unit/content.test.ts`).

**E2E patterns (Playwright):**
```ts
import { expect, test } from '@playwright/test'

test('theme: toggle switches to dark and the choice survives reload', async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: 'light' })
  const page = await context.newPage()
  await page.goto('./')

  const toggle = page.getByRole('button', { name: 'Dark theme' })
  await expect(toggle).toHaveCount(1)
  await toggle.click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await context.close()
})
```
- Navigate with `page.goto('./')`. The config forces a trailing slash on the base URL, so relative navigation works for both `/` and a project-page base.
- Create contexts with `browser.newContext({ colorScheme, reducedMotion, viewport })` when a test depends on system settings. Close the context at the end of the test.
- Loop over viewports or schemes with a `for` loop around `test(...)` (`tests/e2e/theme.spec.ts`).
- Use `page.emulateMedia({ colorScheme })` to change the OS scheme mid-test and `expect.poll(...)` to wait for asynchronous results.
- Use `page.route('**/assets/*.js', (route) => route.abort())` to prove that a behavior works before app JavaScript runs (no-flash theme test).
- Collect `pageerror` events into an array and assert it is empty to catch runtime exceptions.
- Prefer `page.waitForLoadState('networkidle')` for lazily mounted content.

## Mocking

**Framework:** Vitest's built-in mocking (`vi`), plus a hand-written `matchMedia` stub in `tests/setup.ts`.

**Global browser stub (`tests/setup.ts`):**
- `window.matchMedia` is replaced with a stub that stores results per query in a `Map`.
- Tests change a media query with `setMediaQuery(query, matches)`, which also notifies registered `change` listeners.
- State is cleared after each test (`results.clear()`, `listeners.clear()`), so no query leaks between tests. `restoreMocks: true` in `vitest.config.ts` restores any `vi.spyOn` mocks as well.

Example usage:
```ts
import { setMediaQuery } from '../setup'

setMediaQuery('(prefers-reduced-motion: reduce)', true)
```
Check `tests/unit/motion-preference.test.tsx` and `tests/unit/fine-pointer.test.tsx` for the exact import style used in the repo before you copy it.

**Vitest mocks:**
- `vi` is imported from `vitest` when used (`import { ..., vi } from 'vitest'` in `tests/unit/sections.test.tsx`).
- Callbacks passed as props are replaced with plain functions, not `vi.fn()`, when only the default behavior is needed. The section test uses `const rail = { getSleeve: () => null, revealSleeve: () => {} }` for this.

**Playwright mocking:**
- Abort or route requests with `page.route`. Emulate system settings with `browser.newContext` options or `page.emulateMedia`.
- Block browser storage by defining `window.localStorage` as a throwing getter in `context.addInitScript` (`tests/e2e/theme.spec.ts`).

**What to Mock:**
- Browser APIs that jsdom lacks or implements incorrectly: `matchMedia` (done globally), `document.hidden` and `visibilitychange` (set with `Object.defineProperty` in `tests/e2e/theme.spec.ts`).
- Storage failures and system preferences, through the helpers above.

**What NOT to Mock:**
- React rendering and hooks. Use `renderHook` and `render` from `@testing-library/react`.
- The content model. Tests import the real `siteContent` from `@/content` (`tests/unit/content.test.ts`, `tests/unit/sections.test.tsx`).
- The lint and build gates. `tests/unit/boundaries.test.ts` runs the real `oxlint` binary on fixtures through `node_modules/.bin/oxlint`, and `tests/unit/gates.test.ts` runs the real scripts with `spawnSync(process.execPath, [...])`.
- The file system in gate tests. They write real files to a temp root and point the script at it with `--root`.

## Fixtures and Factories

**Test Data:**
- Content fixtures are the real content module, not copies. `siteContent.experience`, `siteContent.projects` and `siteContent.contacts` are passed directly to components.
- For a variant of real data, spread it and override one field: `const entry = { ...siteContent.experience[0], monogram: undefined }` in `tests/unit/sections.test.tsx`.
- Synthetic timelines for the settle-trace analyzer are plain objects built with two helpers in `tests/unit/gates.test.ts`:
  ```ts
  function stillFrames(end: number, step: number, overrides: TraceFrame[] = []): TraceFrame[] { ... }
  function writeTimeline(root: string, runs: TraceRun[]): string { ... }
  ```
- Binary fixtures (PDFs, PNGs) are built inside the test. `makePdf()` in `tests/unit/gates.test.ts` assembles a valid one-page PDF with a computed xref table, and `pdfWithStream()` compresses a content stream with `zlib`.

**Sensitive probe strings:**
- Strings that look like phone numbers are never committed as literals. They are assembled at runtime with `[area, exchange].join(' ')` or `groups(sep, ...parts)`, so the repository and its check output do not contain them. Follow this pattern for any test that probes a forbidden shape.

**Temp directories:**
- Create with `mkdtempSync(path.join(os.tmpdir(), 'gates-'))` and push the path onto a `tempRoots` array.
- Remove everything in an `afterEach` with `rmSync(dir, { recursive: true, force: true })` (`tests/unit/gates.test.ts`).

**Location:**
- Static fixtures that the lint rules analyze live in `tests/fixtures/`.
- Generated fixtures (temp projects, PDFs, timelines) are created inside the test and never committed.

## Coverage

**Requirements:** None enforced. No coverage threshold is set in `vitest.config.ts` and no coverage script exists in `package.json`.

**View Coverage:**
```bash
npx vitest run --coverage   # requires installing @vitest/coverage-v8, which is not a dependency today
```

**Gates that stand in for coverage:** `npm run verify` runs a set of checks that behave like contract tests on the built output: `check:colors`, `check:contrast`, `check:case`, `check:meta`, `check:budget`, `check:no-phone`, `check:images`. The contrast check reads pairs from `scripts/contrast-pairs.json`.

## Test Types

**Unit Tests (`tests/unit/`):**
- Pure functions and hooks (`tests/unit/theme.test.ts`, `tests/unit/dates.test.ts`, `tests/unit/swipe-step.test.ts`, `tests/unit/rail-keys.test.ts`).
- Rendered components with Testing Library (`tests/unit/layout.test.tsx`, `tests/unit/sections.test.tsx`, `tests/unit/press-squish.test.tsx`).
- Design tokens and styles (`tests/unit/tokens.test.ts`, `tests/unit/theme-script.test.ts`).
- Content rules (`tests/unit/content.test.ts`, `tests/unit/content-inventory.test.ts`, `tests/unit/copy.test.ts`).
- Lint boundaries (`tests/unit/boundaries.test.ts`) and build-gate scripts (`tests/unit/gates.test.ts`).

**Integration Tests:**
- Not a separate layer. Components are rendered with real children and real content; `tests/unit/hero-parity.test.tsx` compares the Hero against the real data.

**E2E Tests (`tests/e2e/`):**
- Playwright, against the production build served by `vite preview` on port 4173 (`webServer` in `playwright.config.ts`). Set `E2E_BASE_URL` to test a deployed site instead; the webServer and global setup are skipped in that case.
- `reuseExistingServer` is on locally and off in CI (`process.env.CI`). `forbidOnly` is on in CI.
- Two Playwright projects: `chromium` (ignores `mobile/`) and `mobile` (Pixel 7 device, runs only `tests/e2e/mobile/*.spec.ts`).
- Covers theme persistence and no-flash behavior, the project dialog, keyboard rail navigation, focus rings, geometry and dead-band spacing, copy-email, smooth scroll, reduced motion, and the 404 page.
- Visual and geometry checks use measured bounding boxes (`getBoundingClientRect`) and computed styles (`getComputedStyle`), not image snapshots.

**E2E Framework:** Playwright `~1.64.0`, Chromium only.

## Common Patterns

**Async Testing (Vitest):**
```tsx
await act(async () => result.current.toggle())
expect(result.current.theme).toBe('dark')
```
- Wrap state-changing calls in `act(async () => ...)` from `@testing-library/react`.
- Use `await` on `user`-style or DOM events that schedule updates.

**Async Testing (Playwright):**
```ts
await expect.poll(state).toBe('paused')
```
- Use `expect.poll` for values read with a function that is not an auto-retrying locator. Use auto-retrying `expect(locator)` matchers wherever possible.

**Error Testing (Vitest):**
```ts
const run = runGate(script, ['--root', root])
expect(run.status).toBe(1)
expect(run.out).toContain('differs in case from the file on disk')
```
- For scripts, assert on the exit code and a stable substring of the message.
- For forbidden-content checks, also assert the flagged content is absent from the output: `for (const digits of ['555', '010', '0123']) expect(run.out).not.toContain(digits)`.
- For thrown errors in unit code, use `expect(() => fn()).toThrow(...)` with a message fragment.

**Lint-rule testing:**
```ts
const result = lintFixture(SECTIONS)
expect(result.status).not.toBe(0)
expect(restrictedLines(result)).toEqual(expectedLines)
```
- Add a fixture file under `tests/fixtures/` that contains the import to test, then assert the exact flagged line numbers. Look up the lines by their trimmed text with `linesOf()` so the test does not depend on hard-coded line numbers.

**Snapshot testing:** Not used. Assertions are explicit DOM and computed-style checks.

**Adding a new test:**
1. Unit test for a hook or pure function: add `tests/unit/<topic>.test.ts`, import through `@/`.
2. Component test: add `tests/unit/<topic>.test.tsx`, render, and query by role and name.
3. Behavior that needs a real browser or the built site: add `tests/e2e/<topic>.spec.ts`. If it is phone-only, put it in `tests/e2e/mobile/` so the `mobile` project picks it up.
4. A new build gate in `scripts/` needs a test in `tests/unit/gates.test.ts` that uses a temp `--root` and asserts exit codes 0, 1 and 2.

---

*Testing analysis: 2026-11-03*
