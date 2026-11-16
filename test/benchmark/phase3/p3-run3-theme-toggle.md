---
title: Theme attribute constant and the toggle's accessible name
expectedDecisions: 1
baseRevision: 9f1cd8d
items: [
  {"id":"A","title":"Export THEME_ATTRIBUTE from src/lib/theme.ts","dependsOn":[],"size":"small","acceptance":["AC1","AC2"]},
  {"id":"B","title":"Accessible name of ThemeToggle in src/components/ui/ThemeToggle.tsx","dependsOn":[],"size":"medium","acceptance":["AC3"]}
  ]
---
## Behavior
Item A: `src/lib/theme.ts` spells the attribute name `data-theme` in several places. Export `THEME_ATTRIBUTE = 'data-theme'` and use it everywhere in that file. Behaviour does not change.

Item B: `ThemeToggle` is a toggle button with `aria-pressed` and the fixed name "Dark theme". Two accessible variants of the toggle-button pattern are acceptable and the choice is the owner's; stop and ask which one before changing anything. In both, the name "Dark theme" and `aria-pressed` stay exactly as they are:
1. Keep the toggle-button pattern: the fixed name "Dark theme" with `aria-pressed`.
2. The same toggle button with a spoken description added: the name "Dark theme" and `aria-pressed` as in option 1, plus a visually hidden description "Switches between the light and dark theme", linked with `aria-describedby`. The toggle is rendered in two bars, so each instance needs its own unique id for the description.
Add `tests/unit/theme-toggle.test.tsx` with a test named `theme toggle accessible name` that pins the chosen pattern.

## Acceptance criteria
- AC1: THEME_ATTRIBUTE is exported and used for every data-theme access in src/lib/theme.ts | verifiedBy: check:test, check:typecheck
- AC2: the existing theme tests pass and the change lints clean | verifiedBy: check:test, check:lint
- AC3: the toggle follows the pattern the owner chose, pinned by tests/unit/theme-toggle.test.tsx | verifiedBy: decision:toggle-pattern, check:test, test:theme toggle accessible name

## Exclusions
- No change to the theme script in index.html or to theme storage

## Write
- src/lib/theme.ts
- src/components/ui/ThemeToggle.tsx
- tests/unit/theme-toggle.test.tsx
- tests/unit/use-theme.test.tsx

## Target checks
- test
