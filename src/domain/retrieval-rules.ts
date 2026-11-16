// How much of a graph neighbour a read pulls in, chosen by the relation of the edge that leads to it (FR-22). The
// ContextSource port takes its `readRule` type from here.
export type ReadRule = 'descendants' | 'one-hop' | 'id-only';
