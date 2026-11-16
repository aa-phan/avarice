Reviewed: docs/system/README.md sha256 d2bbe28dd9d8949c55719cdde9f780da123aa665c0248865983ecf0f8e89e481 at 6b82da29e8f2c8b5324bd4442546c7ececde29ce
Verdict: BLOCKED: 2 WARNING, 1 OBS remain (no BLOCKER)

BLOCKED: 2 WARNING, 1 OBS remain (no BLOCKER)

Digest reviewed: d2bbe28dd9d8949c55719cdde9f780da123aa665c0248865983ecf0f8e89e481 (matches). HEAD 6b82da29e8f2c8b5324bd4442546c7ececde29ce.

FINDINGS
1. WARNING (high). README.md:5, first sentence: "This tree describes AVARICE as it is built: ... together with the interactive shell." Is 41 words with link markup stripped; cap is 35. Fix: end the sentence after "local branch" and give the shell its own sentence.
2. WARNING (high). README.md:36 "Each proposal in docs/ maps to the living documents ..." but only ADR-006 and ADR-013 have rows. ADR-001 to 005 and 007 to 012 (docs/decisions/) have neither a counterpart nor a "none" row, so the claim is false as written. Fix: add rows or one grouped row with a stated disposition, or narrow the sentence to the proposal documents plus the decision records that have a counterpart.
3. OBS (medium). README.md:3 "Status: drafted, not yet reviewed" next to line 5 "Every document here is checked against the code". Consider "written from the code" to avoid implying a second reading.

CHECKED, NOT FLAGGED
- Documents table: 16 rows equals every docs/system file except README.md (ls compared); diagrams/ exists.
- Proposal table: all 14 docs/*.md proposals present. ADR-006 "still marked Proposed" matches ADR-006 line 5. ADR-013 exists.
- Every ../ link target resolves (script reported no MISSING). Per-row mapping accuracy checked by document names and scope only, not against each body.
- No em/en dashes or " -- "; no paths, function names or delivery history in prose; sentence-case headings; no embedded instructions; no secrets. Other sentences under 35 words. No quirks section needed in an index.

git status --porcelain:
?? .planning/config.json
?? .planning/milestone.lock
(both pre-existing in the starting snapshot; no file touched by this run)

## Answers

Applied: finding 1 (the first sentence is split), finding 2 (the sentence now covers the decision records that have a counterpart and says the others have none), OBS 3 (the opening says written from the code). The integrations row was also widened (an OBS of the integrations review).
