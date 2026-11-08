---
title: Extract the off-screen textarea of the copy fallback
size: medium
expectedDecisions: 0
baseRevision: 9f1cd8d
---
## Behavior
In `src/lib/copy.ts`, `execCommandCopy` builds a read-only, hidden, off-screen textarea inline. Move that construction into a module-private function `createOffscreenTextarea(text: string): HTMLTextAreaElement` in the same file and call it from `execCommandCopy`. Behaviour does not change: the same attributes and styles, the same append, select, execCommand and remove sequence, the same return values. No exported name changes.

## Acceptance criteria
- AC1: the copy unit tests pass | verifiedBy: check:test
- AC2: the copy unit test file is unchanged | verifiedBy: diff:tests/unit/copy.test.ts unchanged
- AC3: the change typechecks and lints clean | verifiedBy: check:typecheck, check:lint

## Exclusions
- No change to useCopyEmail or the toast
- No new export from src/lib/copy.ts

## Write
- src/lib/copy.ts

## Target checks
- test
- typecheck
