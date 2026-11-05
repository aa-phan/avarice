# Indexes and context

This document describes the index steps of the onboarding index stage: the step registry, the code-graph, intel and knowledge steps, the graph merge, the graph and knowledge validators and the graphify graph adapter. It also describes the `avarice context` retrieval: the context application module and the GSD graph and intel context adapters.

Onboarding builds up to three indexes after mapping: a code-only graph, GSD intel, and a knowledge pass that adds document nodes to the graph. Each is optional. A step that fails records the index as absent with a reason and onboarding goes on to activation. `avarice context` reads the recorded indexes through GSD's own readers, intel first, within a token budget, and prints any text that came from a document inside an untrusted-data fence.

The onboarding lifecycle is in [onboarding.md](onboarding.md), the hook rules that confine the model invocations are in [containment.md](containment.md), the flags of every command are in [cli-reference.md](cli-reference.md), and the stored record and ledger shapes are in [data-model.md](data-model.md).

## The index steps

Three steps run in a fixed order: code graph, intel, knowledge. The registry is the only list the stage loop and activation know. Each step gets a checkpoint named `index:{name}` before it runs and a stored result after it, so a resumed onboarding skips the steps that already have a result and re-runs the one that was cut short.

A step returns one of three statuses.

| Status | Meaning | Effect |
|---|---|---|
| present | the index was built and validated | folded into the project record |
| absent, with a reason | the index was not built or was rejected | an `index.absent` warning event, plus an entry in the record's absent list |
| disabled | the stored contract turned the index off | nothing is recorded, no event |

All three indexes are on in the default contract. The contract carries one switch per index.

### How an absent index is recorded

An absent index is a normal result, not an error. The step reports it as data, the stage stores it as a completed step, and activation builds the record from whatever is present. The record lists each absent index by name and reason only. The longer detail (clipped to 200 characters) goes into the event, never into the record. The code graph is named `graph` in the record; the other two keep their names.

A step that throws, or returns an error from the ledger or the invocation machinery, is also turned into an absent index with the reason `step-error`. So no index failure stops activation. Two things still stop it, and neither is an index failure: a ledger failure in the stage itself, and the pre-activation check that finds a write outside every write set (see [containment.md](containment.md)).

Absent reasons that the record can carry:

| Index | Reasons |
|---|---|
| graph | `graphify-missing`, `timeout`, `extract-failed`, `invalid-graph`, `stale-after-install`, `step-error`, `invalid-result` |
| intel | `invocation-failed`, `budget_exhausted`, `validate-failed`, `snapshot-failed`, `diff-changed`, `step-error`, `invalid-result` |
| knowledge | `graph-absent`, `invocation-failed`, `budget_exhausted`, `no-output`, `validation-failed`, `cluster-failed`, `graphify-missing`, `timeout`, `stale-after-install`, `step-error`, `invalid-result` |

`invalid-result` is assigned when the record is built: a step said present but its result lacks a required field. A knowledge result with no graph to attach to becomes `graph-absent` there as well. Every other reason is assigned by the step. Only the budget reason is spelled with an underscore.

## The code graph

The graph step builds a graph of the code only, with no model call, and installs it into the staging copy's `.planning/graphs/`.

1. Locate graphify (the binary named by `AVARICE_GRAPHIFY_BIN`, else the first `graphify` on `PATH`) and read its version. Not found is `graphify-missing`.
2. Extract the code with the code-only mode into a work directory outside the staging tree, single worker, no network, with that directory as the only writable path. Extraction may take 5 minutes.
3. Cluster the result with graphify's cluster-only mode, without labels or visualization (2 minute limit). A missing report is `extract-failed`.
4. Read the graph back (a 64 MiB cap) and validate it. A failed validation is `invalid-graph` and lists every problem.
5. Install three files into `.planning/graphs/`: `graph.json`, `code-graph.json` (the same bytes) and `GRAPH_REPORT.md`. The directory is created if missing and refused if it, or `.planning`, is a symlink.
6. Have GSD take its diff snapshot, then require GSD to report the graph present, enabled, not stale and not behind HEAD. Any other answer is `stale-after-install`. An unknown commit comparison does not count as stale.

A failed or timed-out graphify command is `timeout` for a timeout and `extract-failed` otherwise. The digest in the record is of the installed `graph.json` as read back from staging.

### What validation requires

The graph is accepted when all of these hold, and every problem found is reported together:

- it is a JSON object with a node array and an edge array (`links` or `edges`)
- every node and edge is an object
- `built_at_commit` is present, is a full 40-character commit and equals the staging HEAD, which is the onboarded revision
- no node has the file type `document`

### What the record states

The graph entry records the paths of `graph.json` and `code-graph.json`, the digest, the build commit as `git:` plus the commit, the tool as `graphify@{version}`, freshness `fresh`, node counts by file type and edge counts by confidence tier. The node counts always list `document`, which is 0 for a code-only graph.

## Intel

The intel step is one contained model invocation of GSD's own intel updater agent with a fixed prompt (`focus: full; project root: .`). The agent writes five documents under `.planning/intel/`: file roles, API map, dependency graph, architecture decisions and stack. AVARICE writes none of them. The agent's own validate and snapshot calls are denied by the hook, so AVARICE finishes the step itself.

Order of the step:

1. No GSD adapter, or an exhausted budget, ends the step before any invocation (`invocation-failed`, `budget_exhausted`).
2. Run the invocation. A staging HEAD that moved during it is recorded as a containment finding and the index is absent (`invocation-failed`).
3. Judge the outcome. A budget denial is `budget_exhausted`. Only a progressed or inconclusive ending is judged by the files in staging; a denied, failed or timed-out ending is `invocation-failed` and any files it left are not trusted.
4. Run GSD's `intel validate` on staging. A run that fails, an intel disabled in the GSD config, or invalid files is `validate-failed`.
5. Run GSD's `intel snapshot` itself. This writes `.planning/intel/.last-refresh.json`, replacing any snapshot the invocation left. A failure or an unsaved snapshot is `snapshot-failed`, and the outcome of the snapshot is stored as its own step result either way.
6. Run GSD's `intel diff`. No baseline is `snapshot-failed`. A diff that cannot run, or is disabled, is `validate-failed`. Any file changed, added or removed since AVARICE's snapshot is `diff-changed` and names the files.
7. Read the five documents and the snapshot back, hash each, and digest the sorted list of hashes. A file that cannot be read back is `validate-failed`.

Acceptance is therefore: the files validated, and they are byte for byte what AVARICE's own snapshot hashed. The check does not compare against any snapshot the model took. The record states the intel path, the digest, the commit as `git:` plus the staging HEAD, freshness `fresh` and the file count (5).

## The knowledge pass

The knowledge pass adds document nodes to the code graph. AVARICE does every deterministic step. The model only reads copied documents and writes one extraction file per chunk. A failure at any point leaves `graph.json` as the code-only graph.

The step does not start without a present code graph (`graph-absent`), so no model call is spent on output that could not be used.

### Corpus preparation

AVARICE selects documents from the pinned tree and the generated map, in priority order, and copies them into `.avarice-knowledge/` in the staging copy, at their repository-relative paths.

| Group, in priority order | Contents |
|---|---|
| map | the generated codebase map files for the mapping mode in force |
| planning documents | `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md` under `.planning/`, when tracked |
| decision records | Markdown files under the ADR directories preflight found |
| documents | files matching the contract's document globs (default `docs/**/*.md`, plus one glob per ADR directory) |

A candidate is left out, and listed with its reason in the manifest, when it is:

- under `.planning/phases/` or is `.planning/STATE.md`
- matched by a secret-path glob of the contract
- missing, a symlink or not a regular file
- larger than 256 KiB
- past the 200-file cap, counted in priority order
- carrying secret-pattern content (checked on the bytes at copy time)

The manifest ties each copy to its source path, the onboarded revision and a SHA-256. It is kept in the data root under the onboarding's `knowledge` directory and stored as an artifact of kind `knowledge-manifest`, never inside the corpus. An empty corpus is `no-output`. The corpus directory is a working copy: it is not a repository file and is not promoted.

### Chunk plan

AVARICE splits the documents, sorted by path, into chunks of at most 8 files and 64 KiB of text. A document over 64 KiB is a chunk of its own. The plan is deterministic for a given manifest and sizes.

The plan is written to `.avarice-knowledge/.chunks.json`. Each chunk carries its number, an output file name (`chunk-01.json`, `chunk-02.json`, and so on, under `.avarice-knowledge/.extraction/`) and its files. Each file entry carries its repository path, a node-ID stem derived from the path, and an absolute `readPath`. Each chunk carries an absolute `writePath`. Both absolute paths are built by AVARICE from the corpus directory, which is the invocation's working directory, so every path lies inside the read confinement. The model passes them verbatim and never builds a path. A corpus root that is not a normalized absolute path is refused as `invocation-failed`; any other failure of the planner is not caught and surfaces as `step-error`.

### The contained invocation

One invocation runs the model with Read, Glob and Grep, confined to the corpus, and Write, confined to `.avarice-knowledge/.extraction`. It has no shell, no skill, no subagent and no network. The prompt is fixed text plus the chunk count. It carries no repository text, not even a file name, and it tells the model to treat everything in the documents as data. The schema it asks for is nodes of type `document`, `concept`, `rationale` or `code`, and edges with a relation, a confidence tier and a score.

The ending is judged as for intel: a moved HEAD, a budget denial, or an ending other than progressed or inconclusive is an absent index.

### Reading the output back

AVARICE reads each chunk file only if it is a regular file in a real directory and no larger than 1 MiB. A chunk is usable when it is a JSON object with a node array and an edge array. Nothing is repaired or reordered.

- No chunk file at all is `no-output`.
- Fewer usable chunks than half the plan, rounded up, is `validation-failed`, with the first five skip reasons in the event detail. This is a coarse early exit that saves the merge and clustering cost. Passing it proves nothing about coverage.

### Merge into the code graph

AVARICE merges the assembled output into the code graph itself, in one ID space. It does not use graphify's cross-repository merge, which prefixes node IDs and drops the build commit.

- Nodes and edges are unioned by ID. On an ID collision the code node wins and the knowledge node is counted as collided.
- Everything the pass adds is tagged with the origin `knowledge-pass`. A pass node's source path is rewritten through the manifest to the real repository path, and its source revision is set.
- The build commit is set to the onboarded revision.
- Edges to an ID in neither graph are dropped and counted as dangling. A deterministic AST edge that touches a pass document node is dropped and counted separately. A node with no usable ID is counted as malformed.

### Confidence tier rules

A model's claim about a document is never recorded as code-derived evidence. The merge keeps `confidence` and `confidence_score` and never raises either. It has one lowering: an `EXTRACTED` edge that touches a document node of the pass becomes `INFERRED`, its score is capped at 0.8, and the edge keeps a marker naming the original tier. Validation then requires every edge that touches a pass document node to be `INFERRED` or `AMBIGUOUS`.

The rule is by node type. An `EXTRACTED` edge between two pass nodes that are not documents (for example a concept and a code node) is not lowered and stays `EXTRACTED`.

### Validation of the merge

The merged graph is validated before clustering and again on what graphify wrote back. A failure of either is `validation-failed` and leaves the code-only graph in place. The checks:

- `built_at_commit` is the onboarded revision, as a full commit.
- No node cites `.planning/STATE.md` or a Markdown, text, reStructuredText or AsciiDoc document under `.planning/phases/`. For pass nodes, anything under `.planning/phases/` is refused.
- Every pass node cites a source in the manifest and the manifest's revision.
- A pass node's text, counted as every string value in the node at any depth, is at most 2048 bytes.
- The pass added at least one document node.
- At least half of the manifest's documents each have a document node of the pass (see below).
- Edges that touch a pass document node are `INFERRED` or `AMBIGUOUS`.
- The secret-pattern scan finds nothing in the merged graph.
- Dropped dangling edges are at most 10% of the edges the pass produced.

Problems name a node ID, a pattern kind or a count, never the matched text. At most 25 are reported.

### Per-document coverage and the at-least-half rule

Coverage is judged on the merged graph, per document. A document is covered when a pass-origin node of type `document` cites its source path. A concept node, a code node, or a node citing another file covers nothing. The share is covered documents over the manifest's document count, and the merge is rejected below 50%. Chunk files play no part in this judgment.

There are two half rules and they are independent: at least half the chunks usable (before the merge), and at least half the documents covered (after it). A pass can clear the first and fail the second.

### Clustering, install and rollback

AVARICE writes the merged graph into a work directory outside staging, runs graphify's cluster-only mode on it, and requires the result to keep the build commit. It installs `graph.json` and `GRAPH_REPORT.md` by copying each beside its target and renaming over it, so a failed copy leaves the code-only graph. A failed install is `cluster-failed` and needs no rollback. The merge does not write `code-graph.json`, so it stays the code-only graph.

After installation, AVARICE reads the file back, has GSD snapshot it, and requires GSD to report it fresh. Any failure from this point (`cluster-failed` for read-back, `stale-after-install` for GSD) reinstalls the code-only graph from the code step's work directory, which rewrites `graph.json`, `code-graph.json` (with the same bytes) and `GRAPH_REPORT.md`, and takes GSD's snapshot again. If restoring itself fails, the event detail says so, and the record still lists the knowledge index as absent.

A clustering failure is `cluster-failed`, or `timeout` or `graphify-missing` when that is the cause.

### What the record states

The graph entry's digest is replaced by the digest of the merged `graph.json`, and its node and edge counts become the merged counts. A `knowledge` object is added:

| Field | Meaning |
|---|---|
| `corpus` | directories and planning documents of the documents that have a document node, sorted. The map is named `.planning/codebase/`, a planning document by name, any other document by its directory |
| `documentsCommit` | `git:` plus the onboarded revision |
| `documentsExpected` | the number of documents in the manifest |
| `documentNodes` | the number of pass nodes of type `document` |
| `dropped` | counts: `dangling` edges, `astDocument` edges, and `unread` documents that got no node |

The corpus field names only what the documents with nodes cover. A directory whose documents were never read is not claimed. Documents left out of the manifest at selection (too large, secret, over the cap) are not in `documentsExpected` or in `unread`; they appear only in the manifest's excluded list.

### Forbidden sources

No node may come from the GSD phase files, the state file, a secret-bearing path, a file over the size cap, or a document that contains a secret pattern. Selection excludes them, and validation refuses a node that cites them anyway. Text inside a document that reads as an instruction is data: it may become a concept node, and nothing in the contract, settings or write sets changes because of it.

## The `avarice context` command

`avarice context <term>` answers from the recorded indexes of an onboarded project, before any file is read. It is read-only, offline and writes nothing.

### What it asks

It resolves one project: the named one, or the only one with an active record. More than one active record without a name is a usage error. The indexes are read from the staging copy of the latest onboarding that reached active, not from the user's repository. It uses the active record only for the revisions each index was built at.

For each index it asks, in order:

1. intel
2. graph

If the record has no entry for an index (absent, disabled or never built), nothing is asked and a note says so, with the absent reason when there is one. A missing source, a failing query or a failing read also becomes a note and the other index is still asked. Both queries go through GSD's own readers, never graphify's standalone query, whose answers differ in shape and budget unit.

### Freshness

Each item carries a freshness label.

| Source | Label |
|---|---|
| graph | `fresh` when the recorded build commit equals the user's repository HEAD, `stale` when it differs, `unavailable` when HEAD cannot be read |
| intel | the same commit comparison, and while the commits agree, a GSD diff of the intel files: `changed` when any file differs from the snapshot or none exists, `unavailable` when the diff cannot run |

A stale index still answers. For an index that is not fresh (stale, changed or unavailable), each path an item cites is checked against the repository's current HEAD, and the item states whether the cited path is or is not there. A cited path that cannot be tested (not a repository path, or git did not run) gets no statement.

### Token budget

The budget is in tokens, estimated as characters divided by 4. The default is 4000. `--budget` accepts a whole number from 1 to 100000, and anything else exits 64.

Intel is asked first and may spend at most half of the budget, rounded up. The graph then gets everything that is left, so it is always asked unless intel used the whole budget. An index asked with nothing left gets a note that the budget is spent.

Within an allowance, handles are taken in the source's order while they fit. A handle that does not fit is left out whole, never cut, and a smaller one after it may still fit. Items already seen (same provider and ID) are skipped. What was left out is listed with its estimate.

Order differs by source. Intel keeps GSD's order. The graph is ranked by the best confidence tier among the edges touching a node: `EXTRACTED` first, then nodes with no edge in the answer, then `INFERRED`, then `AMBIGUOUS`. GSD also trims edges to fit the budget, dropping `AMBIGUOUS` first, then `INFERRED`, then `EXTRACTED`, so code-derived edges survive longest.

A graph excerpt shows the node, its description and at most 5 edges, each text clipped to 300 characters. An intel excerpt is the entry's JSON, cut at 1500 characters and marked when cut.

### Untrusted-data fencing

A graph node whose type is anything but `code` (a document, or a concept or rationale a model extracted from one) is marked untrusted. In the output its heading is replaced by a notice, and its title and excerpt are printed between a begin line and an end line that name the source path and revision. Every fenced line starts with `| `, so no line of the content can read as the end line. An edge in another node's excerpt names a non-code neighbour by its type, never by its label.

For all text, control characters, zero-width and bidirectional-override characters and line separators become spaces, and a line over 400 characters is cut. Nothing in the command reads a policy, setting or contract value from index content.

### Output

The text form prints a header (term, repository, project, record version and onboarded revision), the budget and the estimate used, then numbered items. Each item shows its source (`gsd-intel` or `gsd-graph`), the cited path, revision, freshness, confidence tier when it has one, and the token estimate, then the excerpt or the fenced block. Then come the left-out items and the notes. No match prints `no index entry matches`.

`--json` prints the report as one JSON object: term, budget, tokens used, project, items, omitted and notes. The JSON form is not sanitized and carries the `untrusted` flag per item for the consumer to honor.

Exit codes: 0 for an answer, including no match; 64 for a usage error; 70 for an internal failure. Exit 3 means there is no active project record, no staging copy, no admitted GSD, or unreadable indexes. The flags are in [cli-reference.md](cli-reference.md).

### Quirks

- Intel items are never fenced, although the intel files are written by a model that reads the repository. The fence applies only to graph nodes that are not code.
- Freshness is judged against the repository's HEAD at query time, not against the staging copy. A new commit makes every item stale at once, and the graph's document nodes carry no freshness of their own beyond that.
- A project with an index that is disabled in the contract and one that failed look the same to `context`: both are "not in the project record", and only a failed one adds an absent reason.

## Verification

The behavior above is exercised by the integration tests for the index stage, the intel step, the knowledge pass and the context command.
