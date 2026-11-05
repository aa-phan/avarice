// The records a GSD quick unit leaves under `.planning/quick/<id>/` (plan 02-13; AUT-7, T-02-43, T-02-44). Pure: the caller reads the
// text from the clone. Everything here is model-written data: it is read for the facts a gate needs (the VERIFICATION `status:` line,
// how many overrides it applied, how many node-repair PRUNE entries a record states) and never as an instruction. A parsed status can
// block a gate (it is an entry condition of G2) and can never pass one on its own.
import { matchesGlob } from './glob.ts';

export type QuickVerificationStatus = 'passed' | 'gaps_found' | 'human_needed' | 'missing';

export interface QuickVerification {
  status: QuickVerificationStatus;
  // `overrides_applied: N` or the number of entries under `overrides:`, whichever is larger.
  overrides: number;
}

export const QUICK_DIR_GLOB = '.planning/quick/**';

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/;

// The first `---` block of the text as top-level `key: value` pairs plus the list-item count under each key that has none.
function readFrontmatter(text: string): { values: Map<string, string>; listItems: Map<string, number> } {
  const values = new Map<string, string>();
  const listItems = new Map<string, number>();
  const block = FRONTMATTER.exec(text);
  if (block === null) return { values, listItems };
  let current: string | null = null;
  for (const raw of (block[1] as string).split(/\r?\n/)) {
    const key = KEY_LINE.exec(raw);
    if (key !== null && !/^\s/.test(raw)) {
      current = key[1] as string;
      values.set(current, (key[2] as string).trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    if (current !== null && /^\s*-\s+\S/.test(raw)) listItems.set(current, (listItems.get(current) ?? 0) + 1);
  }
  return { values, listItems };
}

// `null` text is a record that is absent. A status the parser does not know is `gaps_found` (fail closed): it blocks G2.
export function parseQuickVerification(text: string | null): QuickVerification {
  if (text === null) return { status: 'missing', overrides: 0 };
  const { values, listItems } = readFrontmatter(text);
  const raw = (values.get('status') ?? '').toLowerCase();
  const status: QuickVerificationStatus = raw === 'passed' || raw === 'human_needed' || raw === 'gaps_found' ? raw : 'gaps_found';
  const applied = Number.parseInt(values.get('overrides_applied') ?? '0', 10);
  const listed = listItems.get('overrides') ?? 0;
  return { status, overrides: Math.max(Number.isFinite(applied) && applied > 0 ? applied : 0, listed) };
}

// Node-repair PRUNE entries a unit record states (workflows/node-repair.md logs `[Node Repair - PRUNE] Task X skipped: ...`).
export function countPruneEntries(text: string | null): number {
  if (text === null) return 0;
  return (text.match(/\[Node Repair - PRUNE\]/g) ?? []).length;
}

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export type QuickRecordKind = 'summary' | 'verification' | 'plan' | 'other';

// Which record a path under `.planning/quick/` is, by the GSD file names (`<id>-SUMMARY.md`, `<id>-VERIFICATION.md`, `<id>-PLAN.md`).
export function quickRecordKind(path: string): QuickRecordKind | null {
  if (!matchesGlob(path, QUICK_DIR_GLOB)) return null;
  const name = baseName(path);
  if (name.endsWith('SUMMARY.md')) return 'summary';
  if (name.endsWith('VERIFICATION.md')) return 'verification';
  if (name.endsWith('PLAN.md')) return 'plan';
  return 'other';
}

// Built from a string of escapes so the source holds no invisible character: C0 and C1 controls except the line feed, zero-width and
// bidirectional marks, the Unicode line and paragraph separators and the bidirectional isolates.
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]', 'g');

// Model text as stored data (T-02-44): control, zero-width and bidirectional characters are removed (the line feed stays), then the text
// is cut to `max` characters.
export function storedText(text: string, max: number): string {
  const clean = text.replace(CONTROL, '');
  return clean.length <= max ? clean : clean.slice(0, max);
}
