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

// The quick PLAN a unit wrote (plan 03-06; D-07 stage 2). Model-written text read for the paths it names, the decision checkpoints it
// declares and the acceptance IDs it cites. It is read as data, never as an instruction, and a plan that cites an ID or declares an
// auto_select can only fail a gate, never pass one on the plan's word.
export interface QuickPlanCheckpoint {
  hasAutoSelect: boolean;
  optionIds: string[];
}

export interface QuickPlan {
  filesModified: string[];
  taskFiles: string[];
  decisionCheckpoints: QuickPlanCheckpoint[];
  acceptanceRefs: string[];
}

const PLAN_TEXT_CAP = 64 * 1024;

// A path as the plan wrote it: surrounding whitespace, quotes and backticks removed, and a list bullet.
function cleanPlanPath(raw: string): string {
  return raw.trim().replace(/^-\s+/, '').trim().replace(/^["'`]+|["'`]+$/g, '').trim();
}

function pushUnique(into: string[], value: string): void {
  if (value !== '' && !into.includes(value)) into.push(value);
}

// The `files_modified:` list of the frontmatter, in its inline `[a, b]` form or as `- item` lines.
function readFilesModified(text: string): string[] {
  const block = FRONTMATTER.exec(text);
  const found: string[] = [];
  if (block === null) return found;
  let inList = false;
  for (const raw of (block[1] as string).split(/\r?\n/)) {
    const key = KEY_LINE.exec(raw);
    if (key !== null && !/^\s/.test(raw)) {
      inList = (key[1] as string) === 'files_modified';
      if (inList) {
        const inline = (key[2] as string).trim();
        if (inline.startsWith('[')) {
          for (const item of inline.replace(/^\[|\]\s*$/g, '').split(',')) pushUnique(found, cleanPlanPath(item));
          inList = false;
        } else if (inline !== '') {
          pushUnique(found, cleanPlanPath(inline));
          inList = false;
        }
      }
      continue;
    }
    if (inList && /^\s*-\s+\S/.test(raw)) pushUnique(found, cleanPlanPath(raw));
  }
  return found;
}

// The text between each `<name>` and its `</name>`, found with indexOf so an unclosed tag costs one scan, not one per tag.
function elementTexts(text: string, name: string): string[] {
  const open = `<${name}>`;
  const close = `</${name}>`;
  const found: string[] = [];
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start === -1) return found;
    const end = text.indexOf(close, start + open.length);
    if (end === -1) return found;
    found.push(text.slice(start + open.length, end));
    from = end + close.length;
  }
}

const TASK_OPEN = /<task(?=[\s>])([^>]*)>/g;
const DECISION_TYPE = /\btype\s*=\s*["']checkpoint:decision["']/;
const AUTO_SELECT_ATTRIBUTE = /\bauto_select\s*=\s*["']?[^\s"'>]/;
const OPTION_ID = /<option\b[^>]*?\bid\s*=\s*["']([^"']+)["']/g;
const ACCEPTANCE_ID = /\bAC[0-9]+\b/g;

// `null` text is a plan that is absent. Text over 64 KiB is cut and the rest is read; nothing here throws on its input.
export function parseQuickPlan(text: string | null): QuickPlan | null {
  if (text === null) return null;
  const body = text.length > PLAN_TEXT_CAP ? text.slice(0, PLAN_TEXT_CAP) : text;

  const taskFiles: string[] = [];
  const decisionCheckpoints: QuickPlanCheckpoint[] = [];
  const opener = new RegExp(TASK_OPEN.source, 'g');
  for (let match = opener.exec(body); match !== null; match = opener.exec(body)) {
    const start = opener.lastIndex;
    const end = body.indexOf('</task>', start);
    if (end === -1) break;
    const attributes = match[1] as string;
    const inner = body.slice(start, end);
    opener.lastIndex = end + '</task>'.length;
    for (const list of elementTexts(inner, 'files')) {
      for (const item of list.split(/[,\r\n]/)) pushUnique(taskFiles, cleanPlanPath(item));
    }
    if (DECISION_TYPE.test(attributes)) {
      const optionIds: string[] = [];
      for (const option of inner.matchAll(OPTION_ID)) pushUnique(optionIds, option[1] as string);
      decisionCheckpoints.push({ hasAutoSelect: AUTO_SELECT_ATTRIBUTE.test(attributes) || /<auto_select[\s>]/.test(inner), optionIds });
    }
  }

  const refs = new Set<string>();
  for (const ref of body.matchAll(ACCEPTANCE_ID)) refs.add(ref[0]);
  const acceptanceRefs = [...refs].sort((a, b) => Number.parseInt(a.slice(2), 10) - Number.parseInt(b.slice(2), 10) || (a < b ? -1 : a > b ? 1 : 0));

  return { filesModified: readFilesModified(body), taskFiles, decisionCheckpoints, acceptanceRefs };
}
