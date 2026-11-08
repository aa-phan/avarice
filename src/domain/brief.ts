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
} as const;

const SIZES: readonly string[] = ['small', 'medium', 'large'];
const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus'];
const FRONTMATTER_KEYS: readonly string[] = ['title', 'size', 'model', 'baseRevision', 'expectedDecisions'];
const SECTIONS: Readonly<Record<string, string>> = {
  behavior: 'behavior',
  'acceptance criteria': 'acceptance',
  exclusions: 'exclusions',
  write: 'write',
  'target checks': 'targetChecks',
};
const VERIFIED_BY = /^(?:check|test|diff):\S(?:.*\S)?$/;

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

function readAcceptance(lines: readonly string[]): Result<BriefAcceptance[]> {
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
        if (!VERIFIED_BY.test(ref)) {
          return invalid('brief.acceptance.verifiedBy', `${id}: ${JSON.stringify(ref)} must be check:<name>, test:<id> or diff:<rule>`);
        }
        verifiedBy.push(ref);
      }
    }
    out.push({ id, text, verifiedBy });
  }
  return ok(out);
}

function readFrontmatter(lines: readonly string[]): Result<Record<string, string>> {
  const front: Record<string, string> = {};
  for (const line of lines) {
    if (line.trim() === '') continue;
    const match = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*)$/.exec(line);
    if (!match) return invalid('brief.frontmatter', `expected "key: value", found ${JSON.stringify(line.slice(0, 60))}`);
    const key = match[1] as string;
    if (!FRONTMATTER_KEYS.includes(key)) return invalid(`brief.frontmatter.${key}`, 'unknown frontmatter key');
    if (Object.hasOwn(front, key)) return invalid(`brief.frontmatter.${key}`, 'repeated frontmatter key');
    front[key] = (match[2] as string).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return ok(front);
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

  const acceptance = readAcceptance(sections.get('acceptance') ?? []);
  if (!acceptance.ok) return acceptance;
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
  return ok({ ...content, source, digest: digestOf(content) });
}
