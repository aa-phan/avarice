# Indexes and context

This document describes the index steps of the onboarding index stage: the step registry, the code-graph, intel and knowledge steps, the graph merge, the graph and knowledge validators and the graphify graph adapter. It also describes the `avarice context` retrieval and the context pack of a run (`src/app/context.ts`, `src/app/retrieval-guard.ts`, `src/domain/retrieval-rules.ts`, `src/domain/cache-scope.ts`): the application module, the retrieval caps, and the four context adapters for GSD intel, the GSD graph, the GSD planning sections and the file search (`src/adapters/context/`).

Onboarding builds up to three indexes after mapping: a code-only graph, GSD intel, and a knowledge pass that adds document nodes to the graph. Each is optional. A step that fails records the index as absent with a reason and onboarding goes on to activation. `avarice context` asks the recorded indexes through GSD's own readers, then the planning sections and the file search, within a token budget. It finds handles first and reads only the ones it picks. It prints any text that came from a document inside an untrusted-data fence.

The onboarding lifecycle is in [onboarding.md](onboarding.md), the hook rules that confine the model invocations are in [containment.md](containment.md), the flags of every command are in [cli-reference.md](cli-reference.md), and the stored record and ledger shapes are in [data-model.md](data-model.md).

## The index steps

Three steps run in a fixed order: code graph, intel, knowledge. The registry is the only list the stage loop and activation know. Each step gets a checkpoint named `index:{name}` before it runs and a stored result after it. A resumed onboarding therefore skips the steps that already have a result and re-runs the one that was cut short.

A step returns one of three statuses.

| Status | Meaning | Effect |
|---|---|---|
| present | the index was built and validated | folded into the project record |
| absent, with a reason | the index was not built or was rejected | an `index.absent` warning event, plus an entry in the record's absent list |
| disabled | the stored contract turned the index off | nothing is recorded, no event |

All three indexes are on in the default contract. The contract carries one switch per index. The profile has a second switch for the knowledge pass, `adapters.knowledgePass`: when it is false the step is recorded as disabled before anything runs and no knowledge invocation starts. The pass is on by default.

A restricted onboarding builds the code graph only, in AVARICE's own sandboxed executor, and starts no host. Its intel and knowledge steps are recorded absent with the reason `restricted`, unless the contract turned them off, in which case they stay disabled.

### How an absent index is recorded

An absent index is a normal result, not an error. The step reports it as data, the stage stores it as a completed step, and activation builds the record from whatever is present. The record lists each absent index by name and reason only. The longer detail (clipped to 200 characters) goes into the event, never into the record. The code graph is named `graph` in the record; the other two keep their names.

A step that throws, or returns an error from the ledger or the invocation machinery, is also turned into an absent index with the reason `step-error`. So no index failure stops activation. Two things still stop it, and neither is an index failure: a ledger failure in the stage itself, and the pre-activation check that finds a write outside every write set (see [containment.md](containment.md)).

Absent reasons that the record can carry:

| Index | Reasons |
|---|---|
| graph | `graphify-missing`, `timeout`, `extract-failed`, `invalid-graph`, `stale-after-install`, `step-error`, `invalid-result` |
| intel | `invocation-failed`, `budget_exhausted`, `validate-failed`, `snapshot-failed`, `diff-changed`, `restricted`, `step-error`, `invalid-result` |
| knowledge | `graph-absent`, `invocation-failed`, `budget_exhausted`, `no-output`, `validation-failed`, `cluster-failed`, `graphify-missing`, `timeout`, `stale-after-install`, `restricted`, `step-error`, `invalid-result` |

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

### Refreshing the code graph

An onboarding of a project that already has an active record may refresh the graph instead of building it new, when the refresh plan chose an incremental refresh (see [onboarding.md](onboarding.md#refresh)) and recorded every changed path. The extraction still runs over the whole tree, because a graph of a path subset loses the edges that leave the subset, and `graphify update` is never used. The previous graph is read from the staging copy of the active record and validated as any code graph is. The new extraction is applied to it. The nodes of each changed path are replaced by the new extraction's, and the nodes of a changed path that is no longer a regular file are dropped. The step's result carries a `refresh` block with the mode `incremental`, the revision it started from, the number of changed and deleted paths, the files extracted and the node-level difference.

The build goes on whole when anything is missing, and the block then says `whole` with the reason. Something is missing when the record names no previous graph, when the previous graph cannot be read or is not usable, or when the changed paths cannot be examined. The previous graph can add information and never decides what the new graph is.

### What validation requires

The graph is accepted when all of these hold, and every problem found is reported together:

- it is a JSON object with a node array and an edge array (`links` or `edges`)
- every node and edge is an object
- `built_at_commit` is present, is a full 40-character commit and equals the staging HEAD, which is the onboarded revision
- no node has the file type `document`

### What the record states

The graph entry records the paths of `graph.json` and `code-graph.json` and the digest. It records the build commit as `git:` plus the commit, and the tool as `graphify@{version}`. It also records freshness `fresh`, node counts by file type and edge counts by confidence tier. The node counts always list `document`, which is 0 for a code-only graph.

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
| GSD planning files | the Markdown files under `.planning/phases/` and `.planning/STATE.md`, when tracked and inside the contract's read set |

The phase files and the state file are documents of the corpus like any other. They change often, which is why a refresh extracts only the documents whose content changed.

A candidate is left out, and listed with its reason in the manifest, when it is:

- a GSD planning file the contract's read set does not allow (reason `outside-read`)
- matched by a secret-path glob of the contract
- missing, a symlink or not a regular file
- larger than 256 KiB
- past the 200-file cap, counted in priority order
- past the cost cap (see below)
- carrying secret-pattern content (checked on the bytes at copy time)

#### The cost cap

One invocation has to fit its own cost cap. The classifier needs every chunk of the plan. A session that stops early, with chunks unwritten, ends `no_progress` and the whole pass is lost. A session that overruns its cap ends `budget_exhausted` and its written chunks are discarded. The corpus is therefore limited to the chunks one invocation can pay for. The cost of a session over n chunks is modelled as a power law,

`session cost(n) = 0.0255 x n^1.376` USD,

and the limit is the largest n whose modelled cost fits two thirds of the cost cap, never fewer than one:

`floor((cost cap x 2/3 / 0.0255)^(1 / 1.376))` chunks.

The cost cap is the one the knowledge invocation would be granted: the contract's per-invocation cost cap, or what is left of the run's cost budget when that is smaller. It is read from the contract, not from any one run's authorization. The model is fitted to measured sessions. A session over 6 chunks cost 0.30 USD, and two sessions over 12 chunks cost 0.75 and 0.81 USD, the second of them ending 0.006 USD over a 0.8 USD cap. Doubling the chunks multiplied the cost by about 2.6, not 2, because every chunk read makes the following turns dearer. The exponent is the logarithm to base 2 of the ratio of the 12-chunk mean (0.78 USD) to the 6-chunk cost, and the factor is set so the curve passes through the 6-chunk point. The planned share of two thirds leaves a third of the cap free for the spread between sessions (the two 12-chunk sessions differ by 7 percent). The limit is 9 chunks at a cap of 0.8 USD, 15 chunks at 1.6 USD, and 23 chunks at the 3.0 USD default of the onboarding contract. At 9 chunks the model gives 0.52 USD, and the dearest measured session scaled to 9 chunks is 0.54 USD. It never falls as the cap rises.

Candidates are taken in the priority order of the table, and a document is kept while the documents kept so far, packed into chunks as described below, plan to no more chunks than the limit. The first document that does not fit, and every later document the other rules would have kept, is left out as `cost-cap`. The kept documents are therefore always a prefix of the priority order: the map, the planning documents, the decision records and the documents are kept before any GSD phase file. A corpus that fits the limit is selected exactly as without it.

The omission is stated, not silent. Each left-out document is in the manifest's excluded list with the reason `cost-cap`, and the manifest, and its digest, list only the documents that were sent. The `knowledge` object of the record gains a `corpusCap` object when the cap left something out (see "What the record states"). A refresh works over the kept set. The documents whose content changed among those kept go to the model, and the others are cache hits. A document that was left out stays left out until the limit admits it.

The pass can be switched off for a profile with `adapters.knowledgePass`. It is on by default: an evaluation against a code-only arm found it no less successful and cheaper in run tokens, though dearer to onboard (see [ADR-015](../decisions/ADR-015-knowledge-pass-default.md)).

The manifest ties each copy to its source path, the onboarded revision and a SHA-256. It is kept in the data root under the onboarding's `knowledge` directory and stored as an artifact of kind `knowledge-manifest`, never inside the corpus. An empty corpus is `no-output`. The corpus directory is a working copy: it is not a repository file and is not promoted.

### Refreshing the knowledge pass

An onboarding of a project with an active record runs the pass over the documents that changed. A document is extracted again when it is new, when its content digest differs from the earlier pass's, or when the earlier graph has no document node for it. Every other document is a cache hit and keeps the nodes the earlier pass made for it, and the corpus the model reads holds the documents to extract and no other. When nothing changed no invocation starts and no unit is reserved: the earlier pass's document nodes are joined to the new code graph. The step's result carries a `refresh` block with the mode `incremental`, the changed documents and the number of cache hits, and the counts of nodes and edges retained and edges dropped by the merge. The pass runs whole when the earlier pass cannot be used, and the block then says `whole` with the reason. The earlier pass cannot be used in two cases. One is that the record holds no knowledge pass or no corpus manifest. The other is that the earlier manifest or merged graph cannot be read, is not what the record digests, or is not a graph.

### Chunk plan

AVARICE splits the documents, sorted by path, into chunks of at most 8 files and 64 KiB of text. A document over 64 KiB is a chunk of its own. The plan is deterministic for a given manifest and sizes. The cost cap above counts chunks with this same packing, so the plan never has more chunks than the limit.

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

After installation, AVARICE reads the file back, has GSD snapshot it, and requires GSD to report it fresh. Any failure from this point (`cluster-failed` for read-back, `stale-after-install` for GSD) reinstalls the code-only graph from the code step's work directory. That rewrites `graph.json`, `code-graph.json` (with the same bytes) and `GRAPH_REPORT.md`, and takes GSD's snapshot again. If restoring itself fails, the event detail says so, and the record still lists the knowledge index as absent.

A clustering failure is `cluster-failed`, or `timeout` or `graphify-missing` when that is the cause.

### What the record states

The graph entry's digest is replaced by the digest of the merged `graph.json`, and its node and edge counts become the merged counts. A `knowledge` object is added:

| Field | Meaning |
|---|---|
| `corpus` | directories and planning documents of the documents that have a document node, sorted. The map is named `.planning/codebase/`, a planning document by name, any other document by its directory |
| `manifestDigest` | the artifact digest of the manifest of the whole corpus, which a refresh reads back as the earlier pass's manifest |
| `documentsCommit` | `git:` plus the onboarded revision |
| `documentsExpected` | the number of documents in the manifest |
| `documentNodes` | the number of pass nodes of type `document` |
| `dropped` | counts: `dangling` edges, `astDocument` edges, and `unread` documents that got no node |
| `corpusCap` | present only when the cost cap left documents out: `perInvocationCapUsd` (the cap the limit came from), `chunkLimit`, `chunks` (the chunks the kept documents plan to), `documentsKept`, `documentsOmitted`, and `omitted` (the areas of the omitted documents, named as `corpus` names them, at most 50, with `omittedMoreAreas` for the rest) |

The corpus field names only what the documents with nodes cover. A directory whose documents were never read is not claimed. Documents left out of the manifest at selection (too large, secret, over the file cap, over the cost cap) are not in `documentsExpected` or in `unread`. They appear in the manifest's excluded list, and the ones the cost cap left out are also counted in `corpusCap`.

### Forbidden sources

No node may come from a secret-bearing path, a file over the size cap, or a document that contains a secret pattern. Selection excludes them, and validation refuses a node that cites them anyway. Selection also excludes a GSD planning file the contract's read set does not allow. The GSD phase files and the state file are documents of the corpus and may have document nodes; a node the pass did not add to the graph may not cite them. Text inside a document that reads as an instruction is data: it may become a concept node, and nothing in the contract, settings or write sets changes because of it.

## The `avarice context` command

`avarice context <term>` answers from the recorded indexes of an onboarded project, before any file is read. It is read-only, offline and writes nothing. The same assembly builds the context pack of a run, with the run's contract bounding what it may return.

### The sources

A pack draws on up to four sources. Each answers in two steps, a find that returns handles with no text and a read that returns the text of the handles that were picked. The profile selects which sources exist (`adapters.context`, all four by default, none allowed); each one's descriptor is recorded in `adapter_configs` as `context-<source>`.

| Source | What it reads | Reference it gives |
|---|---|---|
| `gsd-intel` | the intel documents, through GSD's own reader | kind `intel-entry`, ID `<intel file>#<key>`, the intel index's revision, scope the intel file |
| `gsd-graph` | the graph, through GSD's own reader, never graphify's standalone query | kind `graph-node`, ID the node ID, the graph's build revision, scope the node's source path (the graph file when it has none) |
| `gsd-planning` | whole sections of `.planning/PROJECT.md` and `REQUIREMENTS.md` in the staging copy and, in the directory of the phase GSD marks in progress, that phase's `CONTEXT.md`, `PLAN.md` and `LEARNINGS.md` | kind `section`, ID `<file>#<heading slug>`, revision `gsd-state:sha256:<hex>` of GSD's state file (`gsd-state:absent` without one), scope the file |
| `git-files` | a fixed-string search of the tracked files at one revision of the repository, or of the run's clone, inside the read scope; committed objects only, so an uncommitted edit or an untracked secret cannot answer | kind `snippet`, ID `<path>:<line>`, revision `git:<commit>`, scope the path |

The planning sections are the document fallback. A section is a heading to the next heading, and a handle needs every word of the term (at most 8 words and 200 characters). At most 50 handles are returned, and a section is cut at 6000 characters. The file search returns at most 5 hits per file and never reads a blob over 1 MiB. A snippet is the hit line with up to 20 lines before and 19 after, at most 1500 characters. Planning and file-search text is untrusted and printed fenced, like a document node of the graph. The planning sections open each file without following a link and read only a regular file of at most 256 KiB.

### How a pack is assembled

The assembly asks every source for handles first and reads only what it picks, in three steps.

1. **Find.** The sources are asked in the order intel, graph, planning sections, file search. Intel and the planning sections may use at most half of the budget, rounded up, and the graph and the file search the whole of it. The planning sections are skipped, with a note, when the graph already returned a document node for the term. Each find is one search against the retrieval caps, and so is each further page of a source that declares itself paged (no local source does). A find that outlasts `queryTimeoutMs` is abandoned with no side effect. A source returns at most `indexEntries` handles and `searchHits` hits; a cut is a note. A handle whose access was revoked is dropped before anything is read and listed as omitted with the reason `access_revoked`.
2. **Rank and pick.** Handles are ranked by source order, then by the best confidence tier among the edges that led to them. The tiers rank `EXTRACTED` first, then a handle with no edge, then `INFERRED`, then `AMBIGUOUS`. The last key is the order the source returned them. A handle already seen under the same provider, kind and ID is dropped. The rest are picked first-fit. A handle that does not fit the budget, or its source's share, is left out whole and listed as omitted with its estimate. A smaller one after it may still fit. At most `snippets` snippets are picked for one pack.
3. **Read.** Each source reads its picked handles in one call. An answer is cut at `returnedBytes` bytes of excerpt text, the later excerpts keeping only a marker. A source that refuses the read as unauthenticated or denied has revoked what it was asked for: none of it is in the pack and each handle is listed as omitted with `access_revoked`. A stale item that cites a path is checked against the repository's current HEAD, and an item whose path is gone has its text replaced by a one-line marker and a note.

The pack's total is the sum of the picked handles' estimates, a token being four characters. The report carries the term, budget, tokens used, the project (with `restricted` when its map was made by a restricted onboarding), the items, the omitted handles and the notes.

### What a read adds from the graph

A graph node's neighbours enter its excerpt by the relation of the edge that leads to them. The table is the one measured on real graphs. A relation it does not list, including one a later graphify adds, is `id-only`, so an unknown edge never pulls a neighbour's content into a pack.

| Rule | Relations | What the excerpt gets |
|---|---|---|
| descendants | `contains`, `method` | the child, and its own children down to a depth of 3, each as an indented line |
| one-hop | `calls`, `indirect_call`, `imports`, `imports_from`, `extends`, `inherits`, `implements`, `re_exports`, `dynamic_import` | the neighbour's label and source file |
| id-only | `references`, `uses`, `cites`, `rationale_for`, `conceptually_related_to`, and any other | the neighbour's ID |

A containment edge is followed down only from the parent; seen from the child it names the parent like a dependency. A node's own rule is the widest of its edges' rules. An excerpt holds the node line, its description and at most 5 edge lines, each text clipped to 300 characters, ordered by confidence tier. A neighbour that is not code is named by its type and never by its label, because its text is data. An intel excerpt is the entry's JSON, cut at 1500 characters and marked when cut.

### Reuse and access

A retried item's new pack may keep an item from the pack it built before, without reading it again, when the cache rule holds. The rule holds when all of these are true:

- the profile is the same;
- the access scope is the same (a digest of the read lists, exclusions and secret globs the pack was built under);
- the source is still at the revision the item was read at;
- the reference is not revoked.

The item carries `profile` and `accessScope` for that reason. Everything else is read again, and the report says which was which. The ledger keeps references and never excerpt text, so a supervisor that starts afresh reuses nothing.

A reference the run recorded as `access_revoked` never reaches a new pack: its handle is listed as omitted. Each context source judges a reference against the repository as it is now, and a resume uses that judgment (see [runs.md](runs.md#reference-refresh-on-resume)).

### Manual excerpts

The excerpts the owner recorded with `context add` follow the index items in a run's pack, in the order of their references, first-fit within what is left of the budget. They are untrusted and cited by the title the owner gave and the digest of the file. They are redacted again on the way out, so a credential learned after the excerpt was stored does not reach a prompt. An excerpt that does not fit, cannot be read or is not valid UTF-8 is left out with a note and never stops the run.

### What it asks

It resolves one project: the named one, or the only one with an active record. More than one active record without a name is a usage error. The indexes are read from the staging copy of the latest onboarding that reached active, not from the user's repository. It uses the active record only for the revisions each index was built at; the planning sections and the file search have no index in the record and are given the onboarded revision.

If the record has no entry for an index (absent, disabled or never built), nothing is asked of it and a note says so, with the absent reason when there is one. A missing source, a failing query or a failing read also becomes a note and the other sources are still asked.

### Freshness

Each item carries a freshness label.

| Source | Label |
|---|---|
| graph | `fresh` when the recorded build commit equals the user's repository HEAD, `stale` when it differs, `unavailable` when HEAD cannot be read |
| intel | the same commit comparison, and while the commits agree, a GSD diff of the intel files: `changed` when any file differs from the snapshot or none exists, `unavailable` when the diff cannot run |
| planning sections | `fresh` while GSD's state file has the digest the reference was recorded against, `stale` once GSD has moved the state on |
| file search | `fresh` at the revision it searched |

A stale index still answers. For an index that is not fresh (stale, changed or unavailable), each path an item cites is checked against the repository's current HEAD. The item states whether the cited path is or is not there. A cited path that cannot be tested (not a repository path, or git did not run) gets no statement.

On a refresh by a resume, `stale` means the index was built before the repository's current HEAD. `changed` means the reference's revision is no longer the index's, `deleted` that the cited path is gone from HEAD, `access_revoked` that the source refuses the reference, and `unavailable` that nothing could be judged. The rules of the run are in [runs.md](runs.md#reference-refresh-on-resume).

### Token budget

The budget is in tokens, estimated as characters divided by 4. The default is the profile's `limits.contextTokens`, 24000 unless the profile sets it. `--budget` accepts a whole number from 1 to 100000, and anything else exits 64. A run's pack is bound by the smaller of that ceiling and the room the 32 KiB prompt leaves (see [config-reference.md](config-reference.md#the-context-pack-budget)).

Within an allowance, handles are taken first-fit as described above, and what was left out is listed with its estimate. GSD also trims the edges of a graph answer to fit its own budget, dropping `AMBIGUOUS` first, then `INFERRED`, then `EXTRACTED`, so code-derived edges survive longest.

### Untrusted-data fencing

A graph node whose type is anything but `code` (a document, or a concept or rationale a model extracted from one), a planning section, a file-search snippet and a manual excerpt are marked untrusted. In the output the heading is replaced by a notice, and the title and excerpt are printed between a begin line and an end line that name the source path and revision. Every fenced line starts with `| `, so no line of the content can read as the end line. An edge in another node's excerpt names a non-code neighbour by its type, never by its label.

For all text, control characters, zero-width and bidirectional-override characters and line separators become spaces, and a line over 400 characters is cut. Nothing in the command reads a policy, setting or contract value from index content.

### Output

The text form prints a header (term, repository, project, record version and onboarded revision), the budget and the estimate used, then numbered items. Each item shows its source (`gsd-intel`, `gsd-graph`, `gsd-planning` or `git-files`), the cited path, revision, freshness, confidence tier when it has one, and the token estimate, then the excerpt or the fenced block. Then come the left-out items and the notes. No match prints `no index entry matches`.

`--json` prints the report as one JSON object: term, budget, tokens used, project, items, omitted and notes. The JSON form is not sanitized and carries the `untrusted` flag per item for the consumer to honor.

Exit codes: 0 for an answer, including no match; 64 for a usage error; 70 for an internal failure. Exit 3 means there is no active project record, no staging copy, no admitted GSD, or unreadable indexes. The flags are in [cli-reference.md](cli-reference.md).

### Quirks

- Intel items are never fenced, although the intel files are written by a model that reads the repository. The fence applies to graph nodes that are not code and to the other three sources.
- Freshness is judged against the repository's HEAD at query time, not against the staging copy. A new commit makes every item stale at once, and the graph's document nodes carry no freshness of their own beyond that.
- A project with an index that is disabled in the contract and one that failed look the same to `context`. Both are "not in the project record", and only a failed one adds an absent reason.
- The planning sections and the file search need no index, so a project whose graph and intel are both absent still answers from them.
- A source that the profile left out of `adapters.context` is never asked, and an empty list gives a pack with no items.
- A reference is recorded with its revision when a pack is built and a re-recorded reference replaces its row, so a reference's revision is the one of its last pack, not of its first.

## Verification

The behavior above is exercised by the integration tests for the index stage, the intel step, the knowledge pass and the context command.
