# Phase 2 deferred items

Out-of-scope discoveries made while executing Phase 2 plans. Nothing here blocks the plan that found it.

## 02-01: knowledge pass on Claude Code 2.1.318 writes with the `/var` path form

- **Found by:** plan 02-01, live case 19 (full pass and a re-run), 2026-11-05, claude 2.1.318.
- **What happened:** the knowledge invocation ended `denied` and the project reached `active` with 0 document nodes (`index.absent`, `invocation-failed`). The AVARICE hook allowed every call. The host's `system/permission_denied` event (`decision_reason_type: mode`) refused the model's `Write` to `.avarice-knowledge/.extraction/chunk-01.json`, because the model used the `/var/folders/...` form of the path and the generated `Edit(//private/var/...)` allow rule names the `/private/var/...` form. On 2.1.317 the same case produced 8 document nodes.
- **Why it is deferred:** it is the safe direction (a refused write), it is not a containment failure, and the knowledge pass is a Phase 1 index step that never blocks activation. Phase 2's run does not use it.
- **For Phase 2 plans that build a run purpose:** give the model symlink-resolved (`realpath`) paths in prompts and expected-file lists, and render the generated allow and deny rules from the same resolved form. A live case on a `$TMPDIR` scratch repository will hit the same refusal otherwise.
- **For the owner:** whether to harden the knowledge prompt's path form (Phase 1 code) or leave it; the existing exit target `~/aa-phan-portfolio-v2` is already onboarded, so no Phase 2 exit run depends on it.
