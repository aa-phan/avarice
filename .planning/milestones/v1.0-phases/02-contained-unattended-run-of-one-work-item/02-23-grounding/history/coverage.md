# Coverage: history

- code files: none in the packet. The document is written from the commit log at HEAD 0632fd4 (`g''it log --format='%h %ad %s' --date=short`).
- Counts documented:
  - 412 of 412 commits in total (`g''it log --format=%ad --date=short | wc -l`). Per day 8, 108, 56, 89, 108, 43 (`g''it log --format=%ad --date=short | sort | uniq -c`). The old summary said 287 commits over five days and 87 on 2026-11-04; the 2026-11-04 count is now 89 by author date, and the summary reports the recomputed figures.
  - 114 of 114 commits after e725db6 (`g''it log --oneline e725db6..HEAD | wc -l`; 71 dated 2026-11-05, 43 dated 2026-11-06). The worklist said 112, 71 and 41; the range grew by this pass's own commits.
- Existing entries from 2026-11-01 to the 2026-11-05 review fixes are kept verbatim. The quick-task identifier and the "phase close" wording in the last old entry stay because existing entries stay; the reviewer may decide to supersede them.
- Every hash cited comes from the log output; subjects were checked, bodies were not. Behavior mentions (migration, install-host, 0600 history, 2.1.318) were checked against commit subjects, and the second migration file exists under the sqlite adapter directory.
- Not checked: that the described behavior still holds at HEAD (the leaf documents own that); commit bodies; evidence files.
- The log is ordered by author date, and a few commits interleave across the 2026-11-04 and 2026-11-05 buckets; the opening says so.
