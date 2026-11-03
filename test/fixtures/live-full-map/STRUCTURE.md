# Codebase Structure

**Analysis Date:** 2026-11-03

## Directory Layout

```
[repo-root]/
├── .claude/                 # Project Claude config (CLAUDE.md, cc-writes)
├── .github/workflows/       # ci.yml, deploy.yml (GitHub Actions to GitHub Pages)
├── .planning/               # GSD planning artifacts; codebase/ holds these maps
├── docs/                    # architecture.md, deploy-runbook.md, contrast-matrix.md
│   ├── adr/                 # Accepted ADR log (0001-0010) and README.md
│   └── decisions/           # Additional decision records (one file)
├── public/                  # URL-stable static files: favicon.svg, resume.pdf
├── scripts/                 # Node gate scripts (*.mjs) and shared libs
│   └── lib/                 # color.mjs, tokens.mjs, settle-page.mjs
├── src/                     # All application source (see below)
├── tests/                   # Vitest unit tests, Playwright e2e, fixtures
│   ├── unit/                # *.test.ts / *.test.tsx
│   ├── e2e/                 # *.spec.ts, global-setup.ts
│   │   └── mobile/          # Mobile viewport specs
│   └── fixtures/            # anim, sections, app, motion-primitives sample modules
├── 404.html                 # Second HTML entry (GitHub Pages not-found page)
├── index.html               # Main HTML entry, static hero shell, theme init script
├── DESIGN.md                # Design notes
├── package.json             # Scripts (dev, build, verify, check:*) and dependencies
├── package-lock.json
├── vite.config.ts           # Vite config, "@" alias, two HTML inputs, site-files plugin
├── vitest.config.ts
├── playwright.config.ts
├── tsconfig.json            # Project references
├── tsconfig.app.json        # src/ typecheck
├── tsconfig.node.json       # Node-side config files
├── tsconfig.scripts.json    # scripts/ typecheck
├── tsconfig.test.json       # tests/ typecheck
├── .oxlintrc.json           # Lint rules, including import-boundary overrides
├── .oxlintignore
├── prettier.config.mjs
├── .prettierignore
└── .gitignore
```

## Directory Purposes

**`src/app/`:**
- Purpose: Composition root. Mounts providers and assembles the page.
- Contains: `App.tsx`, `Providers.tsx`, `Page.tsx`
- Key files: `src/app/Page.tsx` (only file that imports `src/content`), `src/app/Providers.tsx` (provider order)

**`src/sections/`:**
- Purpose: One folder per portfolio section.
- Contains: `Hero/` (Hero.tsx, HeroGlyph.tsx), `About/About.tsx`, `Experience/Experience.tsx`, `Projects/` (Projects.tsx, ProjectDialog.tsx, Sleeve.tsx, RecordDisc.tsx, rail-keys.ts, project-types.ts), `Skills/Skills.tsx`, `Education/Education.tsx`, `Contact/Contact.tsx`
- Key files: `src/sections/Projects/Projects.tsx` (crate rail, the most stateful section)

**`src/layout/`:**
- Purpose: Page chrome shared across sections.
- Contains: `Section.tsx`, `Container.tsx`, `SiteHeader.tsx`, `PillNav.tsx`, `nav-items.ts` (`SECTION_IDS`), `Footer.tsx`, `SkipLink.tsx`, `Wordmark.tsx`
- Key files: `src/layout/nav-items.ts` (section id list used by scroll-spy), `src/layout/Section.tsx`

**`src/components/ui/`:**
- Purpose: Reusable UI primitives and small hooks.
- Contains: `CtaLink.tsx`, `Toast.tsx`, `ThemeToggle.tsx`, `useToast.ts`, `useCopyEmail.ts`, `icons/` (ChevronLeft, ChevronRight, Close, Download, GitHub, Instagram, LinkedIn)

**`src/components/motion-primitives/`:**
- Purpose: Vendored copy-in source, treated as owned code.
- Contains: `text-effect.tsx`
- Note: Exempt from lint autofix churn; may import `motion/react`.

**`src/anim/`:**
- Purpose: Internal animation layer. Only place that imports motion, react-spring and Lenis.
- Contains:
  - `index.ts`: public barrel (the only import path for consumers)
  - `MotionPreferenceProvider.tsx`, `useMotionPreference.ts`, `useFinePointer.ts`: preference and pointer capability
  - `MotionFeatures.tsx`, `features.ts`, `featuresStatus.ts`: lazy motion feature chunk
  - `tokens.ts`: springs, durations, eases
  - `declarative/`: `ProjectPanel.tsx`, `ToastPresence.tsx`, `NavIndicator.tsx`, `PillMorph.tsx`, `GlyphFlip.tsx`, `flipEngine.ts`
  - `physics/`: `PressSquish.tsx`, `CrateRail.tsx`, `ThemeThumb.tsx`
  - `scroll/`: `LenisRoot.tsx`, `SmoothScroll.tsx`, `scrollLock.ts`

**`src/content/`:**
- Purpose: All site copy and structured data as typed TypeScript.
- Contains: `schema.ts` (types), `profile.ts`, `experience.ts`, `projects.ts`, `skills.ts`, `education.ts`, `contacts.ts`, `images.ts`, `index.ts`
- Key files: `src/content/schema.ts`, `src/content/index.ts` (exports `siteContent`)

**`src/hooks/`:**
- Purpose: Cross-cutting React hooks.
- Contains: `useActiveSection.ts`, `useTheme.ts`, `useSwipeStep.ts`

**`src/lib/`:**
- Purpose: Non-React helpers.
- Contains: `utils.ts` (`cn`), `dates.ts`, `copy.ts`, `theme.ts`

**`src/styles/`:**
- Purpose: Tailwind v4 entry and CSS tokens.
- Contains: `index.css` (Tailwind import, dark variant, `@theme inline`), `tokens.css` (five role tokens and derived tokens, light and dark blocks), `base.css` (resets, focus ring, reduced-motion guard, fonts), `interactions.css`, `not-found.css`

**`src/assets/images/`:**
- Purpose: Source images imported as modules (hashed by Vite, transformed by vite-imagetools).
- Contains: `symbotic.png`, `spectrum.png`, `about-dj.jpg`, `capitalone.png`

**`src/types/`:**
- Purpose: Ambient type declarations.
- Contains: `imagetools.d.ts`

**`tests/unit/`:**
- Purpose: Vitest unit tests, including gate negatives and content invariants.
- Contains: e.g. `tokens.test.ts`, `theme.test.ts`, `active-section.test.ts`, `content.test.ts`, `layout.test.tsx`, `sections.test.tsx`, `motion-preference.test.tsx`, `boundaries.test.ts`, `gates.test.ts`

**`tests/e2e/`:**
- Purpose: Playwright browser tests against the built site.
- Contains: `smoke.spec.ts`, `hero.spec.ts`, `projects` coverage in `project-dialog.spec.ts`, `theme.spec.ts`, `geometry.spec.ts`, `mobile/*.spec.ts`
- Key files: `tests/e2e/global-setup.ts`

**`scripts/`:**
- Purpose: Quality gates run by `npm run verify` and CI.
- Contains: `check-no-phone.mjs`, `check-path-case.mjs`, `check-colors.mjs`, `check-contrast.mjs`, `check-js-budget.mjs`, `check-meta.mjs`, `check-images.mjs`, `check-qa-shots.mjs`, `trace-settle.mjs`, `qa-extra-shots.mjs`, `contrast-pairs.json`
- Shared libs: `scripts/lib/color.mjs`, `scripts/lib/tokens.mjs`, `scripts/lib/settle-page.mjs`

## Key File Locations

**Entry Points:**
- `index.html`: main HTML document and module script
- `404.html`: not-found HTML entry
- `src/main.tsx`: React root
- `src/app/App.tsx`: app root component

**Configuration:**
- `vite.config.ts`: build, aliases, base path, site files
- `tsconfig.app.json`: `@/*` path mapping to `src/*`
- `.oxlintrc.json`: lint and import-boundary rules
- `playwright.config.ts`, `vitest.config.ts`: test runners
- `prettier.config.mjs`: formatting, Tailwind class sorting

**Core Logic:**
- `src/app/Page.tsx`: page composition and scroll-spy wiring
- `src/hooks/useActiveSection.ts`: active-section logic
- `src/anim/index.ts`: animation API surface
- `src/anim/tokens.ts`: spring canon
- `src/styles/tokens.css`: color roles

**Testing:**
- `tests/unit/`: unit and gate tests
- `tests/e2e/`: browser tests
- `tests/fixtures/`: sample modules for boundary tests

**Documentation:**
- `docs/architecture.md`: architecture source of truth
- `docs/adr/README.md`: ADR index
- `docs/deploy-runbook.md`: deploy steps and rollback

## Naming Conventions

**Files:**
- React components: PascalCase `.tsx` (`Projects.tsx`, `SiteHeader.tsx`, `PillMorph.tsx`)
- Non-component modules: camelCase `.ts` (`useActiveSection.ts`, `scrollLock.ts`, `flipEngine.ts`, `tokens.ts`)
- Helper modules inside a section folder: kebab-case (`rail-keys.ts`, `project-types.ts`, `nav-items.ts`, `text-effect.tsx`)
- Content data modules: lowercase noun, one per section (`experience.ts`, `projects.ts`)
- Tests: `<subject>.test.ts(x)` in `tests/unit/`, `<subject>.spec.ts` in `tests/e2e/`
- Scripts: `check-<thing>.mjs`
- ADRs: `NNNN-kebab-title.md` in `docs/adr/`

**Directories:**
- Section folders: PascalCase matching the component (`src/sections/Projects/`)
- Infra folders: lowercase (`layout`, `hooks`, `lib`, `styles`, `anim`, `content`)
- Animation subfolders by owner: `declarative/` (motion), `physics/` (react-spring), `scroll/` (Lenis)

**Exports:**
- Components: named exports (`export function Projects`), no default exports in `src/sections/`
- Hooks: `use*` prefix, named exports

**Mixed case inconsistency:** `src/layout/nav-items.ts` and `src/sections/Projects/rail-keys.ts` use kebab-case while sibling hooks use camelCase. Follow the existing neighbor when adding files to a folder.

## Where to Add New Code

**New Section:**
- Component: `src/sections/<Name>/<Name>.tsx` (named export, props typed, no content import)
- Data: new module `src/content/<name>.ts` with a type in `src/content/schema.ts`, added to `siteContent` in `src/content/index.ts`
- Wiring: render from `src/app/Page.tsx`; add its id to `SECTION_IDS` in `src/layout/nav-items.ts` and to the nav items
- Tests: `tests/unit/sections.test.tsx` pattern or a new `tests/unit/<name>.test.tsx`; e2e spec in `tests/e2e/`

**New Layout or Shared Chrome:**
- Implementation: `src/layout/<Name>.tsx`
- Imports: animation only through `@/anim`

**New UI Primitive:**
- Implementation: `src/components/ui/<Name>.tsx`; icon glyphs as inline SVG in `src/components/ui/icons/`

**New Animated Wrapper:**
- motion-owned (presence, layout, scroll-linked): `src/anim/declarative/<Name>.tsx`
- react-spring-owned (velocity, pointer physics): `src/anim/physics/<Name>.tsx`
- Export it from `src/anim/index.ts`; read `useMotionPreference` and forward `className`

**New Hook:**
- Shared: `src/hooks/use<Name>.ts`
- Section-local: inside the section folder

**Utilities:**
- Pure helpers: `src/lib/<name>.ts`
- Class composition: `cn` in `src/lib/utils.ts`

**New Content Field:**
- Type: `src/content/schema.ts`
- Data: the owning `src/content/<section>.ts` module; copy changes also recorded in the content inventory (see `tests/unit/content-inventory.test.ts`)

**New Image:**
- Source: `src/assets/images/`, imported in `src/content/images.ts`
- Must be AVIF or WebP when shipped, with no EXIF or XMP (`scripts/check-images.mjs`)

**New Static Public File:**
- `public/` only for URL-stable files; reference through `import.meta.env.BASE_URL`

**New Gate or Script:**
- `scripts/check-<name>.mjs`; wire into `package.json` `verify` and into `docs/architecture.md` quality gates

**New Test:**
- Unit: `tests/unit/<subject>.test.ts(x)`; fixtures in `tests/fixtures/<area>/`
- E2E: `tests/e2e/<subject>.spec.ts`

## Special Directories

**`dist/`:**
- Purpose: Vite build output
- Generated: Yes
- Committed: No (ignored by `.gitignore`)

**`node_modules/`:**
- Purpose: Installed dependencies
- Generated: Yes
- Committed: No

**`.planning/`:**
- Purpose: GSD planning and codebase maps
- Generated: Partly (codebase maps are generated by `/gsd-map-codebase`)
- Committed: Yes (`.planning/config.json` is tracked; codebase maps follow the repo's commit policy)

**`src/assets/images/`:**
- Purpose: Source images for build-time transformation
- Generated: No
- Committed: Yes

**`.claude/`:**
- Purpose: Local Claude Code project configuration
- Generated: Partly (`.cc-writes` is tool-managed)
- Committed: `CLAUDE.md` yes; local settings not committed

---

*Structure analysis: 2026-11-03*
