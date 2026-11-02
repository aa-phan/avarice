// GSD agent markdown reader (CS-15 precondition, T-01-28). Agent definitions are GSD's own files; before one
// becomes an entry of the --agents JSON it is read, reduced to the keys AVARICE passes on, and refused when it
// asks for a permission mode or hooks, which would let an agent step outside the generated settings.
//
// GSD agent frontmatter is simple (01-RESEARCH Pattern 3): scalars, comma lists, `  - item` lists, commented
// `# hooks:` blocks. This is a reader for that subset, not a YAML parser.
import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export interface ParsedAgent {
  description: string;
  tools?: string[];
  disallowedTools?: string[];
  effort?: string;
  // The markdown body after the frontmatter.
  prompt: string;
}

// Keys refused outright; compared after lowercasing and dropping `-` and `_`.
const REFUSED_KEYS: ReadonlyMap<string, string> = new Map([
  ['permissionmode', 'permissionMode'],
  ['hooks', 'hooks'],
]);

const FRONTMATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n([\s\S]*))?$/;
const KEY_LINE = /^([A-Za-z][\w-]*)[ \t]*:[ \t]*(.*)$/;

function invalid(field: string, reason: string): Result<never> {
  return err({ kind: 'invalid', field, reason });
}

const unquote = (value: string): string => {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) return v.slice(1, -1);
  return v;
};

function splitList(value: string): string[] {
  const inner = value.trim().replace(/^\[/, '').replace(/\]$/, '');
  return inner
    .split(',')
    .map((item) => unquote(item))
    .filter((item) => item !== '');
}

interface RawEntry {
  value: string;
  // Indented continuation lines, comments and blank lines removed, indentation stripped.
  block: string[];
}

export function parseAgentFile(text: string): Result<ParsedAgent> {
  const match = FRONTMATTER.exec(text.replace(/\r\n/g, '\n'));
  if (match === null) return invalid('frontmatter', 'the agent file has no frontmatter between --- lines');
  const head = match[1] as string;
  const body = match[2] ?? '';

  const entries = new Map<string, RawEntry>();
  let current: RawEntry | null = null;
  for (const line of head.split('\n')) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      current?.block.push(line.trim());
      continue;
    }
    const kv = KEY_LINE.exec(line);
    if (kv === null) {
      current = null;
      continue;
    }
    current = { value: (kv[2] as string).trim(), block: [] };
    entries.set(kv[1] as string, current);
  }

  for (const key of entries.keys()) {
    const refused = REFUSED_KEYS.get(key.toLowerCase().replace(/[-_]/g, ''));
    if (refused !== undefined) {
      return invalid(refused, `the agent definition sets ${refused}, which the generated settings do not allow`);
    }
  }

  const scalar = (key: string): string | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (/^[>|][+-]?$/.test(entry.value)) return entry.block.join(entry.value.startsWith('>') ? ' ' : '\n');
    return unquote(entry.value);
  };
  const list = (key: string): string[] | undefined => {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.value !== '') return splitList(entry.value);
    return entry.block.filter((item) => item.startsWith('-')).map((item) => unquote(item.slice(1)));
  };

  const description = scalar('description');
  if (description === undefined || description === '') return invalid('description', 'the agent file has no description');

  const tools = list('tools');
  const disallowedTools = list('disallowedTools');
  const effort = scalar('effort');
  return ok({
    description,
    ...(tools !== undefined ? { tools } : {}),
    ...(disallowedTools !== undefined ? { disallowedTools } : {}),
    ...(effort !== undefined && effort !== '' ? { effort } : {}),
    prompt: body.trim(),
  });
}
