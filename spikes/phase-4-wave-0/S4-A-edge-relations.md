# S4-A: graphify edge relations on three real graphs and the proposed read rule per relation (plan 04-02, FR-22)

Question: which `relation` values do real graphify graphs carry, and which read rule (`descendants`, `one-hop`, `id-only`) should each get, so plan 04-09 can freeze `EDGE_READ_RULES` from measurement and not from a guess.

Script: `spikes/phase-4-wave-0/relation-census.mjs` (Node built-ins only). It reads each `graph.json`, groups the edges under `links` by `relation`, and counts per `confidence` tier (EXTRACTED, INFERRED, AMBIGUOUS, missing). Nothing was spent: `graphify extract --code-only` makes no model call.

## 1. Versions and the three graphs

| Tool | Version |
|---|---|
| graphify | 0.9.53 |
| Claude Code (host) | 2.1.325 |
| Node | v26.9.0 |

| # | Graph | Source | Pinned revision | Nodes | Edges |
|---|---|---|---|---|---|
| 1 | Portfolio (TypeScript, plus the onboarding knowledge pass) | local repository `/Users/aphan/aa-phan-portfolio-v2`, staging clone, graph at `~/.local/share/avarice-work/personal-local/onb_01M6J4ATTTXW68YGE2P9V2QMH5/staging/.planning/graphs/graph.json` | `9f1cd8d51f83252ad11a8c486c4245b1b9fc3066` (the `source_revision` stamped on its nodes) | 1173 | 1411 |
| 2 | Python repository | `https://github.com/psf/requests.git` | `3c7baaa05ab4aa49cc819ce3a819d260de19c157` (depth-1 clone of `main`, 38 code files) | 1125 | 2335 |
| 3 | Go repository | `https://github.com/spf13/cobra.git` | `adbc8813901bba65827259daa8e22ff94ec1f30e` (depth-1 clone of `main`, 37 code files) | 683 | 2051 |

Go and Cargo are not installed; neither was needed. graphify parses with tree-sitter, so the Go repository was extracted without building it (RESEARCH Open Question 3 is answered: no toolchain required).

Graph 1 is the AVARICE merged graph (code graph plus knowledge pass), so it is the only one that carries the model-derived relations (`conceptually_related_to`, `cites`, and the INFERRED `rationale_for`, `references` and `implements` edges). Graphs 2 and 3 are code-only AST graphs.

## 2. Commands

```bash
# Scratch directory outside the checkout; clone only, nothing installed, built or run.
mkdir -p /tmp/avarice-s4-spike
git clone --depth 1 https://github.com/psf/requests.git /tmp/avarice-s4-spike/requests
git clone --depth 1 https://github.com/spf13/cobra.git   /tmp/avarice-s4-spike/cobra

# AVARICE's own flags (src/adapters/graph/graphify.ts): code-only, one worker, out directory outside the tree.
graphify extract /tmp/avarice-s4-spike/requests --code-only --out /tmp/avarice-s4-spike/out-requests --max-workers 1
graphify extract /tmp/avarice-s4-spike/cobra    --code-only --out /tmp/avarice-s4-spike/out-cobra    --max-workers 1

node spikes/phase-4-wave-0/relation-census.mjs \
  ~/.local/share/avarice-work/personal-local/onb_01M6J4ATTTXW68YGE2P9V2QMH5/staging/.planning/graphs/graph.json \
  /tmp/avarice-s4-spike/out-requests/graphify-out/graph.json \
  /tmp/avarice-s4-spike/out-cobra/graphify-out/graph.json
```

graphify writes `graphify-out/graph.json` below the `--out` directory. The sandbox AVARICE runs graphify in was not applied to these two extractions; they read a public clone and write one directory, which T-04-03 allows. The clones and the extraction output were deleted after the spike (section 6).

## 3. Census (EXTRACTED / INFERRED / AMBIGUOUS / missing)

Totals over the three graphs (2981 nodes, 5797 edges). Each cell is `EXTRACTED/INFERRED/AMBIGUOUS/missing`; no edge in any graph lacks a `confidence`.

| Relation | Portfolio | requests (Python) | cobra (Go) | Total |
|---|---|---|---|---|
| `calls` | 203/0/0/0 | 379/159/0/0 | 599/335/0/0 | 1181/494/0/0 = 1675 |
| `contains` | 831/0/0/0 | 219/0/0/0 | 444/0/0/0 | 1494 |
| `references` | 5/83/0/0 | 356/0/0/0 | 505/0/0/0 | 866/83/0/0 = 949 |
| `method` | 1/0/0/0 | 470/0/0/0 | 168/0/0/0 | 639 |
| `rationale_for` | 3/13/0/0 | 309/0/0/0 | - | 312/13/0/0 = 325 |
| `imports` | 77/0/0/0 | 145/0/0/0 | - | 222 |
| `imports_from` | 74/0/0/0 | 92/0/0/0 | - | 166 |
| `uses` | - | 0/116/0/0 | - | 0/116/0/0 = 116 |
| `indirect_call` | 0/25/0/0 | 0/33/0/0 | - | 0/58/0/0 = 58 |
| `inherits` | - | 53/0/0/0 | - | 53 |
| `conceptually_related_to` | 0/19/6/0 | - | - | 0/19/6/0 = 25 |
| `extends` | 25/0/0/0 | - | - | 25 |
| `implements` | 11/11/0/0 | - | - | 11/11/0/0 = 22 |
| `re_exports` | 10/0/0/0 | 4/0/0/0 | - | 14 |
| `dynamic_import` | 8/0/0/0 | - | - | 8 |
| `cites` | 6/0/0/0 | - | - | 6 |

Findings that change the plan's starting assumptions:

- The portfolio column reproduces RESEARCH exactly (14 relation names, every count and tier split).
- Two relation names are new in this census: `inherits` (Python class inheritance, 53, the Python spelling of `extends`) and `uses` (Python type or symbol usage, 116, always INFERRED). Neither appears in the portfolio graph, so a table built from the portfolio alone would have left both to the default.
- `calls` and `indirect_call` carry INFERRED edges in the code-only graphs (159 and 335 `calls`; 58 `indirect_call`). The tier does not follow the relation, so the read rule is chosen by relation and the tier stays a separate ranking input (the reader already orders EXTRACTED before INFERRED before AMBIGUOUS).
- `method` links a class to its member functions (`BaseAdapter -> .send()`), so it is containment, not a call. It is 639 edges, 11% of all edges, and the only relation that names a class-to-member parent-child structure besides `contains`.
- `rationale_for` points from a docstring or comment node (file type `rationale`) to the code it explains. It is EXTRACTED when the AST read it (309 on requests) and INFERRED when the knowledge pass wrote it.
- `references` points to a type or a fixture a function names (`CompletionOptions -> ShellCompDirective`), not to a callee.

## 4. Proposed relation-to-read-rule table (input to plan 04-09, `EDGE_READ_RULES`)

| Relation | Read rule | Why |
|---|---|---|
| `contains` | `descendants` | file to symbol, class to nested symbol: parent-child structure |
| `method` | `descendants` | class to member function: parent-child structure |
| `calls` | `one-hop` | dependency: the caller needs the callee's handle |
| `indirect_call` | `one-hop` | dependency, INFERRED tier ranks it below `calls` |
| `imports` | `one-hop` | dependency |
| `imports_from` | `one-hop` | dependency |
| `extends` | `one-hop` | dependency (type hierarchy) |
| `inherits` | `one-hop` | the Python spelling of `extends` |
| `implements` | `one-hop` | dependency (type hierarchy) |
| `re_exports` | `one-hop` | dependency |
| `dynamic_import` | `one-hop` | dependency |
| `references` | `id-only` | type or fixture mention, not a call |
| `uses` | `id-only` | INFERRED type or symbol usage; behaves like `references`, not like a call (judgment call, see below) |
| `cites` | `id-only` | document citation |
| `rationale_for` | `id-only` | explanatory text pointing at code |
| `conceptually_related_to` | `id-only` | model-inferred, the only relation with AMBIGUOUS edges |

Default: any relation not in this table, including a relation a future graphify version adds, is `id-only`. A read that names an unknown relation never expands to a neighbour's body; it returns the node ID and nothing more. `(no relation)` (an edge with no `relation` field) is unmapped and therefore `id-only`.

The classification rule behind the table, so a later relation can be placed the same way:

- A relation that names a parent-child structure (the target is a part of the source) gets `descendants`.
- A relation that names a dependency (the source needs the target to work) gets `one-hop`.
- A relation that names a reference, a citation, an explanation or anything a model inferred as a concept gets `id-only`.
- The default for everything else is `id-only`.

Judgment call: `uses` is dependency-shaped in the loose sense, but every `uses` edge in the census is INFERRED (116 of 116), and its targets are types like `SupportsItems` that a function names in a signature, which is what `references` records on the other graphs. It is mapped `id-only`. The cost of the other choice is expansion: one-hop on `uses` would pull a neighbour's excerpt for every annotated parameter. If plan 04-09 wants it one-hop, that is a one-row change and nothing else in the table moves.

## 5. Verdict

The table in section 4 is grounded in 16 relation names seen across a TypeScript graph with a knowledge pass, a Python AST graph and a Go AST graph. 14 of the 16 are mapped by the plan's own classes; `inherits` and `uses` are new and are placed by the classification rule. Plan 04-09 copies section 4 as `EDGE_READ_RULES` and the default as the fallback.

Checked against the existing reader: `src/adapters/context/gsd-graph.ts` currently hard-codes `readRule: 'one-hop'` for every node handle, so it ignores `relation`; the frozen table is what changes that.

## 6. Cleanup

`/tmp/avarice-s4-spike` (both clones, both extraction outputs, the census output) was removed at the end of plan 04-02. Nothing was cloned into this checkout and no file from a clone was executed.
