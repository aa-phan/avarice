Verdict: PASS

Severity: **BLOCKER** cannot ship, **WARNING** needs rework, **OBS** is worth noting.

Scope: the changed paragraph in docs/system/cli-reference.md, line 71 of the working tree (hunk `@@ -68,7 +68,7 @@`). I could not compute a SHA-256 digest of the file and could not run git, because this review had only Read, Grep and Glob. This verdict therefore applies to the working-tree file as I read it, not to a recorded digest. I did not dispatch a separate reviewer agent; I did the review myself.

**Claims checked against the code (all correct):**
- **Escape sequences:** these are removed. That covers OSC, DCS, SOS, PM and APC strings, CSI in both its 7-bit and 8-bit forms, and any other ESC sequence (src/cli/render/style.ts:13-16, :21).
- **Control characters other than newline and tab:** these are removed. The `CONTROL` class is `[\x00-\x08\x0b-\x1f\x7f-\x9f]`, which keeps `\x09` (tab) and `\x0a` (newline) (style.ts:17).
- **Invisible formatting characters:** the class is `[\u061C\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]` (style.ts:18). The doc's list matches it:
  - "overrides, embeddings": U+202A–U+202E (LRE, RLE, PDF, LRO, RLO)
  - "isolates": U+2066–U+2069
  - "marks": U+200E, U+200F and the Arabic letter mark U+061C
  - "zero-width characters": U+200B–U+200D
  - "word joiner": U+2060
  - "byte order mark": U+FEFF
  - The list names nothing that the class leaves out, and the class contains nothing the list leaves out.
- **Soft hyphen kept:** U+00AD is outside both `CONTROL` (which stops at `\x9f`) and `INVISIBLE_FORMAT`, and the comment at style.ts:11 states this.
- **Onboard and resume lines are covered:**
  - Every error line in onboard.ts (:18, :44, :51) and resume.ts (:29, :45, :49, :52, :76, :80, :83, :98, :106, :117) goes through `errorLine`, which strips the whole message (style.ts:43-44). That includes the echoed `onboardingId`/`runId` and a `describeError` message carrying a repository path.
  - The outcome lines go through `outcomeLines` (onboard.ts:55, resume.ts:56) or `resultLine` (resume.ts:88, :92).
  - The "interrupted attempt … at …" line strips both values (resume.ts:93).
  - The wait output goes through `renderWait`, which uses `resultLine`/`stripControl`/`errorLine` (start.ts:69-83).
  - The only text not stripped is constant usage text (onboard.ts:18, resume.ts:29, start.ts:79).
- **Supervise:** it prints through the same helpers (supervise.ts:30-50).

House style: no sentence goes over 35 words, there are no dashes, and the paragraph has no file paths, function names or delivery history.

**OBS**

1. **Location:** cli-reference.md:71, the sentence "This covers the outcome and error lines of `onboard` and `resume` like every other text line, including any ID or repository path they echo."
   **Problem:** The paragraph's first sentence already says "Every recorded or repository-derived string". Singling out two commands reads as a review-round seam: a reader coming to it cold will ask why `onboard` and `resume` get a sentence of their own. The claim is true.
   **Fix:** Delete the sentence. If the point about echoed input must stay, widen the first sentence, for example "Every recorded, repository-derived or user-supplied string…".
   **Confidence:** medium.

2. **Location:** docs/system/interactive-shell.md:79, "Everything printed … is stripped of escape sequences and of control characters other than newline and tab before it is drawn."
   **Problem:** The shell prints through the same `stripControl` (it is used in src/cli/shell/shell.ts, home-view.ts, line-editor.ts and history.ts), so it also removes the invisible formatting characters. The shell document now lists fewer characters than cli-reference.md. That is incomplete rather than contradictory, and it states the same fact in two places.
   **Fix:** Link interactive-shell.md:79 to the output-style paragraph in cli-reference.md instead of repeating the list, or add "and invisible formatting characters".
   **Confidence:** high.

3. **Location:** cli-reference.md:71 ("removed") compared with cli-reference.md:402 (the context command: "Control, zero-width and bidirectional characters are replaced by spaces").
   **Problem:** The general rule says these characters are removed, while the context command replaces them with spaces. This tension was already there before this change, which kept the word "removed". A reader may see the two statements as conflicting.
   **Fix:** Add to line 71 that a command's own sanitizer may replace these characters with spaces, and link to the context section.
   **Confidence:** medium.

The changed paragraph is accurate and precise. Its list of code points matches the code's character class exactly, and it states that the soft hyphen is kept, which is the edge case a reader would otherwise have to check in the code.
