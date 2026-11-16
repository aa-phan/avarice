Code files of the packet (all new since e725db6, so each file is its own diff; read in full at HEAD):
- src/app/run-resume.ts: covered
- src/app/run-service.ts: covered
- src/app/run-stages/discard.ts: covered
- src/app/run-stages/finish.ts: covered
- src/app/run-stages/item.ts: covered
- src/app/run-stages/prepare.ts: covered
- src/app/run-start.ts: covered
- src/cli/spawn-supervisor.ts: covered
Also read for the traces: src/app/run-stages/blocked.ts, src/app/invocation.ts (run part), src/app/budget.ts, src/cli/commands/start.ts, resume.ts, supervise.ts, src/domain/run-lifecycle.ts.
Existing flows: diffs read for onboarding-shared modules (onboarding-service, invocation, budget, composition, onboard command, host-claude files, hook policy, pre-tool-use); no onboarding statement changed.
Not checked: checks-and-evidence.md and cli-reference.md start/supervise anchors (not landed); fake-host tests not run; diagrams not rendered; onboarding stage files not re-traced.
Alive proof: run stages are registered in src/app/run-service.ts and the supervisor is spawned by start and resume and run by supervise; command: grep -n "registerRunStage\|spawnSupervisor" src/app/run-service.ts src/cli/commands/start.ts src/cli/commands/resume.ts
Counts:
- Flows traced: 5 of 5 (2 existing, 3 new); M is the packet's denominator.
- Diagram sources: 5 of 5; M: `ls docs/system/diagrams/*.puml | wc -l` gives 2 at HEAD, plus the 3 in this package.
- Run kill points mentioned: 24 of 24; M: `sed -n 200,230p test/helpers/fault-run.ts | grep -c "^  '"`.
- Diagram index rows: 5 of 5 (2 existing kept, 3 new).
Sentence cap: awk check over non-table prose; the two remaining over-35 lines are inherited onboarding steps (map stage, launch assembly).
