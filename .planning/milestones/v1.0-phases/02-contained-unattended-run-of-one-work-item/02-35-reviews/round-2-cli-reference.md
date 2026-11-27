Verdict: PASS

I could not run any shell commands, so I computed no SHA-256 digest and this verdict is not bound to a digest. I did not dispatch separate `prose-reviewer` agents because this review was limited to Read, Grep and Glob. I checked both changed paragraphs against `src/cli/render/style.ts`, `src/cli/commands/{onboard,resume,supervise}.ts` and `src/cli/shell/*.ts`.

**What I verified**
- The listed characters match the code's character class exactly (`src/cli/render/style.ts:18`): U+061C, U+200B–U+200F, U+202A–U+202E, U+2060, U+2066–U+2069 and U+FEFF. That covers the overrides, embeddings, isolates, marks, zero-width characters, word joiner and byte order mark. Nothing in the class is missing from the list, and nothing on the list is missing from the class.
- The soft hyphen is kept. U+00AD is outside both the control class (`\x00-\x08\x0b-\x1f\x7f-\x9f`, `style.ts:17`) and the invisible-formatting class.
- "Control characters other than newline and tab" is accurate: the control class skips `\x09` and `\x0a` and also removes DEL and the C1 range (`style.ts:17`).
- Escape sequences are removed through the OSC, string-introducer, CSI and other-ESC patterns (`style.ts:13-16`, applied in order at `style.ts:21`).
- The outcome and error lines of onboard and resume go through `outcomeLines` and `errorLine` (`onboard.ts:44,51,55`, `resume.ts:45-117`, `supervise.ts:30-50`). Both functions strip the whole subject or message, so any ID or path they echo is stripped too (`style.ts:32,38,44`). The resume "interrupted" line strips its fields directly (`resume.ts:93`). That claim is not in the diff for this group. It is consistent with the code.
- The shell strips the same characters, because it prints through `stripControl` from the same module (`shell.ts:342,356,405`, `home-view.ts:62,92,108-117`).
- The link anchor resolves: `cli-reference.md:67` is `### Output style`, which gives `#output-style`.
- House style holds in both changed passages: every sentence is under 35 words, there are no dashes, and no file paths, function names or delivery IDs appear.

**OBS**
1. **cli-reference.md, "The invisible set is the bidirectional overrides, embeddings, isolates and marks, ..."**
   - Problem: the Arabic letter mark (U+061C) is only implied by "marks". A reader may take "marks" to mean only LRM and RLM.
   - Fix: optionally write "the left-to-right, right-to-left and Arabic letter marks".
   - Confidence: medium.
2. **interactive-shell.md:87 ("Pasted control characters and escape sequences are removed first") and :102, plus data-model.md:279 ("stored without control characters or escape sequences")**
   - Problem: these unchanged sentences now understate the behaviour. Typed text and history entries also lose the invisible formatting characters, because they pass through `stripControl` (`line-editor.ts:54`, `history.ts:16`). They are not wrong, only incomplete. The changed sentence at :79 now points to the full list, but these do not.
   - Fix: optionally point them at the output style paragraph as well.
   - Confidence: high.
3. **Cross-document consistency**
   - The other sanitizers described at `indexes-and-context.md:233`, `cli-reference.md:402` and `runs.md:288` are separate code paths with different rules: they replace characters with spaces and cut text at a length limit. They do not contradict the changed paragraph.
   - No fix needed.
   - Confidence: high.
