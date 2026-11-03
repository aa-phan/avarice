<!-- refreshed: 2026-11-03 -->
# Architecture

**Analysis Date:** 2026-11-03

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 index.html  /  404.html                      │
│        inline theme-init script, static hero shell           │
└──────────────────────────┬──────────────────────────────────┘
                           │ <script type=module>
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  src/main.tsx  (createRoot, StrictMode, Archivo font import) │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  src/app/App.tsx → src/app/Providers.tsx                     │
│  MotionPreferenceProvider · SmoothScroll · GlyphFlipController│
│  MotionFeatures (lazy chunk) · ToastProvider                 │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  src/app/Page.tsx  (ONLY importer of src/content data)       │
│  useActiveSection → SiteHeader · <main> sections · Footer ·  │
│  PillNav                                                     │
└──────┬───────────────────────────────────────────┬──────────┘
       ▼                                           ▼
┌──────────────────────────────┐   ┌──────────────────────────┐
│ src/sections/*               │   │ src/layout/*             │
│ Hero About Experience        │   │ Section Container        │
│ Projects Skills Education    │   │ SiteHeader PillNav       │
│ Contact                      │   │ Footer SkipLink Wordmark │
└──────────────┬───────────────┘   └────────────┬─────────────┘
               ▼                                 ▼
┌─────────────────────────────────────────────────────────────┐
│  src/anim/index.ts  (the only animation import path)         │
│  motion/react wrappers · @react-spring/web wrappers · Lenis  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  src/components/ui · src/components/motion-primitives        │
│  src/hooks · src/lib · src/styles · src/assets               │
└─────────────────────────────────────────────────────────────┘
```

Build-time data path (separate from runtime): `src/content/*.ts` → `src/content/index.ts` (`siteContent`) → `src/app/Page.tsx` → props → sections → layout and ui.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Entry | Mount React root in StrictMode; load Archivo variable font | `src/main.tsx` |
| App shell | Compose providers and page | `src/app/App.tsx`, `src/app/Providers.tsx` |
| Page | Compose sections from typed content; derive mailto email; run scroll-spy | `src/app/Page.tsx` |
| Content model | Type definitions for all site data | `src/content/schema.ts` |
| Content data | Copy and structured data, one module per section | `src/content/profile.ts`, `src/content/experience.ts`, `src/content/projects.ts`, `src/content/skills.ts`, `src/content/education.ts`, `src/content/contacts.ts` |
| Content assembly | Aggregate `siteContent` | `src/content/index.ts` |
| Image registry | Imported image assets for content | `src/content/images.ts` |
| Scroll-spy | Active section from IntersectionObserver band; click lock | `src/hooks/useActiveSection.ts` |
| Theme | Theme state and toggle (data-theme attribute) | `src/hooks/useTheme.ts`, `src/lib/theme.ts`, `src/components/ui/ThemeToggle.tsx` |
| Swipe step | Touch step helper for the project rail | `src/hooks/useSwipeStep.ts` |
| Section frame | Common section chrome and heading | `src/layout/Section.tsx`, `src/layout/Container.tsx` |
| Navigation | Desktop sticky header and phone pill nav | `src/layout/SiteHeader.tsx`, `src/layout/PillNav.tsx`, `src/layout/nav-items.ts` |
| Projects crate | Sideways scroll-snap rail of sleeves, keyboard travel | `src/sections/Projects/Projects.tsx`, `src/sections/Projects/Sleeve.tsx`, `src/sections/Projects/rail-keys.ts` |
| Project dialog | Native `<dialog>` detail view with morph-in from the sleeve | `src/sections/Projects/ProjectDialog.tsx`, `src/sections/Projects/RecordDisc.tsx` |
| Toasts | Toast context, state and presence | `src/components/ui/Toast.tsx`, `src/components/ui/useToast.ts`, `src/anim/declarative/ToastPresence.tsx` |
| Copy email | Clipboard action for contact email | `src/components/ui/useCopyEmail.ts` |
| Motion preference | OS reduced-motion plus site override; configures both libraries | `src/anim/MotionPreferenceProvider.tsx`, `src/anim/useMotionPreference.ts` |
| Motion tokens | Springs, durations, eases in both libraries' formats | `src/anim/tokens.ts` |
| Lazy motion features | Async `motion` feature chunk | `src/anim/MotionFeatures.tsx`, `src/anim/features.ts`, `src/anim/featuresStatus.ts` |
| Smooth scroll | Lenis desktop wheel smoothing and scroll lock | `src/anim/scroll/LenisRoot.tsx`, `src/anim/scroll/SmoothScroll.tsx`, `src/anim/scroll/scrollLock.ts` |
| Shared-element flip | FLIP engine and glyph flip for theme change | `src/anim/declarative/flipEngine.ts`, `src/anim/declarative/GlyphFlip.tsx` |
| Physics wrappers | react-spring press, crate rail, theme thumb | `src/anim/physics/PressSquish.tsx`, `src/anim/physics/CrateRail.tsx`, `src/anim/physics/ThemeThumb.tsx` |
| Vendored primitive | TextEffect (owned source, kept for hero role line) | `src/components/motion-primitives/text-effect.tsx` |
| Styling | Tailwind v4 entry, role and derived tokens, base rules | `src/styles/index.css`, `src/styles/tokens.css`, `src/styles/base.css`, `src/styles/interactions.css`, `src/styles/not-found.css` |
| Build | Vite config: react, tailwind, imagetools, site-files plugin, two HTML entries, `@` alias | `vite.config.ts` |

## Pattern Overview

**Overall:** Static single-page React app with a typed content layer, a strict layered import graph enforced by lint, and one internal animation facade.

**Key Characteristics:**
- No router, no global store, no data fetching. Everything after build is client-side props flow.
- Content is data, not components: `Page.tsx` is the only consumer of `siteContent`; ordering is decided by array order in `src/content/*.ts`.
- Two animation libraries (`motion` and `@react-spring/web`) are hidden behind `src/anim/index.ts`. Rule: one library animates any given element or property.
- Design tokens are CSS variables keyed by `data-theme` on `<html>`; components use semantic utilities only.
- Output is a static bundle with a second HTML entry (`404.html`) for GitHub Pages unknown-path handling.

## Layers

**app (composition root):**
- Purpose: Mount React, wire providers, assemble the page from content.
- Location: `src/app/`, `src/main.tsx`
- Contains: `App.tsx`, `Providers.tsx`, `Page.tsx`
- Depends on: `src/content`, `src/sections`, `src/layout`, `src/anim` (barrel only in Providers), `src/components/ui/Toast`, `src/hooks/useActiveSection`
- Used by: `src/main.tsx` only

**sections (feature UI):**
- Purpose: One folder per portfolio section; props in, JSX out.
- Location: `src/sections/{Hero,About,Experience,Projects,Skills,Education,Contact}/`
- Contains: section components plus section-local helpers (for example `src/sections/Projects/rail-keys.ts`, `src/sections/Projects/project-types.ts`)
- Depends on: `src/layout`, `src/components/ui`, the `src/anim` barrel, `src/lib`, `src/hooks`, content types (`src/content/schema.ts` types only)
- Used by: `src/app/Page.tsx`

**layout (page chrome):**
- Purpose: Shared frame, navigation, footer, skip link, wordmark.
- Location: `src/layout/`
- Contains: `Section.tsx`, `Container.tsx`, `SiteHeader.tsx`, `PillNav.tsx`, `nav-items.ts`, `Footer.tsx`, `SkipLink.tsx`, `Wordmark.tsx`
- Depends on: `src/anim` barrel, `src/lib`, `src/hooks`
- Used by: `src/app/Page.tsx`, `src/sections/*`

**components (reusable UI and vendored code):**
- Purpose: Small UI pieces and owned copy-in primitives.
- Location: `src/components/ui/`, `src/components/motion-primitives/`
- Contains: `CtaLink.tsx`, `Toast.tsx`, `ThemeToggle.tsx`, `useCopyEmail.ts`, `useToast.ts`, `icons/` (inline SVG), `motion-primitives/text-effect.tsx`
- Depends on: `src/anim` barrel (ui), `motion/react` and `src/lib/utils` (motion-primitives only)
- Used by: sections, layout, app

**anim (animation facade):**
- Purpose: The only place that imports `motion/react`, `@react-spring/web`, and `lenis`.
- Location: `src/anim/`
- Contains: `index.ts` barrel; `declarative/` (motion-owned: ProjectPanel, ToastPresence, NavIndicator, PillMorph, GlyphFlip, flipEngine); `physics/` (react-spring-owned: PressSquish, CrateRail, ThemeThumb); `scroll/` (Lenis); preference and tokens at root.
- Depends on: `src/styles` token mirror, `src/components/motion-primitives` (for prefabs), `src/lib`
- Used by: sections, layout, components/ui, app

**hooks / lib / styles / assets (foundation):**
- Purpose: Stateless or narrow-state helpers, theme logic, CSS tokens and base rules, imported images and fonts.
- Location: `src/hooks/`, `src/lib/`, `src/styles/`, `src/assets/images/`, `src/types/imagetools.d.ts`
- Contains: `useActiveSection.ts`, `useTheme.ts`, `useSwipeStep.ts`; `dates.ts`, `copy.ts`, `theme.ts`, `utils.ts`; token and base CSS; JPG/PNG sources.
- Depends on: nothing app-level
- Used by: all upper layers

**content (typed data):**
- Purpose: All copy and structured data.
- Location: `src/content/`
- Contains: `schema.ts` (every type), one data module per section, `images.ts`, `index.ts`
- Depends on: `src/assets/images` (image imports)
- Used by: `src/app/Page.tsx` only

## Data Flow

### Primary Request Path (page load)

1. `index.html` loads the module script for `src/main.tsx`; an inline script in `<head>` sets `data-theme` before first paint (`index.html`).
2. `src/main.tsx` renders `<App />` inside `StrictMode` into `#root`.
3. `src/app/App.tsx` wraps `<Page />` in `src/app/Providers.tsx`, which sets up motion preference, smooth scroll, glyph flip, the lazy motion features chunk and toasts.
4. `src/app/Page.tsx` reads `siteContent` from `src/content/index.ts`, derives the email from the `email` contact, and passes slices as props to each section.
5. `useActiveSection(SECTION_IDS)` in `Page.tsx` drives `activeId` for both `SiteHeader` and `PillNav`.

### Interaction Path (project detail)

1. A click or tap on a sleeve in `src/sections/Projects/Sleeve.tsx` calls `onOpen` in `src/sections/Projects/Projects.tsx`.
2. `Projects` measures the sleeve and record boxes (`getBoundingClientRect`) and stores them as `originRect` and `discOrigin`, then sets `openIndex`.
3. `src/sections/Projects/ProjectDialog.tsx` opens a native `<dialog>` (sibling of the section, outside the inverted band), animating from the stored rects through `src/anim/declarative/ProjectPanel.tsx`.

### Scroll-Spy and Nav Lock

1. `src/hooks/useActiveSection.ts` observes section ids with one IntersectionObserver using a band above the bottom 60% of the viewport.
2. `pickActive` selects the last intersecting section in page order; at page bottom the last section wins.
3. `lockTo(id)` (called by nav clicks) pins the indicator until `scrollend` or a quiet period, so the indicator does not sweep through intermediate sections.

### Theme Path

1. Inline script in `index.html` reads storage and `prefers-color-scheme`, sets `data-theme`.
2. `src/hooks/useTheme.ts` and `src/components/ui/ThemeToggle.tsx` change only the attribute and storage on user toggle.
3. `src/styles/tokens.css` resolves all color variables under `[data-theme=dark]` and the light block; `src/styles/index.css` binds the Tailwind dark variant to that attribute.

### Motion Preference Path

1. `src/anim/MotionPreferenceProvider.tsx` reads `prefers-reduced-motion` plus the site override and exposes `useMotionPreference`.
2. Provider configures motion's `MotionConfig`, react-spring `Globals.assign({ skipAnimation })`, and CSS guard in `src/styles/base.css`.
3. Wrappers in `src/anim/` read `reduced` and render an instant equivalent when true.

**State Management:**
- Three small React contexts plus local state: `MotionPreferenceProvider` (motion preference), `ToastProvider` (toasts, `src/components/ui/Toast.tsx`), and the theme attribute on `<html>`.
- Section-local state lives inside the section (for example `openIndex`, `focusIndex`, `pointerIndex` in `src/sections/Projects/Projects.tsx`).
- Pointer and touch values are written to the DOM through react-spring without per-frame React re-render.

## Key Abstractions

**Animation barrel (`src/anim/index.ts`):**
- Purpose: The only import path for animation from outside `src/anim`. Exposes semantic components and hooks, not library primitives.
- Examples: `src/anim/index.ts`, `src/anim/physics/PressSquish.tsx` (`Pressable`, `usePressSquish`), `src/anim/physics/CrateRail.tsx` (`useCrateSprings`, `CrateItem`)
- Pattern: Facade plus owner split by interaction class (motion for presence and layout; react-spring for velocity physics; CSS for color and hover).

**Section frame:**
- Purpose: Uniform section heading, mood spacing and optional aside.
- Examples: `src/layout/Section.tsx`, used by `src/sections/Projects/Projects.tsx` with `mood="tight"` and `className="band-invert ..."`
- Pattern: Presentational wrapper taking `id`, `title`, `mood`, `aside`, `className`.

**Content type contract:**
- Purpose: Compile-time guarantee that content matches the schema.
- Examples: `src/content/schema.ts` (types), `src/content/projects.ts` (uses `satisfies`)
- Pattern: Typed modules with `satisfies`; tests in `tests/unit/content.test.ts` and `tests/unit/content-inventory.test.ts` check invariants.

**Scroll-spy hook:**
- Purpose: Single source of truth for active section.
- Examples: `src/hooks/useActiveSection.ts` (`pickActive` is exported for tests in `tests/unit/active-section.test.ts`)
- Pattern: Observer plus pure selection function plus lock with timeouts.

**Design token pipeline:**
- Purpose: One palette block drives all surfaces.
- Examples: `src/styles/tokens.css` (five role tokens per theme, derived with `color-mix(in oklch, ...)`), `src/anim/tokens.ts` (spring canon)
- Pattern: CSS custom properties; JS mirrors only what JavaScript needs.

## Entry Points

**HTML entry (main site):**
- Location: `index.html`
- Triggers: Browser navigation to the site root or any path served as `index.html`
- Responsibilities: Static hero shell, meta, inline theme script, module script to `src/main.tsx`

**HTML entry (not found):**
- Location: `404.html`
- Triggers: GitHub Pages serves it for unknown paths
- Responsibilities: Static not-found page; styles in `src/styles/not-found.css`. Declared as a second Rollup/Rolldown input in `vite.config.ts`.

**JS entry:**
- Location: `src/main.tsx`
- Triggers: Module script in `index.html`
- Responsibilities: Root render, global CSS and font import

**Build config entry:**
- Location: `vite.config.ts`
- Triggers: `vite`, `vite build`, `vite preview`
- Responsibilities: `base` from `VITE_BASE`, requires `VITE_SITE_ORIGIN`, emits `robots.txt` and `sitemap.xml`, `@` alias to `src`

**Gate and tooling entries:**
- Location: `scripts/*.mjs` (run from `package.json` scripts), `tests/unit/*`, `tests/e2e/*`
- Triggers: `npm run verify`, CI workflows in `.github/workflows/ci.yml` and `.github/workflows/deploy.yml`
- Responsibilities: Quality gates described in `docs/architecture.md`

## Architectural Constraints

- **Threading:** Single-threaded browser main thread. No workers. Image processing happens at build time through `vite-imagetools`.
- **Global state:** No global store. Module-level singletons exist in `src/anim/scroll/scrollLock.ts` (scroll lock state) and `src/anim/featuresStatus.ts` (feature-loaded flag); treat them as shared mutable state.
- **Circular imports:** None observed in the layer rules. `src/anim/` may import `src/components/motion-primitives/` and the reverse is limited to `motion-primitives` importing `motion/react` and `src/lib/utils`.
- **Content access:** Only `src/app/Page.tsx` imports `src/content` (verified by grep: no other `src` file references content modules).
- **Animation libraries:** `motion/react`, `@react-spring/web` and `lenis` are imported only under `src/anim/` and `src/components/motion-primitives/` (verified by grep).
- **Lenis scope:** Lenis is confined to `src/anim/scroll/`; it is off under reduced motion and on touch by default.
- **Tailwind:** CSS-first (`@import`, `@theme`, `@custom-variant`); there is no `tailwind.config.js`.
- **Routing:** None. The project detail is a dialog, not a route. GitHub Pages cannot rewrite SPA paths, so new routes would require hash routing or a 404 strategy.
- **Build base:** Asset URLs must go through module imports or `import.meta.env.BASE_URL`; absolute paths break when `VITE_BASE` changes.

## Anti-Patterns

### Importing content data from a section

**What happens:** A section or layout component imports a module from `src/content/` directly.
**Why it's wrong:** Breaks the layer rule in `docs/architecture.md` and the lint boundary in `.oxlintrc.json`; couples presentation to data shape and bypasses the `Page.tsx` composition seam.
**Do this instead:** Add a prop to the section and pass the slice from `src/app/Page.tsx` (see `Hero`, `About`, `Contact` which receive `profile`, `email`, `links` as props).

### Importing a motion library outside the animation layer

**What happens:** A component imports `motion/react`, `@react-spring/web`, or `lenis` directly.
**Why it's wrong:** The one-library-per-element rule and reduced-motion wiring live in `src/anim/`; direct imports skip them and fail lint.
**Do this instead:** Use the barrel: `import { Pressable, PillMorph, ToastPresence } from '@/anim'`. Add a new wrapper under `src/anim/declarative/` or `src/anim/physics/` and export it from `src/anim/index.ts`.

### Animating one element with both libraries

**What happens:** A wrapper uses motion for one property and react-spring for another on the same element, or adds a Tailwind `transition-*` utility to an element a library animates.
**Why it's wrong:** Two animation systems fight over transform and conflict under reduced motion.
**Do this instead:** Choose the owner per the table in `docs/architecture.md` (Animation layer) and keep the other library off that element.

### Hard-coded colors in components

**What happens:** A component uses a raw hex, rgb, or Tailwind default palette class.
**Why it's wrong:** Breaks the five-role token system and `scripts/check-colors.mjs`.
**Do this instead:** Use semantic utilities mapped in `src/styles/index.css` and role variables from `src/styles/tokens.css`.

### Doc-to-code drift in the architecture doc

**What happens:** `docs/architecture.md` names `lib/cn.ts`; the file is `src/lib/utils.ts`. The doc lists `anim/declarative/` as ToastPresence, NavIndicator, PillMorph only; the folder also holds ProjectPanel, GlyphFlip and flipEngine.
**Why it's wrong:** Planners that trust the doc will look for missing paths.
**Do this instead:** Use the paths in this file and `.planning/codebase/STRUCTURE.md`; update `docs/architecture.md` when the layout changes.

## Error Handling

**Strategy:** Defensive, non-throwing UI. Hooks guard for missing browser APIs and return safe defaults.

**Patterns:**
- `useActiveSection` returns `activeId: null` when `IntersectionObserver` is missing (`src/hooks/useActiveSection.ts`).
- `decodeURIComponent` in `hashTarget` is wrapped in try/catch and falls back to no deep link.
- `src/app/Page.tsx` falls back to an empty email string when no `email` contact exists.
- Build-time configuration fails loudly: `vite.config.ts` throws when `VITE_SITE_ORIGIN` is empty.

## Cross-Cutting Concerns

**Logging:** Not detected in application code.
**Validation:** Compile-time via `satisfies` and `src/content/schema.ts`; invariant tests in `tests/unit/content.test.ts`; build-time gates in `scripts/` (phone number, images, colors, contrast, JS budget, metadata, path case).
**Authentication:** Not applicable. Static site with no accounts or backend.
**Accessibility:** Skip link (`src/layout/SkipLink.tsx`), focus handling in the project dialog, reduced-motion wiring, and contrast gate in `scripts/check-contrast.mjs`.

---

*Architecture analysis: 2026-11-03*
