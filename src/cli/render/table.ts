// Aligned text tables (OPS-7 "Tables"): a header row, columns in the order given, rows in the order given, every cell
// stripped of control characters, and the row cut to the terminal width with `…`. A column marked `subject` (an ID,
// a state, a path that is the subject of the row) is never cut: if the subjects alone are wider than the terminal
// the table overflows rather than hiding an ID. Width is counted in code points, which is exact for the ASCII and
// Latin text AVARICE prints and an approximation for wide East Asian characters.
import { stripControl } from './style.ts';

export interface Column {
  key: string;
  header: string;
  // Never cut.
  subject?: boolean;
  // Cut only after every other cuttable column is down to its minimum width (the text the reader acts on).
  keep?: boolean;
  // Which end of an over-long cell is replaced by `…`. A path is more useful with its tail kept: `start`.
  cut?: 'end' | 'start';
}

const GAP = '  ';
// A cut column keeps at least three characters and the ellipsis, or its natural width when that is smaller.
const MIN_CUT_WIDTH = 4;
const UNKNOWN_WIDTH = 100;

function cleaned(value: string | undefined): string {
  return stripControl(value ?? '').replace(/[\n\t]+/g, ' ');
}

function chars(text: string): string[] {
  return Array.from(text);
}

function cut(text: string, width: number, from: 'end' | 'start'): string {
  const all = chars(text);
  if (all.length <= width) return text;
  if (width <= 1) return '…';
  return from === 'start' ? `…${all.slice(all.length - (width - 1)).join('')}` : `${all.slice(0, width - 1).join('')}…`;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - chars(text).length));
}

// Always ends with a newline, also for no rows (the header row alone).
export function renderTable(columns: readonly Column[], rows: readonly Readonly<Record<string, string>>[], width: number): string {
  const body = rows.map((row) => columns.map((c) => cleaned(row[c.key])));
  const widths = columns.map((c, i) => Math.max(chars(c.header).length, ...body.map((cells) => chars(cells[i] as string).length)));
  const minimums = columns.map((c, i) => (c.subject === true ? (widths[i] as number) : Math.min(widths[i] as number, MIN_CUT_WIDTH)));
  let excess = widths.reduce((sum, w) => sum + w, 0) + GAP.length * Math.max(0, columns.length - 1) - width;
  // Shrink the widest cuttable column first, one character at a time, so the cut is spread over the long columns.
  // The columns marked `keep` are only touched once every other column is down to its minimum.
  for (const pass of ['spare', 'keep'] as const) {
    while (excess > 0) {
      let pick = -1;
      for (let i = 0; i < columns.length; i += 1) {
        if ((columns[i]?.keep === true) !== (pass === 'keep')) continue;
        if ((widths[i] as number) > (minimums[i] as number) && (pick < 0 || (widths[i] as number) > (widths[pick] as number))) pick = i;
      }
      if (pick < 0) break;
      widths[pick] = (widths[pick] as number) - 1;
      excess -= 1;
    }
  }
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, i) => pad(cut(cell, widths[i] as number, columns[i]?.cut ?? 'end'), widths[i] as number))
      .join(GAP)
      .trimEnd();
  return [line(columns.map((c) => cleaned(c.header))), ...body.map(line)].join('\n') + '\n';
}

// The terminal width reported by the stream, or 100 columns when it is not a terminal or does not say.
export function terminalWidth(columns: number | undefined): number {
  return columns !== undefined && Number.isInteger(columns) && columns > 0 ? columns : UNKNOWN_WIDTH;
}
