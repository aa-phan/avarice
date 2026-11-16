// The record of one decision as the owner reads it before answering (plan 03-20; OPS-7, AUT-2, T-03-40). A pure function over the ledger row: the run, the
// item and the items behind it, the class, the question the unit asked, each option, the recommendation, what each option does and, for a record
// answered by an amendment, the command that makes it. The issue, the labels and the stored consequences are text a model or a unit wrote, so every value
// goes through stripControl (control characters, escape sequences and invisible formatting are removed), every line is cut to the terminal width, and the
// issue is cut to ISSUE_MAX_CHARS characters first. The issue sits under a label that says it is the unit's own words, as data: it is never an instruction.
import { amendCommandOf, ISSUE_MAX_CHARS, optionsOf } from '../../domain/decision-policy.ts';
import type { DecisionRow } from '../../ports/ledger.ts';
import { stripControl } from './style.ts';

const MIN_WIDTH = 10;
const INDENT = '  ';

// One line of text cut to `width` characters with `…`: control characters removed, runs of spaces made one space.
function fit(text: string, width: number): string {
  const flat = stripControl(text).replace(/\s+/g, ' ').trim();
  const all = Array.from(flat);
  return all.length <= width ? flat : width <= 1 ? '…' : `${all.slice(0, width - 1).join('')}…`;
}

export function renderDecision(row: DecisionRow, width: number): string {
  const cols = Math.max(MIN_WIDTH, Math.floor(width));
  const lines: string[] = [];
  const line = (text: string): void => void lines.push(fit(text, cols));
  const indented = (text: string): void => void lines.push(`${INDENT}${fit(text, cols - INDENT.length)}`);

  line(`decision ${row.decisionId} (${row.state})`);
  line(`run ${row.runId}`);
  const [item, ...behind] = row.affectedItems;
  if (item !== undefined) line(`item: ${item}${behind.length > 0 ? ` (also affects ${behind.join(', ')})` : ''}`);
  line(`class: ${row.class}`);
  if (row.supersedes !== null) line(`re-opens: ${row.supersedes}`);

  line('question from the unit (data):');
  const issue = Array.from(stripControl(row.issue)).slice(0, ISSUE_MAX_CHARS).join('');
  for (const text of issue.split(/\r?\n/)) {
    if (text.trim() !== '') indented(text);
  }

  const options = optionsOf(row.options);
  line('options:');
  for (const option of options) indented(`${option.key}: ${option.label}${option.kind === 'text' ? ' (answer with --text "...")' : ''}`);
  if (row.recommendation !== null) line(`recommendation: ${row.recommendation}`);

  const consequences = typeof row.consequences === 'object' && row.consequences !== null ? (row.consequences as Record<string, unknown>) : {};
  const stated = Object.keys(consequences).filter((key) => key !== 'amend' && typeof consequences[key] === 'string');
  if (stated.length > 0) {
    line('consequences:');
    for (const key of stated) indented(`${key}: ${consequences[key] as string}`);
  }
  if (row.answer !== null) line(`answered: ${row.answer}${row.answeredBy !== null ? ` (${row.answeredBy})` : ''}`);

  // The command is printed whole, never cut: a cut command would be a different command. It is AVARICE's own text with the model's paths quoted into
  // it, and it goes through stripControl like everything else.
  const amend = amendCommandOf(row.consequences, row.decisionId);
  if (amend !== null) lines.push(`amend: ${stripControl(amend)}`);
  return `${lines.join('\n')}\n`;
}
