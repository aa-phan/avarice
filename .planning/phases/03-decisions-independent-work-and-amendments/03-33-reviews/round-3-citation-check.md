# Round 3 citation check of docs/system/findings.md

Author of the drafts: the plan executor. This is the mechanical check that answers `round-3-A.md` (12 citation WARNINGs, W1 to W12). It is a range and overlap check, not a proof that a citation supports its claim; see "What the check does not prove" and `round-4-A.md`. The check ran against the working tree at the code state of `13a7267` (the code does not change in this plan) with the documents as edited in round 3.

## Command

Run from the repository root:

```
python3 -I .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.py dump
python3 -I .planning/phases/03-decisions-independent-work-and-amendments/03-33-reviews/round-3-citation-check.py verify
```

`dump` prints every citation of `docs/system/findings.md` with the cited line (or lines) of the target file next to the text around the citation. `verify` prints the counts and the mechanical failures, and exits 1 on any failure. The sentence length of the same file is measured by `round-3-sentence-check.py docs/system/findings.md`.

## What the script extracts

- every `path:N` and `path:N` to `:M` (paths under `src`, `test`, `scripts`, `bin`, `docs`, `.planning`, and `package.json`);
- every short-name citation such as `status.ts:50`, which must be unambiguous across the repository, so `status.ts`, `resume.ts`, `context.ts` and `gsd-onboarding.ts` had to be qualified;
- every bare `` `:N` ``, every "line N", "lines N to M", "lines N, M" and every parenthesised "(N)" or "(N, M)", each bound to the nearest file named earlier in the same line;
- every `(now at ...)` and `, now at ...` re-point (the superseded lead before it is not checked, the re-point is);
- every path-like token without a line number, checked for existence (this covers every `docs/` target).

A citation fails mechanically when its file is missing, its line is out of range or blank or only punctuation, its short name is ambiguous, or a bare number has no file to bind to. Every other citation is also compared for a shared word with the claim around it. A citation that shares none has to be listed in `READ_OK` with the reason it lands (28 entries, each read by hand).

## Reading

All 410 current citations were read next to their claims in the `dump` output, not only the ones the script flagged. The citations that did not land on code or text supporting the claim were fixed in `docs/system/findings.md`:

- the 12 of `round-3-A.md`: the `resume.ts` validation (W1), the `STAGES` map and the `status.ts` interruption test (W2), the untrusted flag in the graph adapter (W3), the `extraPath` comment (W4), the decision insert (W5), the retention table (W6), four lines of `docs/containment.md` (W7 to W10), the `permissionMode` row (W11) and the onboarding reader rows of `config-reference.md` (W12);
- further citations that the reviewer's sample did not reach, all of the same class (a lead or an inline number that kept the position of an older state): the `main.ts` usage lead and the proposal line of the bare `avarice` entry; the exit-3 constants of `repo.ts`, `resume.ts` and `context.ts`; the two unknown-flag leads that pointed at `positionals.push`; the `register.ts`, `gsd-intel.ts`, `invocation.ts`, `knowledge-validation.ts`, `index-knowledge.ts` and `index-code-graph.ts` leads; the `events.ts` row hash line; the carrier row, migration header and checkpoint column leads; the pgrep lead on a blank line; the startup descriptor cache lead; the `gh` lines of `existing-tooling-assessment.md`; the settings allow and deny lists; the executor lead; the restricted mode row of `containment.md`; the read-before-edit row lead; the two hook leads that carried their re-point at the end of the line; the hook ledger opener; the discard-step leads; the stored-text lead; the outcome recogniser range end; the notice queue; the amend command default.

O1, O2 and O3 of `round-3-A.md` are fixed as the reviewer suggested: the usage path reads `:76` to `:78`, the SQLite gate cites the verdict check, and the SIGTERM line says that no handler is installed in `src` or `bin` (checked by search).

## Final output of `verify`

```
findings.md citations extracted: 541
  current, checked at HEAD: 410
  superseded leads followed by "(now at": 130 (not checked; the "now at" citation is)
  past positions named on purpose (HIST): 1
path-like tokens without a line number: 11
mechanical failures (missing file, line out of range, blank or punctuation-only line, ambiguous short name, unbound bare number, missing path): 0
current citations with no keyword shared with the claim and not in READ_OK: 0
READ_OK entries (read by hand): 28
RESULT: every current citation resolves to an existing, non-blank line that shares a word with its claim, or was read by hand
```

The one historical citation is `src/app/run-stages/item.ts:70` on the discard-basis line, which the line itself says no longer exists.

## Statement

The check extracted 541 citations from `docs/system/findings.md`: 410 current citations, 130 superseded leads that are followed by a `(now at ...)` re-point, and 1 position that the line names as gone. For all 410 current citations the file exists, the line is in range and not blank, and the claim and the line share a word within three lines (or the citation is in `READ_OK`). `verify` exited 0.

## What the check does not prove

Correction made after `round-4-A.md`. An earlier version of this statement said that every current citation "lands" and "supports its claim". The script cannot show that.

- It tests existence, range, non-blank content and a loose word overlap: one word of five or more letters from the whole findings line must appear within three lines of the cited line. A long claim shares such a word with almost any code in the right file.
- It does not compare the meaning of the cited line with the claim. The round 4 reviewer found one citation (`profile-paths.ts:62`, a path lookup cited for a file write) that passed `verify`, and four claims about code behaviour that it cannot judge (the `paused` classifier, the admitted host versions, the network rule of the executor and the decision class names).
- It does not check the 130 lead numbers that precede a `(now at ...)` re-point, and it does not check the historical entry.
- The hand reading of the 410 citations in round 3 is the only check of meaning, and it missed these five. A reviewer reading the code at each cited line is the control that found them.

The script stays in the repository as an aid for finding gross misses (blank lines, out-of-range lines, ambiguous short names). A pass of `verify` is not evidence that a citation is correct. Its result line says only what it tests.

## Sentence length

`round-3-sentence-check.py docs/system/findings.md` counts each whitespace token (a code span by its inner tokens, a citation as one word), splits sentences at a full stop, a question mark or an exclamation mark, and skips headings, table rows and code fences. A semicolon or a colon does not end a sentence. Result: 543 sentences, 0 over 35 words. Before the sentence edits of this round 48 sentences were over the cap by this count, among them the lines the reviewer named (9, 63, 113, 134, 145, 155, 224, 226, 231). Each was split at a semicolon or a conjunction without changing a claim. No sentence of findings.md is kept over the cap, so no list carve-out is recorded for it.
