// Brief parser (FR-1). Pure: the caller reads the file, decodes it with a UTF-8 TextDecoder and passes the text. A brief
// is untrusted data: it is parsed, never interpreted as an instruction to AVARICE, and every field is validated (RC-2).
//
// Format: optional frontmatter between a first line `---` and the next `---` holding `key: value` scalars (no nesting,
// no lists; unknown keys are refused), then the sections `## Behavior`, `## Acceptance criteria`, `## Exclusions`,
// `## Write` and `## Target checks`. An acceptance line reads `- AC1: text | verifiedBy: check:unit, test:name`.
import { digestOf } from './digest.ts';
import { CHECK_NAME_PATTERN, validateGlob } from './conventions.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type BriefSize = 'small' | 'medium' | 'large';
export type BriefModel = 'haiku' | 'sonnet' | 'opus';

export interface BriefAcceptance {
  id: string;
  text: string;
  verifiedBy: string[];
}

// A work item the brief declares (D-06). `acceptance` holds the IDs of the criteria this item owns; `spec` fields a brief
// leaves out are derived by the compiler and named in the compiled item's `spec.derived`.
export interface BriefItem {
  id: string;
  title: string;
  dependsOn: string[];
  size?: BriefSize;
  model?: BriefModel;
  acceptance: string[];
  spec?: { files?: string[]; symbols?: string[]; configKeys?: string[]; references?: string[] };
}

export interface BriefSource {
  kind: 'file' | 'inline';
  id: string;
}

export interface Brief {
  title: string;
  behavior: string;
  acceptance: BriefAcceptance[];
  exclusions: string[];
  // Absent when the brief has no Write section: the compiler then uses the conventions' write set.
  write?: string[];
  targetChecks: string[];
  size?: BriefSize;
  model?: BriefModel;
  baseRevision?: string;
  expectedDecisions?: number;
  // Absent when the brief has no `items` frontmatter: the compiler then emits the single item A.
  items?: BriefItem[];
  source: BriefSource;
  digest: string;
}

export const BRIEF_LIMITS = {
  bytes: 65536,
  lineChars: 4096,
  acceptance: 20,
  titleChars: 200,
  listItems: 128,
  expectedDecisionsMax: 1000,
  items: 20,
} as const;

const SIZES: readonly string[] = ['small', 'medium', 'large'];
const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus'];
const FRONTMATTER_KEYS: readonly string[] = ['title', 'size', 'model', 'baseRevision', 'expectedDecisions', 'items'];
const SECTIONS: Readonly<Record<string, string>> = {
  behavior: 'behavior',
  'acceptance criteria': 'acceptance',
  exclusions: 'exclusions',
  write: 'write',
  'target checks': 'targetChecks',
};
const VERIFIED_BY = /^(?:check|test|diff):\S(?:.*\S)?$/;
// `decision:<key>` marks a criterion whose choice belongs to the owner. It never satisfies acceptance alone: G0 wants a
// check, test or diff reference beside it, and a later gate uses the key to catch a silent pick.
const DECISION_REF = /^decision:[a-z][a-z0-9-]{0,39}$/;
const ITEM_KEYS: readonly string[] = ['id', 'title', 'dependsOn', 'size', 'model', 'acceptance', 'spec'];
const SPEC_KEYS: readonly string[] = ['files', 'symbols', 'configKeys', 'references'];
const ITEM_ID = /^[A-Z][A-Za-z0-9_-]{0,31}$/;

// Control characters other than tab and newline (a lone CR survives CRLF normalization and is refused here).
const BAD_CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/;

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

// Bullet items of a section. A non-blank line that is not a bullet is a refusal, so prose cannot hide in a list section.
function bullets(field: string, lines: readonly string[]): Result<string[]> {
  const items: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = /^[-*]\s+(.*)$/.exec(trimmed);
    if (!match) return invalid(field, `expected a "- item" list, found ${JSON.stringify(trimmed.slice(0, 60))}`);
    items.push((match[1] as string).replace(/^`(.*)`$/, '$1').trim());
  }
  if (items.length > BRIEF_LIMITS.listItems) return invalid(field, `at most ${BRIEF_LIMITS.listItems} items`);
  return ok(items);
}

// The lines of an acceptance section (`- AC1: text | verifiedBy: check:unit, test:name`) as criteria. Exported so the amend command
// reads an acceptance file with the parser the brief uses: one syntax, one set of refusals, at most 20 criteria.
export function parseAcceptanceSection(lines: readonly string[]): Result<BriefAcceptance[]> {
  const items = bullets('brief.acceptance', lines);
  if (!items.ok) return items;
  if (items.value.length > BRIEF_LIMITS.acceptance) {
    return invalid('brief.acceptance', `at most ${BRIEF_LIMITS.acceptance} acceptance criteria`);
  }
  const out: BriefAcceptance[] = [];
  const seen = new Set<string>();
  for (const item of items.value) {
    const match = /^([^:\s]+):\s*(.*)$/.exec(item);
    if (!match) return invalid('brief.acceptance', `expected "AC<n>: text | verifiedBy: ...", found ${JSON.stringify(item.slice(0, 60))}`);
    const id = match[1] as string;
    if (!/^AC[0-9]+$/.test(id)) return invalid('brief.acceptance.id', `${JSON.stringify(id)} must match AC<digits>`);
    if (seen.has(id)) return invalid('brief.acceptance.id', `duplicate acceptance ID ${id}`);
    seen.add(id);
    const split = /^(.*?)\s*\|\s*verifiedBy:\s*(.*)$/.exec(match[2] as string);
    const text = (split ? (split[1] as string) : (match[2] as string)).trim();
    if (text === '') return invalid('brief.acceptance', `${id} has no text`);
    const verifiedBy: string[] = [];
    if (split) {
      for (const part of (split[2] as string).split(',')) {
        const ref = part.trim();
        if (ref === '') continue;
        if (!VERIFIED_BY.test(ref) && !DECISION_REF.test(ref)) {
          return invalid(
            'brief.acceptance.verifiedBy',
            `${id}: ${JSON.stringify(ref)} must be check:<name>, test:<id>, diff:<rule> or decision:<key> (a lower-case key of up to 40 letters, digits and dashes)`,
          );
        }
        verifiedBy.push(ref);
      }
    }
    out.push({ id, text, verifiedBy });
  }
  return ok(out);
}

// `items` is the one key whose value is a JSON array that may continue on following lines indented by two spaces; the
// continuation lines are joined to it with a newline. Any other indented line keeps the one-`key: value`-per-line rule.
const CONTINUED_KEY = 'items';

function readFrontmatter(lines: readonly string[]): Result<Record<string, string>> {
  const front: Record<string, string> = {};
  let last: string | undefined;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (last === CONTINUED_KEY && line.startsWith('  ')) {
      front[CONTINUED_KEY] = `${front[CONTINUED_KEY] as string}\n${line.trim()}`;
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*)$/.exec(line);
    if (!match) return invalid('brief.frontmatter', `expected "key: value", found ${JSON.stringify(line.slice(0, 60))}`);
    const key = match[1] as string;
    if (!FRONTMATTER_KEYS.includes(key)) return invalid(`brief.frontmatter.${key}`, 'unknown frontmatter key');
    if (Object.hasOwn(front, key)) return invalid(`brief.frontmatter.${key}`, 'repeated frontmatter key');
    front[key] = (match[2] as string).trim().replace(/^(["'])(.*)\1$/, '$2');
    last = key;
  }
  return ok(front);
}

// The `items` frontmatter value: one JSON array of item objects (validated further by readItems).
function parseItemsJson(raw: string): Result<unknown> {
  try {
    return ok(JSON.parse(raw) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalid('brief.items', `is not valid JSON: ${message.slice(0, 120)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const shown = (text: string): string => JSON.stringify(text.slice(0, 40));

// A spec list that is free text (symbols, config keys, references): each entry one short line.
function readSpecList(field: string, raw: unknown): Result<string[]> {
  if (!Array.isArray(raw)) return invalid(field, 'must be an array of text');
  if (raw.length > BRIEF_LIMITS.listItems) return invalid(field, `at most ${BRIEF_LIMITS.listItems} entries`);
  const out: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry !== 'string' || entry.trim() === '' || entry.length > BRIEF_LIMITS.titleChars || BAD_CONTROL.test(entry)) {
      return invalid(field, `every entry must be 1 to ${BRIEF_LIMITS.titleChars} characters of text with no control character`);
    }
    out.push(entry);
  }
  return ok(out);
}

function readItemSpec(at: string, raw: unknown): Result<NonNullable<BriefItem['spec']>> {
  if (!isPlainObject(raw)) return invalid(`${at}.spec`, 'must be an object');
  const spec: NonNullable<BriefItem['spec']> = {};
  for (const key of Object.keys(raw)) {
    if (!SPEC_KEYS.includes(key)) return invalid(`${at}.spec.${key.slice(0, 40)}`, `unknown spec key; the spec keys are ${SPEC_KEYS.join(', ')}`);
  }
  if (Object.hasOwn(raw, 'files')) {
    const field = `${at}.spec.files`;
    const files = raw.files;
    if (!Array.isArray(files) || files.length === 0) {
      return invalid(field, 'must be a non-empty array of globs: an item must be allowed to write something');
    }
    if (files.length > BRIEF_LIMITS.listItems) return invalid(field, `at most ${BRIEF_LIMITS.listItems} globs`);
    const out: string[] = [];
    for (const entry of files as unknown[]) {
      const glob = validateGlob(field, entry);
      if (!glob.ok) return invalid(field, glob.error.kind === 'invalid' ? glob.error.reason : 'unsafe glob');
      out.push(glob.value);
    }
    spec.files = out;
  }
  for (const key of ['symbols', 'configKeys', 'references'] as const) {
    if (!Object.hasOwn(raw, key)) continue;
    const list = readSpecList(`${at}.spec.${key}`, raw[key]);
    if (!list.ok) return list;
    spec[key] = list.value;
  }
  return ok(spec);
}

// Validates the parsed `items` value (D-06). Refusals name `brief.items[<n>].<field>`. Every acceptance criterion belongs to
// exactly one item, ids are unique, dependsOn names existing items and is acyclic, and an unknown key is refused.
function readItems(raw: unknown, acceptanceIds: readonly string[]): Result<BriefItem[]> {
  if (!Array.isArray(raw) || raw.length === 0) return invalid('brief.items', 'must be a non-empty array of items');
  if (raw.length > BRIEF_LIMITS.items) return invalid('brief.items', `at most ${BRIEF_LIMITS.items} items`);
  const items: BriefItem[] = [];
  const index = new Map<string, number>();
  for (const [n, entry] of (raw as unknown[]).entries()) {
    const at = `brief.items[${n}]`;
    if (!isPlainObject(entry)) return invalid(at, 'must be an object');
    for (const key of Object.keys(entry)) {
      if (!ITEM_KEYS.includes(key)) return invalid(`${at}.${key.slice(0, 40)}`, `unknown item key; the item keys are ${ITEM_KEYS.join(', ')}`);
    }
    const id = entry.id;
    if (typeof id !== 'string' || !ITEM_ID.test(id)) return invalid(`${at}.id`, 'must match ^[A-Z][A-Za-z0-9_-]{0,31}$');
    if (index.has(id)) return invalid(`${at}.id`, `duplicate item id ${id}`);
    index.set(id, n);
    const title = entry.title;
    if (typeof title !== 'string' || title.trim() === '' || title.length > BRIEF_LIMITS.titleChars || BAD_CONTROL.test(title)) {
      return invalid(`${at}.title`, `must be 1 to ${BRIEF_LIMITS.titleChars} characters with no control character`);
    }
    const dependsOn = entry.dependsOn;
    if (!Array.isArray(dependsOn) || dependsOn.some((dep) => typeof dep !== 'string')) {
      return invalid(`${at}.dependsOn`, 'must be an array of item ids');
    }
    if (new Set(dependsOn as string[]).size !== dependsOn.length) return invalid(`${at}.dependsOn`, 'names an item twice');
    const built: BriefItem = { id, title, dependsOn: [...(dependsOn as string[])], acceptance: [] };
    if (Object.hasOwn(entry, 'size')) {
      if (typeof entry.size !== 'string' || !SIZES.includes(entry.size)) return invalid(`${at}.size`, 'must be small, medium or large');
      built.size = entry.size as BriefSize;
    }
    if (Object.hasOwn(entry, 'model')) {
      if (typeof entry.model !== 'string' || !MODELS.includes(entry.model)) return invalid(`${at}.model`, 'must be haiku, sonnet or opus');
      built.model = entry.model as BriefModel;
    }
    const acceptance = entry.acceptance;
    if (!Array.isArray(acceptance) || acceptance.length === 0) {
      return invalid(`${at}.acceptance`, 'must name at least one acceptance criterion of the brief');
    }
    for (const ref of acceptance as unknown[]) {
      if (typeof ref !== 'string' || !acceptanceIds.includes(ref)) {
        return invalid(`${at}.acceptance`, `${JSON.stringify(typeof ref === 'string' ? ref.slice(0, 40) : ref)} is not an acceptance criterion of this brief`);
      }
    }
    if (new Set(acceptance as string[]).size !== acceptance.length) return invalid(`${at}.acceptance`, 'names a criterion twice');
    built.acceptance = [...(acceptance as string[])];
    if (Object.hasOwn(entry, 'spec')) {
      const spec = readItemSpec(at, entry.spec);
      if (!spec.ok) return spec;
      built.spec = spec.value;
    }
    items.push(built);
  }

  for (const [n, item] of items.entries()) {
    for (const dep of item.dependsOn) {
      if (dep === item.id) return invalid(`brief.items[${n}].dependsOn`, `${item.id} cannot depend on itself`);
      if (!index.has(dep)) return invalid(`brief.items[${n}].dependsOn`, `names unknown item ${shown(dep)}`);
    }
  }
  const owner = new Map<string, string>();
  for (const item of items) {
    for (const ref of item.acceptance) {
      const first = owner.get(ref);
      if (first !== undefined) return invalid('brief.items', `${ref} belongs to items ${first} and ${item.id}: each criterion belongs to exactly one item`);
      owner.set(ref, item.id);
    }
  }
  for (const ref of acceptanceIds) {
    if (!owner.has(ref)) return invalid('brief.items', `${ref} belongs to no item: each criterion belongs to exactly one item`);
  }

  // Depth-first cycle check in declaration order; the reason lists the cycle as `A -> B -> A`.
  const mark = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (id: string): string[] | null => {
    mark.set(id, 'open');
    path.push(id);
    for (const dep of (items[index.get(id) as number] as BriefItem).dependsOn) {
      if (mark.get(dep) === 'open') return [...path.slice(path.indexOf(dep)), dep];
      if (!mark.has(dep)) {
        const found = visit(dep);
        if (found !== null) return found;
      }
    }
    path.pop();
    mark.set(id, 'done');
    return null;
  };
  for (const item of items) {
    if (mark.has(item.id)) continue;
    const cycle = visit(item.id);
    if (cycle !== null) {
      return invalid(`brief.items[${index.get(cycle[0] as string)}].dependsOn`, `forms a dependency cycle: ${cycle.join(' -> ')}`);
    }
  }
  return ok(items);
}

export function parseBrief(text: string, source: BriefSource): Result<Brief> {
  if (typeof text !== 'string') return invalid('brief.text', 'must be text');
  if (new TextEncoder().encode(text).length > BRIEF_LIMITS.bytes) {
    return invalid('brief.text', `is larger than ${BRIEF_LIMITS.bytes} bytes`);
  }
  if (text.includes('�')) return invalid('brief.text', 'is not valid UTF-8 (it holds U+FFFD after decoding)');
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines.some((line) => line.length > BRIEF_LIMITS.lineChars)) {
    return invalid('brief.line', `a line is longer than ${BRIEF_LIMITS.lineChars} characters`);
  }

  let front: Record<string, string> = {};
  let body: readonly string[] = lines;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0) return invalid('brief.frontmatter', 'is not closed by a --- line');
    const read = readFrontmatter(lines.slice(1, end));
    if (!read.ok) return read;
    front = read.value;
    body = lines.slice(end + 1);
  }

  // Sections: a `## ` line outside a code fence starts one. A `# ` line before the first section names the brief.
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  let heading: string | undefined;
  let fenced = false;
  for (const line of body) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const start = fenced ? null : /^##\s+(.*?)\s*$/.exec(line);
    if (start) {
      const key = SECTIONS[(start[1] as string).toLowerCase()];
      if (key === undefined) return invalid('brief.section', `unknown section ${JSON.stringify(start[1])}`);
      if (sections.has(key)) return invalid('brief.section', `section ${JSON.stringify(start[1])} appears twice`);
      current = [];
      sections.set(key, current);
      continue;
    }
    if (current === null) {
      if (heading === undefined && !fenced) {
        const top = /^#\s+(.*?)\s*$/.exec(line);
        if (top) heading = top[1] as string;
      }
      continue;
    }
    current.push(line);
  }

  const title = front.title ?? heading ?? 'untitled';
  if (BAD_CONTROL.test(title)) return invalid('brief.title', 'holds a control character');
  if (title === '' || title.length > BRIEF_LIMITS.titleChars) {
    return invalid('brief.title', `must be 1 to ${BRIEF_LIMITS.titleChars} characters`);
  }
  if (BAD_CONTROL.test(lines.join('\n'))) return invalid('brief.text', 'holds a control character other than tab and newline');

  if (front.size !== undefined && !SIZES.includes(front.size)) return invalid('brief.size', 'must be small, medium or large');
  if (front.model !== undefined && !MODELS.includes(front.model)) return invalid('brief.model', 'must be haiku, sonnet or opus');
  let expectedDecisions: number | undefined;
  if (front.expectedDecisions !== undefined) {
    const value = front.expectedDecisions;
    expectedDecisions = /^[0-9]{1,6}$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(expectedDecisions) || expectedDecisions > BRIEF_LIMITS.expectedDecisionsMax) {
      return invalid('brief.expectedDecisions', `must be an integer from 0 to ${BRIEF_LIMITS.expectedDecisionsMax}`);
    }
  }
  if (front.baseRevision !== undefined && !/^[0-9a-fA-F]{7,40}$/.test(front.baseRevision)) {
    return invalid('brief.baseRevision', 'must be 7 to 40 hexadecimal digits');
  }

  const behavior = (sections.get('behavior') ?? []).join('\n').trim();
  if (behavior === '') return invalid('brief.behavior', 'is required: add a "## Behavior" section that says what should change');

  const acceptance = parseAcceptanceSection(sections.get('acceptance') ?? []);
  if (!acceptance.ok) return acceptance;
  let items: BriefItem[] | undefined;
  if (front.items !== undefined) {
    if (front.size !== undefined) return invalid('brief.size', 'is not allowed beside items: put size and model on each item');
    if (front.model !== undefined) return invalid('brief.model', 'is not allowed beside items: put size and model on each item');
    const json = parseItemsJson(front.items);
    if (!json.ok) return json;
    const read = readItems(json.value, acceptance.value.map((c) => c.id));
    if (!read.ok) return read;
    items = read.value;
  }
  const exclusions = bullets('brief.exclusions', sections.get('exclusions') ?? []);
  if (!exclusions.ok) return exclusions;
  let write: string[] | undefined;
  if (sections.has('write')) {
    const items = bullets('brief.write', sections.get('write') as string[]);
    if (!items.ok) return items;
    write = [];
    for (const item of items.value) {
      const glob = validateGlob('brief.write', item);
      if (!glob.ok) return invalid('brief.write', glob.error.kind === 'invalid' ? glob.error.reason : 'unsafe glob');
      write.push(glob.value);
    }
  }
  const targets = bullets('brief.targetChecks', sections.get('targetChecks') ?? []);
  if (!targets.ok) return targets;
  for (const name of targets.value) {
    if (!CHECK_NAME_PATTERN.test(name)) return invalid('brief.targetChecks', `${JSON.stringify(name)} is not a check name`);
  }

  const content: Omit<Brief, 'source' | 'digest'> = {
    title,
    behavior,
    acceptance: acceptance.value,
    exclusions: exclusions.value,
    targetChecks: targets.value,
  };
  if (write !== undefined) content.write = write;
  if (front.size !== undefined) content.size = front.size as BriefSize;
  if (front.model !== undefined) content.model = front.model as BriefModel;
  if (front.baseRevision !== undefined) content.baseRevision = front.baseRevision.toLowerCase();
  if (expectedDecisions !== undefined) content.expectedDecisions = expectedDecisions;
  // Set only when the brief has items, so the digest of a brief without them is the one it had before items existed.
  if (items !== undefined) content.items = items;
  return ok({ ...content, source, digest: digestOf(content) });
}
