# Technology Stack

**Analysis Date:** 2026-11-03

## Languages

**Primary:**
- TypeScript ~6.0.3 - All application source under `src/` (`.ts`, `.tsx`), tests under `tests/`, and the Vite config (`vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`). Strict mode with `verbatimModuleSyntax` and `erasableSyntaxOnly` in `tsconfig.app.json`.

**Secondary:**
- JavaScript (ESM `.mjs`) - Build-time and verification scripts in `scripts/` (for example `scripts/check-js-budget.mjs`, `scripts/check-no-phone.mjs`, `scripts/check-colors.mjs`) and the shared helpers in `scripts/lib/`.
- HTML - Two entry points: `index.html` (main app shell with an inline theme-init script) and `404.html` (second Rollup input for GitHub Pages' not-found page).
- CSS - Tailwind v4 CSS-first setup in `src/styles/index.css`, design tokens in `src/styles/tokens.css`, base rules in `src/styles/base.css`.
- YAML - GitHub Actions workflows in `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`.

## Runtime

**Environment:**
- Node.js `^22.12.0 || ^24.0.0 || >=26.0.0` (declared in `engines` in `package.json`). CI uses `lts/*` through `actions/setup-node`.
- Browser target: evergreen browsers. TypeScript target is ES2022 with `lib` ES2023 + DOM (`tsconfig.app.json`). The site is a client-side SPA; the runtime is the browser.

**Package Manager:**
- npm (lockfile-based; `npm ci` is used in every workflow).
- Lockfile: present - `package-lock.json` (lockfileVersion 3).
- No `.nvmrc`, `.node-version`, or `packageManager` field detected.

## Frameworks

**Core:**
- React ^19.3.0 with react-dom ^19.3.0 - UI rendering. Entry at `src/main.tsx`, rendered inside `StrictMode`.
- Vite ^8.3.4 - Dev server, production bundler (Rolldown via `build.rolldownOptions` in `vite.config.ts`), and `preview` server used by Playwright. Config: `vite.config.ts`.
- Tailwind CSS ^4.3.3 with `@tailwindcss/vite` ^4.3.3 - Styling. Configured CSS-first (no `tailwind.config.js`); dark variant bound to `[data-theme=dark]` via `@custom-variant` in `src/styles/index.css`.

**Animation:**
- motion ~14.0.0 (imports from `motion/react` and `motion/react-m`) - Declarative animation, layout and presence, LazyMotion feature loading. Only imported inside `src/anim/` and `src/components/motion-primitives/`.
- @react-spring/web ~10.1.2 - Spring physics for pointer and velocity-driven interactions. Also confined to `src/anim/`.
- lenis 1.3.27 (pinned exact) - Desktop wheel smoothing (`lenis/react` and `lenis/dist/lenis.css`), used from `src/anim/scroll/`.

**Testing:**
- Vitest ^5.0.3 - Unit tests. Config: `vitest.config.ts` (`jsdom` environment, `tests/unit/**/*.test.{ts,tsx}`, setup file `tests/setup.ts`, `restoreMocks: true`).
- jsdom ^30.1.2 - DOM environment for Vitest.
- @testing-library/react ^16.3.3 and @testing-library/dom ^10 - Component and hook tests.
- @playwright/test ~1.64.0 - End-to-end tests under `tests/e2e/`. Config: `playwright.config.ts` (projects `chromium` and `mobile` using the Pixel 7 device profile; web server runs `npm run preview` on port 4173).
- axe-core 4.13.0 (exact) - Accessibility checks (dev dependency; the axe gate is listed as a later gate in the architecture doc).

**Build/Dev:**
- @vitejs/plugin-react ^6.1.2 - React transform for Vite and Vitest.
- vite-imagetools ~12.0.1 - Build-time image resize and AVIF/WebP variant generation through `?w=...&format=avif;webp&as=picture` import queries (used in `src/content/images.ts` and components).
- TypeScript ~6.0.3 - Type checking via `tsc -b` (project references in `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.scripts.json`, `tsconfig.test.json`).
- oxlint ^1.87.0 - Linting, run with `--deny-warnings`. Rules and import-boundary overrides in `.oxlintrc.json`; ignores in `.oxlintignore`.
- Prettier ^3.9.9 with prettier-plugin-tailwindcss ^0.8.1 - Formatting. Config in `prettier.config.mjs`; ignores in `.prettierignore`.
- @types/node ^24, @types/react ^19, @types/react-dom ^19 - Type declarations.

## Key Dependencies

**Critical (runtime, shipped to the browser):**
- react / react-dom ^19.3.0 - The whole UI.
- motion ~14.0.0 - Mount, exit, layout, and scroll-linked animation. Its feature bundle is split into a lazy chunk (see `src/anim/MotionFeatures.tsx`) to keep initial JS under budget.
- @react-spring/web ~10.1.2 - Physics wrappers (press squish, crate rail, theme toggle thumb).
- lenis 1.3.27 - Smooth wheel scrolling on desktop; disabled under reduced motion.
- @fontsource-variable/archivo ~5.3.0 - Self-hosted variable font (imported as `@fontsource-variable/archivo/wdth.css` in `src/main.tsx`). No third-party font CDN.
- clsx ^2.1.1 and tailwind-merge ^3.7.0 - Class composition through the `cn` helper in `src/lib/utils.ts`, which uses `extendTailwindMerge` for custom class groups.

**Critical (build and verification, dev only):**
- pdfjs-dist 6.3.289 (exact) - Reads the served `public/resume.pdf` text layer, link annotations, and metadata for the phone-number gate (`scripts/check-no-phone.mjs`).
- @playwright/test ~1.64.0 - E2E suite and the `chromium` browser installed in CI.
- vite-imagetools ~12.0.1 - Image pipeline required by the image gate (`scripts/check-images.mjs`).

**Infrastructure:**
- Playwright browser download (`npx playwright install --with-deps chromium`) happens only in the `e2e` job, outside the lockfile and the SHA pins.
- No icon package: brand and UI glyphs are inline SVG components under `src/components/ui/icons/` (ADR-0005, ADR-0010).
- No state-management, routing, data-fetching, or CSS-in-JS library is installed.

**Notes on imports outside `package.json`:**
- `framer-motion` and `react-spring` (unscoped) are referenced only in `tests/unit/boundaries.test.ts`, `tests/unit/ownership.test.ts`, and the fixture `tests/fixtures/sections/Imports.tsx`, as negative cases for the import-boundary lint. They are not dependencies.

## Configuration

**Environment:**
- Build-time env vars are read through `loadEnv(mode, process.cwd(), '')` in `vite.config.ts`:
  - `VITE_BASE` - URL base path. Defaults to `/`; a trailing slash is enforced. CI sets `VITE_BASE=/aa-phan-portfolio-v2/` (`.github/workflows/ci.yml`, `.github/workflows/deploy.yml`). The cutover to the user site changes it to `/`.
  - `VITE_SITE_ORIGIN` - Canonical origin used for `<link rel="canonical">`, `og:url`, and the emitted `sitemap.xml`/`robots.txt`. The build throws if it is empty. No `.env` file is present in the working tree and neither workflow sets this variable, so a clean CI run as currently written has no source for it. Confirm it is supplied before relying on CI.
  - `JS_BUDGET_BYTES` - Optional override for the initial-JS gate (default 150000 bytes gzipped), read by `scripts/check-js-budget.mjs`.
- Runtime: no environment variables are read in the shipped client code. The only `import.meta.env` uses are `import.meta.env.BASE_URL` for the resume link (`src/sections/Hero/Hero.tsx`, `src/sections/Contact/Contact.tsx`, `src/layout/PillNav.tsx`, `src/layout/SiteHeader.tsx`).
- E2E: `E2E_BASE_URL` (optional) points Playwright at a live deployment instead of the local preview server (`playwright.config.ts`).
- Persisted client state: the `theme` key in `localStorage` (`src/lib/theme.ts`).

**Build:**
- `vite.config.ts` - Plugins: react, tailwindcss, imagetools, and a local `siteFiles` plugin that emits `robots.txt` and `sitemap.xml` on build. Resolve alias `@` to `src/`. Two HTML inputs: `index.html` and `404.html`.
- `vitest.config.ts` - Unit test environment and alias, as above.
- `playwright.config.ts` - E2E projects, base URL, and the `global-setup` file `tests/e2e/global-setup.ts`.
- `tsconfig.json` (solution file), `tsconfig.app.json` (`src`, `types: ["vite/client"]`, `noEmit`), `tsconfig.node.json`, `tsconfig.scripts.json`, `tsconfig.test.json`.
- `prettier.config.mjs`, `.oxlintrc.json`, `.oxlintignore`, `.prettierignore`.
- `.gitignore` excludes `node_modules`, `dist`, `dist-ssr`, `test-results/`, `playwright-report/`, `playwright/.cache/`, `coverage`, `.shots/`, `*.local`, and `.planning/milestone.lock`.

**Verification pipeline (`package.json` scripts):**
- `npm run verify` chains: `typecheck` (`tsc -b`), `lint` (`oxlint --deny-warnings`), `format:check`, `test` (`vitest run`), `check:case`, `check:colors`, `check:contrast`, `build` (`tsc -b && vite build`), `check:meta`, `check:budget`, `check:no-phone`, `check:images`.
- `npm run test:e2e` runs `build` then `playwright test`.

## Platform Requirements

**Development:**
- Node.js 22.12+ or 24.x (or 26+).
- npm with the committed lockfile. A lockfile generated on macOS can omit Linux optional native bindings; `docs/deploy-runbook.md` gives the `npm install --os=linux --cpu=x64` remedy.
- A `VITE_SITE_ORIGIN` value for any build (the build throws without it).
- Playwright Chromium for E2E (`npx playwright install chromium`).
- Case-sensitive import paths are required for CI, enforced by `scripts/check-path-case.mjs`.

**Production:**
- Static hosting on GitHub Pages, deployed from the `dist/` artifact by `actions/deploy-pages` (`.github/workflows/deploy.yml`). No server runtime.
- Staging URL: `https://aa-phan.github.io/aa-phan-portfolio-v2/` (base `/aa-phan-portfolio-v2/`). Planned production URL: `https://aa-phan.github.io/` (base `/`), per `docs/deploy-runbook.md`.
- Initial JavaScript must stay within 150 kB gzipped (`scripts/check-js-budget.mjs`).

---

*Stack analysis: 2026-11-03*
