// Brief parser (FR-1). Pure: the caller reads the file and passes text. A brief is untrusted data: it is parsed, never
// interpreted as an instruction to AVARICE, and every field is validated (RC-2).
//
// Format: optional frontmatter between a first line `---` and the next `---` holding `key: value` scalars, then
// sections `## Behavior`, `## Acceptance criteria`, `## Exclusions`, `## Write`, `## Target checks`.
import { digestOf } from './digest.ts';
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
  write?: string[];
  targetChecks: string[];
  size?: BriefSize;
  model?: BriefModel;
  baseRevision?: string;
  expectedDecisions?: number;
  source: BriefSource;
  digest: string;
}

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

function listItems(lines: readonly string[]): string[] {
  const items: string[] = [];
  for (const line of lines) {
    const match = /^[-*]\s+(.*)$/.exec(line.trim());
    if (match) items.push((match[1] as string).replace(/^`(.*)`$/, '$1').trim());
  }
  return items;
}

export function parseBrief(text: string, source: BriefSource): Result<Brief> {
  const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const front: Record<string, string> = {};
  let body = lines;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end < 0) return invalid('brief.frontmatter', 'is not closed');
    for (const line of lines.slice(1, end)) {
      const match = /^([A-Za-z][A-Za-z0-9]*):[ \t]*(.*)$/.exec(line);
      if (match) front[match[1] as string] = (match[2] as string).trim();
    }
    body = lines.slice(end + 1);
  }

  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  let heading: string | undefined;
  for (const line of body) {
    const section = /^##\s+(.*?)\s*$/.exec(line);
    if (section) {
      current = [];
      sections.set((section[1] as string).toLowerCase(), current);
      continue;
    }
    if (current === null && heading === undefined) {
      const top = /^#\s+(.*?)\s*$/.exec(line);
      if (top) heading = top[1] as string;
    }
    current?.push(line);
  }

  const behavior = (sections.get('behavior') ?? []).join('\n').trim();
  if (behavior === '') return invalid('brief.behavior', 'is required');

  const acceptance: BriefAcceptance[] = [];
  for (const item of listItems(sections.get('acceptance criteria') ?? [])) {
    const match = /^(AC[0-9]+):\s*(.*?)(?:\s*\|\s*verifiedBy:\s*(.*))?$/.exec(item);
    if (!match) continue;
    const verifiedBy = (match[3] ?? '')
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '');
    acceptance.push({ id: match[1] as string, text: (match[2] as string).trim(), verifiedBy });
  }

  const writeItems = sections.has('write') ? listItems(sections.get('write') as string[]) : undefined;
  const content: Omit<Brief, 'source' | 'digest'> = {
    title: front.title ?? heading ?? 'untitled',
    behavior,
    acceptance,
    exclusions: listItems(sections.get('exclusions') ?? []),
    targetChecks: listItems(sections.get('target checks') ?? []),
  };
  if (writeItems !== undefined) content.write = writeItems;
  if (front.size !== undefined) content.size = front.size as BriefSize;
  if (front.model !== undefined) content.model = front.model as BriefModel;
  if (front.baseRevision !== undefined) content.baseRevision = front.baseRevision;
  if (front.expectedDecisions !== undefined) content.expectedDecisions = Number(front.expectedDecisions);
  return ok({ ...content, source, digest: digestOf(content) });
}
