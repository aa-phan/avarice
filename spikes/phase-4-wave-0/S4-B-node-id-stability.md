# S4-B: node-ID stability of a path-subset extraction (plan 04-02, RESEARCH A1, D-11)

Question: does extracting only some paths with graphify give the same node IDs and edge endpoints as extracting the whole tree, so that plan 04-17 can merge a changed-path extraction into the previous graph by node ID?

Nothing was spent: every extraction is `--code-only`, which makes no model call.

## Verdict

**A1: holds with normalization (node IDs), with a stated limit on edges that leave the extracted set.** A subset extraction yields the same node IDs as the whole tree only when the subset keeps its repository-relative paths; a path-subset extraction cannot re-derive the edges a changed file has to files outside the subset (4 edges of 1261 were missing after one changed file). Merging by node ID alone therefore leaves the graph incomplete.

**Fallback for plan 04-17 (taken, not optional): a full code-only extraction followed by a node-level diff against the previous graph.** It keeps D-11's own pipeline, never runs `graphify update`, and costs 1.5 s on the 157-file portfolio tree, so a subset run saves nothing that matters. Determinism holds (section 4), which the diff needs.

## 1. What 0.9.53 accepts

| Question | Answer (measured) |
|---|---|
| A list of paths to `extract` | No. `graphify extract <path>` takes one root (`graphify --help`). |
| A single file as `<path>` | No. `graphify extract .../Footer.tsx` prints `WARNING: could not scan ... [Errno 20] Not a directory` and `graph is empty`. |
| A directory as `<path>` | Yes, and graphify treats it as the root of that run (a scoped root). |
| A directory that mirrors the changed files at their repository-relative paths | Yes (section 3). |

So "pass a path list" is not available; the two subset forms that exist are the scoped root and the mirrored subset root.

## 2. Setup

Scratch clone of the portfolio outside this checkout, at the onboarded pin: `git clone --no-checkout /Users/aphan/aa-phan-portfolio-v2 /tmp/avarice-s4-spike/portfolio`, then checked out at `9f1cd8d51f83252ad11a8c486c4245b1b9fc3066`. graphify 0.9.53, flags as AVARICE uses them (`--code-only --max-workers 1`, `--out` outside the tree).

```bash
# whole tree
graphify extract /tmp/avarice-s4-spike/portfolio --code-only --out /tmp/avarice-s4-spike/out-full --max-workers 1
# 157 code files -> 1051 nodes, 1257 edges
```

The subset is `src/layout/`, 8 source files (`Container.tsx`, `Footer.tsx`, `nav-items.ts`, `PillNav.tsx`, `Section.tsx`, `SiteHeader.tsx`, `SkipLink.tsx`, `Wordmark.tsx`). In the whole-tree graph, 25 nodes have `source_file` under `src/layout/`, and 17 edges join two of them. Comparison scripts were scratch files in `/tmp/avarice-s4-spike` (a node set compare by ID, an edge compare by `source|target|relation`); they are not part of the repository.

## 3. Step 1: the same files extracted as a subset

| Form | Command | Subset-run nodes | Equal IDs | Only in whole tree | Only in subset run | Internal edges equal | Internal edges differing |
|---|---|---|---|---|---|---|---|
| Scoped root | `graphify extract .../portfolio/src/layout --code-only --out .../out-layout --max-workers 1` | 25 | **0** | 25 | 25 | 0 of 17 | 17 |
| Scoped root, IDs prefixed with `src_layout_` | same run, IDs rewritten by the script | 25 | **25** | 0 | 0 | 17 of 17 | 0 |
| Mirrored subset root | the 8 files copied to `/tmp/avarice-s4-spike/subset/src/layout/`, then `graphify extract .../subset --code-only --out .../out-mirror --max-workers 1` | 25 | **25** | 0 | 0 | 17 of 17 | 0 |

Why the scoped root fails: graphify builds an ID from the path relative to the extraction root, so a node that is `src_layout_nav_items_navitem` in the whole tree is `nav_items_navitem` when `src/layout` is the root. The `source_file` field changes the same way (`src/layout/nav-items.ts` becomes `nav-items.ts`). The mirrored root keeps the relative path, so IDs and `source_file` equal the whole tree's.

Edges that leave the subset: 4 edges of the whole-tree graph have one end in `src/layout/` and the other outside (`Container`, `Footer`, `PillNav` and `Section` each `imports_from` the external-package node `ref_react`). All 4 are absent from every subset run, because the other end is not in the extracted set.

## 4. Step 2: one changed file merged into the whole-tree graph

Change: in the scratch clone, `src/layout/Footer.tsx` gets `import { cn } from '../lib/utils'` and a new `footerYear()` that calls `cn`. Only that file was re-extracted, through a mirrored root holding just `src/layout/Footer.tsx` (3 nodes, 2 edges, 0.14 s). Ground truth is a fresh whole-tree extraction of the modified tree (1052 nodes, 1261 edges, 1.5 s).

Merge by node ID, in the manner of the node-keyed union in `src/domain/graph-merge.ts`: drop the old nodes whose `source_file` is the changed file and the edges that start at them, add the new nodes and edges, keep an incoming edge from another file when its target ID still exists, drop it otherwise.

| Variant | Merged nodes | Nodes differing from truth | Merged edges | Edges missing against truth | Edges extra against truth | Orphan edges |
|---|---|---|---|---|---|---|
| A: replace the file's nodes and its outgoing edges | 1052 | 0 | 1257 | 4 | 0 | 0 |
| B: A, and keep the old outgoing edges that leave the run | 1052 | 0 | 1258 | 3 | 0 | 0 |

Reading the result:

- The replace-by-ID part works. Node IDs match the fresh extraction exactly (0 differences), no edge from another file is orphaned (0), and 0 edges are extra.
- The merge is incomplete on edges. The 4 missing edges of variant A are `Footer -> ref_react imports_from` (an old edge that left the run) and 3 new edges the change introduced: `src_layout_footer -> src_lib_utils imports_from`, `src_layout_footer -> src_lib_utils_cn imports` and `src_layout_footer_footeryear -> src_lib_utils_cn calls`. The subset run cannot emit them, because `src/lib/utils.ts` is not in the run. Variant B recovers the old external edge but not the new ones; no rule applied after the fact can know a new cross-file edge.
- Repeating the same whole-tree extraction twice gives identical output (1052 nodes and 1261 edges both times, 0 nodes and 0 edges differing), so the whole-tree run is deterministic and a node-level diff is sound.

Node-level diff of the fallback on this change (old whole-tree graph against the new one): 1 node added, 0 removed, 4 edges added, 0 removed. It names exactly the change and nothing else.

## 5. What plan 04-17 takes from this

1. Do not extract a path subset and merge it by node ID. Edges from a changed file to anything outside the extracted set are lost (4 of 1261 here, and they are the cross-file `calls` and `imports` edges the retrieval read rules walk).
2. Run the full code-only extraction (`graphify extract <staging> --code-only --out <outside> --max-workers 1`, the unchanged AVARICE invocation) and diff its nodes and edges, keyed by node ID and by `source|target|relation`, against the previous graph.
3. If a subset run is ever wanted for speed, the only form that keeps IDs is a mirrored root at the repository-relative paths; a scoped root needs its path prefix put back on every ID and on `source_file`.
4. `graphify update` stays unused (it writes into the tree and indexes Markdown, per `src/adapters/graph/graphify.ts`).

## 6. Cleanup

The scratch clone, the mirrored roots and every extraction output live in `/tmp/avarice-s4-spike`, outside this checkout, and were removed at the end of plan 04-02.
