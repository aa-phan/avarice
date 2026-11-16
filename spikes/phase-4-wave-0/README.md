# Phase 4 wave 0 spikes (plan 04-02)

Three questions that later plans of Phase 4 build on, answered with measurement on this machine (graphify 0.9.53, Claude Code 2.1.325). No model call and no spend: nothing here launches a prompt.

| Spike | Question | Verdict | Used by |
|---|---|---|---|
| [S4-A](S4-A-edge-relations.md) | Which edge relations exist on real graphs and which read rule does each get (FR-22) | 16 relations over three graphs (TypeScript with knowledge pass, Python, Go); table mapped; unmapped relations default to `id-only`; `inherits` and `uses` are new | 04-09 |
| [S4-B](S4-B-node-id-stability.md) | Does a path-subset extraction keep node IDs equal to a whole-tree extraction (A1, D-11) | Holds with normalization for node IDs (the subset must keep repository-relative paths; a scoped root gives 0 of 25 equal IDs). Edges that leave the extracted set are lost (4 of 1261 after one changed file), so 04-17 uses the fallback: full code-only extraction plus a node-level diff (1.5 s on 157 files) | 04-17 |
| [S4-C](S4-C-host-probes.md) | Which restricted-mode and budget flags the installed host offers, and what the offline D-20 probes can prove (D-20, CON-4) | pending | 04-11, 04-23 |

`relation-census.mjs` is the S4-A script: `node relation-census.mjs <graph.json> [...]` prints per-graph and total counts of each edge relation by confidence tier.
