# Codebase Concerns

**Analysis Date:** 2026-11-03

## Tech Debt

**Untracked `.env` is required by the build (clean checkouts and CI fail):**
- Issue: `vite.config.ts` throws when `VITE_SITE_ORIGIN` is empty, and the value is only read from the environment or a `.env` file. No `.env` is tracked (`git ls-files` shows none), `.gitignore` does not list `.env` or `.env.*` (only `*.local`), and `.github/workflows/ci.yml` and `.github/workflows/deploy.yml` set only `VITE_BASE`. The STATE note from 04-14 confirms the file was left untracked.
- Files: `vite.config.ts` (lines 36-44), `.gitignore`, `.github/workflows/ci.yml` (env block), `.github/workflows/deploy.yml` (env block), `.planning/STATE.md` (Blockers/Concerns)
- Impact: `npm run verify` and `npm run build` fail in CI on any commit that does not carry the origin value. A developer who runs `git add .` could also commit an env file with unreviewed contents, because nothing ignores it.
- Fix approach: Commit a `.env.example` with the public `VITE_SITE_ORIGIN`, or set it as a repository variable and pass it in the workflow `env:` blocks. Add `.env` and `.env.*.local` patterns to `.gitignore` with a `!.env.example` exception.

**Stale phase-level security record for deploy gating:**
- Issue: `.planning/phases/03-content-complete-site/03-SECURITY.md` records T-03-30 and AR-03-1 as "Deploy workflow runs verify but not e2e". `.github/workflows/deploy.yml` now has an `e2e` job, and `deploy` declares `needs: [build, e2e]`, so the risk as written no longer describes the workflow.
- Files: `.github/workflows/deploy.yml` (jobs `build`, `e2e`, `deploy`), `.planning/phases/03-content-complete-site/03-SECURITY.md`
- Impact: Audit records disagree with the pipeline. Future reviewers may either re-open a closed risk or miss that the e2e gate is now a real dependency.
- Fix approach: Update the accepted-risk entry, or close it with a pointer to `deploy.yml` lines 46-64.

**Unexpected decision record in a non-standard location:**
- Issue: `docs/decisions/ADR-999-injected.md` is marked "Status: Accepted" and its Decision section contains a directive, not a decision. The record is outside `docs/adr/`, which holds the real ADRs 0001-0010, and its own text says it is a rehearsal fixture. The commit `1e2a239` added it.
- Files: `docs/decisions/ADR-999-injected.md`, `docs/adr/README.md`
- Impact: Any tooling or agent that reads accepted decisions could treat the directive as project policy. The record also breaks the ADR numbering and index conventions.
- Fix approach: Remove it from the repository, or move it out of `docs/` into a test fixture directory that no decision-reading process scans.

**Date-sensitive copy is hard-coded in several places:**
- Issue: "Graduating December 2026" (`src/content/profile.ts`), the literal "Graduating" label (`src/sections/Education/Education.tsx` line 27), "Last role: Capital One, summer 2026" and the same facts in the static shell (`index.html`). Only `tests/unit/date-copy.test.ts` lists the places that must agree.
- Files: `src/content/profile.ts`, `src/sections/Education/Education.tsx`, `index.html`, `tests/unit/date-copy.test.ts`
- Impact: Today is 2026-11-03. The copy becomes wrong at the end of December 2026, about eight weeks away. Changing it means editing four places in lockstep. The owner todo in `.planning/STATE.md` is still open.
- Fix approach: Derive the graduation label from `dates.end` against the current date, or schedule the owner update before 2026-12-31. Keep the shell copy generated from the same source.

**Education label depends on a typographic character:**
- Issue: This was IN-08 in 03-REVIEW. The file no longer splits on the en dash, so the risk is closed in code, but the poster headline is still rendered from `monthYear(current.dates.end)` only. Check any future label change against that path.
- Files: `src/sections/Education/Education.tsx`
- Impact: Low. Recorded for completeness.
- Fix approach: None needed now.

**Dead and kept-for-later code in the animation layer:**
- Issue: `TextReveal` (`src/anim/declarative/TextReveal.tsx`) is exported from `src/anim/index.ts` but unused by the app, and the vendored `text-effect` chunk is unrendered. STATE says this is kept for Phase 5 SEC-04, so it is intentional. The `.reveal-pending` CSS in `src/styles/base.css` and the boundary tests still reference it.
- Files: `src/anim/declarative/TextReveal.tsx`, `src/anim/index.ts`, `src/styles/base.css`, `src/anim/MotionFeatures.tsx`, `tests/unit/boundaries.test.ts`
- Impact: Dead code adds maintenance cost and keeps a stale comment about text-effect in `MotionFeatures.tsx` that no longer matches the render path.
- Fix approach: Either wire it in during Phase 5 or remove it with its tests. Update the `MotionFeatures.tsx` comment either way.

## Known Bugs

**Reduced-motion switch mid-session does not load the motion features:**
- Symptoms: A visitor who starts with `prefers-reduced-motion: reduce` and turns it off later keeps static `m` components. The effect calls `warm()` but never marks the features loaded, so motion does not appear until a reload.
- Files: `src/anim/MotionFeatures.tsx` (lines 31-45), `docs/architecture.md`
- Trigger: Toggle the OS reduced-motion setting from reduce to no-preference while the page is open.
- Workaround: Reload the page. `docs/architecture.md` currently says a live toggle takes effect without reload, which is only true in the other direction.

**Classic-scrollbar layout shift when a project dialog opens (deferred):**
- Symptoms: On desktops with non-overlay scrollbars the page reflows behind the backdrop when `html:has(dialog[open])` sets `overflow: hidden`.
- Files: `src/styles/interactions.css` (around lines 533-535)
- Trigger: Open a project on a desktop with a classic scrollbar.
- Workaround: None. Tracked as ROADMAP backlog 999.1 and STATE "Blockers/Concerns". `scrollbar-gutter: stable` appears in later phase tests, so confirm it covers this rule before closing.

**Noscript visitors see empty sections:**
- Symptoms: With JavaScript off, only the hero and bare headings render. Six `min-h-[40svh]` sections are empty.
- Files: `index.html`, `docs/architecture.md`
- Trigger: Disable JavaScript.
- Workaround: None. Planned as LCH-01 in Phase 6. The docs still say the shell has noscript fallback content, which is not yet true.

## Security Considerations

**Owner PII gate depends on a text-layer heuristic:**
- Risk: A phone number could ship in a form the gate does not read. 03-REVIEW fuzzing found misses for digits spaced one at a time and for spelled-out numbers. 02-SECURITY records that uncompressed PDF streams and CID-encoded fonts cannot be read.
- Files: `scripts/check-no-phone.mjs`, `public/resume.pdf`, `.planning/phases/02-deployed-themed-skeleton/02-SECURITY.md`, `.planning/phases/03-content-complete-site/03-REVIEW.md`
- Current mitigation: Pattern scan over `dist`, pdfjs text and annotation pass that fails closed, metadata key review, and a rule that the resume must hold the owner name and at least 1500 characters (`check-no-phone.mjs` lines 347-351 and 393-399). The missing-resume check (lines 447-450) closes WR-01.
- Recommendations: Keep the manual PDF check in the runbook for every resume replacement. Add a fixture for a resume with a spaced phone number. Treat a passing gate as necessary, not sufficient.

**Public repository carries planning and private-process material:**
- Risk: `.planning/` is tracked and public (ADR-0008 reverses the earlier private rule). It includes review and security logs, owner decisions and the injected ADR above.
- Files: `.planning/**`, `docs/decisions/ADR-999-injected.md`, `docs/adr/0008-planning-area-visibility.md`
- Current mitigation: Owner keep-tracked decision; phone shapes are kept out of logs (`02-SECURITY.md` T-02-26, T-02-30).
- Recommendations: Scan `.planning/` on each push for contact-detail shapes, not only `dist`. Remove the rehearsal fixture before the next publish.

**No Content Security Policy on the static host:**
- Risk: GitHub Pages cannot send headers, and the inline theme script in `index.html` and `404.html` has no CSP hash.
- Files: `index.html`, `404.html`, `src/lib/theme.ts`
- Current mitigation: Inline script is byte-identical in both entries and unit-tested (`tests/unit/theme-script.test.ts`); theme value allow-listed to `light` or `dark`.
- Recommendations: Add a meta CSP with the script hash during the hardening phase (AR-02-03).

**Unpinned build-tool ranges:**
- Risk: Several packages use caret or tilde ranges on release lines that are days or weeks old, such as `motion ~14.0.0` (STATE: "motion 14 is days old") and `vite ^8.3.4`, `vitest ^5.0.3`, `oxlint ^1.87.0`.
- Files: `package.json`, `package-lock.json`
- Current mitigation: Lockfile is committed and CI uses `npm ci`; third-party Actions are pinned to full SHAs in both workflows.
- Recommendations: Keep the lockfile current and review `npm outdated` on each phase. Pin `motion` exactly, as `lenis` already is, if it changes behaviour.

## Performance Bottlenecks

**Initial JavaScript budget has limited headroom:**
- Problem: The gzip cap is 150 kB (`scripts/check-js-budget.mjs`). Recorded initial sizes rose from about 85.6 kB (02-06) to about 113.3 kB (03-05) and STATE shows a probe near 139 kB during Phase 2.
- Files: `scripts/check-js-budget.mjs`, `src/anim/features.ts`, `src/anim/featuresStatus.ts`, `src/anim/MotionFeatures.tsx`
- Cause: Motion and Lenis are split into lazy chunks, but the sleeve, dialog and rail code and `@react-spring/web` are still in the main bundle. Phase 4 has added more interactions (04-04 through 04-15).
- Improvement path: Measure the initial chunk after each plan with `npm run check:budget`. Move react-spring-only components behind the features boundary if the margin shrinks. STATE records a pending keep-or-drop decision for react-spring.

**Imperative animation cost in the features chunk:**
- Problem: 04-09 notes that the imperative motion `animate` call costs 11.9 kB gz if imported statically, so it lives in the lazy chunk.
- Files: `src/anim/featuresStatus.ts`, `src/anim/declarative/flipEngine.ts`
- Cause: Shared engine and feature bundle load on first interaction.
- Improvement path: Keep the lazy boundary and check that the first project open does not wait on a network round trip on slow phones.

## Fragile Areas

**Phone-width motion and gesture code:**
- Files: `src/hooks/useSwipeStep.ts`, `src/sections/Projects/ProjectDialog.tsx`, `src/sections/Projects/Projects.tsx`, `src/anim/scroll/SmoothScroll.tsx`, `src/anim/scroll/scrollLock.ts`
- Why fragile: Drag versus scroll depends on `touch-action` and `pan-y` scoping. STATE records an unresolved iOS WebKit issue (232545) and says real-iPhone confirmation is still open. Phase 4 STATE notes call for real-device spikes on iPhone and mid-range Android.
- Safe modification: Change swipe thresholds only with the mobile Playwright specs in `tests/e2e/mobile/` and a device run. Keep `pan-y` scoped to `[data-swipe-surface]`.
- Test coverage: E2E emulation only. No hardware evidence.

**Viewport-driven active-section logic:**
- Files: `src/hooks/useActiveSection.ts`
- Why fragile: The scroll-spy depends on the `--nav-h` custom property being in `rem` or `px`, reads the sticky nav height at observer creation, and resets on a media-query change. The lock timers (700 ms fallback, 150 ms quiet, 3000 ms cap) are tuned for `scrollend` availability.
- Safe modification: Keep `ids` referentially stable. The effect depends on `[ids]`, so a caller that builds a new array on each render reconnects the observer every render. Check `src/layout/nav-items.ts` and `src/app/Page.tsx` before changing ids.
- Test coverage: `tests/unit/active-section.test.ts` covers `pickActive` only; lock and observer wiring are e2e-only (`tests/e2e/nav.spec.ts`).

**Shared theme state across two HTML entries:**
- Files: `index.html`, `404.html`, `src/lib/theme.ts`, `src/hooks/useTheme.ts`
- Why fragile: The inline head script must match in both entries. Any edit to one copy fails `theme-script.test.ts`, which is the only guard.
- Safe modification: Edit both copies in the same commit and run the unit test.
- Test coverage: Unit byte-identity check; `tests/e2e/theme.spec.ts` for behaviour.

**Stale preview server and base path:**
- Files: `playwright.config.ts`, `tests/e2e/global-setup.ts`
- Why fragile: `reuseExistingServer: !CI` can reuse a preview built with a different `VITE_BASE`. 03-20 added a `globalSetup` check against served asset URLs, but the local base is still not trailing-slash normalised.
- Safe modification: Normalise the base the same way `vite.config.ts` does (`replace(/\/?$/, '/')`) before using it.
- Test coverage: The guard itself is covered by the e2e run; not by unit tests.

## Scaling Limits

**Single static host, no runtime control:**
- Current capacity: One GitHub Pages site serving static HTML, JS, images and `public/resume.pdf`.
- Limit: No server-side logic, analytics, form handling, or header control. Any future feature that needs server behaviour requires a new host.
- Scaling path: Decisions belong in `docs/architecture.md` before adding a backend. Phase 6 (cutover into the existing Pages site) is documented as additive; see `.planning/ROADMAP.md`.

## Dependencies at Risk

**`motion` 14 is newly released:**
- Risk: STATE notes "motion 14 is days old". The motion and react-spring APIs are both in active use.
- Impact: Breaking changes would hit the sleeve, dialog and nav transitions at once.
- Migration plan: Fallbacks recorded in STATE are 12.43 and 13.5.1. Pin exactly if a regression appears.

**`@react-spring/web` scope is undecided:**
- Risk: STATE says react-spring owns four interactions and a keep-or-drop decision is pending after Phase 4. A second animation library increases bundle size and maintenance.
- Impact: `src/anim/physics/` (`CrateRail.tsx`, `PressSquish.tsx`, `ThemeThumb.tsx`) and the boundary rules depend on it.
- Migration plan: Decide after Phase 4 measurement; if dropped, move the four interactions to `motion`.

**`pdfjs-dist` used only at build time:**
- Risk: Exact pin `6.3.289` is in `devDependencies`. It parses untrusted PDF input in the gate, and `isEvalSupported` is ignored by this version.
- Impact: Gate could be bypassed or fail on a malicious PDF; no runtime exposure.
- Migration plan: Keep the exact pin, and recheck the eval setting on each upgrade (`scripts/check-no-phone.mjs` line 364 comment).

## Missing Critical Features

**Noscript content (LCH-01):**
- Problem: No `<noscript>` section content in the shell.
- Blocks: JS-off visitors and crawlers that do not run scripts see no project or experience content.

**Post-graduation copy update:**
- Problem: Requires an owner action after December 2026 (see Tech Debt).
- Blocks: Nothing today; becomes a factual error after the date.

## Test Coverage Gaps

**Gesture and motion behaviour:**
- What's not tested: Real touch gesture behaviour, drag versus scroll on iOS and Android, and the reduced-motion switch mid-session.
- Files: `src/hooks/useSwipeStep.ts`, `src/anim/MotionFeatures.tsx`, `tests/e2e/mobile/rail-touch.spec.ts`, `tests/e2e/mobile/project-sheet.spec.ts`
- Risk: Regressions on iPhone WebKit and on mid-range Android go unnoticed; the mid-session reduced-motion gap above is untested.
- Priority: High

**Deploy path end to end:**
- What's not tested: The deployed Pages URL is only checked for the string "Aaron Phan" after publish (`.github/workflows/deploy.yml` lines 75-81). No check of the resume link, the status code, or the 404 page on the live host.
- Files: `.github/workflows/deploy.yml`, `tests/e2e/resume.spec.ts`, `tests/e2e/not-found.spec.ts`
- Risk: A live-only defect (base path, missing asset) passes deploy.
- Priority: Medium

**Gate fixtures for the PDF phone check:**
- What's not tested: A resume that carries a phone in a spaced or spelled-out form, and a dist with no PDF text layer (only the missing-file case is covered after 03-20).
- Files: `scripts/check-no-phone.mjs`, `tests/unit/gates.test.ts`
- Risk: Owner phone number published through a shape the heuristic does not match.
- Priority: High

**Stale planning state:**
- What's not tested: `.planning/STATE.md` frontmatter reports 55 of 59 plans complete and "Plan 14 of 19", while the body records 04-15 as the last completed plan and 04-16 has a PLAN file but no SUMMARY. `.planning/config.json` is modified and uncommitted.
- Files: `.planning/STATE.md`, `.planning/config.json`, `.planning/phases/04-motion-system-and-signature-rail/`
- Risk: Orchestration tools read inconsistent progress and may resume the wrong plan.
- Priority: Low

---

*Concerns audit: 2026-11-03*
