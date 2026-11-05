// Shared OPS-7 text style (docs/extensions.md "Human-readable output"; ADR-013 decision 6). Pure functions: one
// implementation that the one-shot commands, the run views and the interactive shell all print through. They return
// text without a trailing newline; the caller adds it. Nothing here reads the terminal, the clock or the environment:
// callers pass those in, so every function is testable and the JSON paths never depend on it.

// Escape sequences and control characters that could rewrite the terminal from a recorded string (T-02-03).
// Order matters: strings introduced by OSC, DCS, SOS, PM and APC run to their terminator; then CSI, in its
// 7-bit and 8-bit forms; then any other ESC sequence; then every remaining C0, DEL and C1 control character except
// newline and tab, and the bidirectional overrides that make text read in a different order than it is stored.
const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const STRING_INTRODUCERS = /\x1b[PX^_][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const CSI = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\x1b[ -/]*[0-~]/g;
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;
const BIDI = /[‪-‮⁦-⁩]/g;

export function stripControl(text: string): string {
  return text.replace(OSC, '').replace(STRING_INTRODUCERS, '').replace(CSI, '').replace(OTHER_ESCAPE, '').replace(CONTROL, '').replace(BIDI, '');
}

// The ledger's own word, then its reason in parentheses where one exists: `blocked (enforcement_failure)`.
export function stateWord(state: string, reason?: string | null): string {
  const word = stripControl(state);
  return reason === undefined || reason === null || reason === '' ? word : `${word} (${stripControl(reason)})`;
}

// The first line of a command's standard output: the thing it applies to and the state reached.
export function resultLine(subject: string, state: string, reason?: string | null): string {
  return `${stripControl(subject)}: ${stateWord(state, reason)}`;
}

// `avarice <command>: <message>`, or `avarice: <message>` before a command is chosen. The command may carry its
// subcommand (`repo add`). The message may span lines, for example a usage text.
export function errorLine(command: string | undefined, message: string): string {
  return `${command === undefined ? 'avarice' : `avarice ${command}`}: ${stripControl(message)}`;
}

export function usd(n: number): string {
  return Number.isFinite(n) ? `${n.toFixed(2)} USD` : 'unknown USD';
}

// The largest whole unit, with the remainder one unit down: `1 d 1 h`, `1 h 5 min`, `3 min 10 s`, `4 s`.
export function duration(ms: number): string {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms <= 0) return '0 s';
  if (ms < 1000) return '<1 s';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const min = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  if (h > 0) return min > 0 ? `${h} h ${min} min` : `${h} h`;
  if (min > 0) return s > 0 ? `${min} min ${s} s` : `${min} min`;
  return `${s} s`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function relative(diffMs: number): string {
  const abs = Math.abs(diffMs);
  if (abs < 1000) return 'just now';
  const s = Math.floor(abs / 1000);
  const unit = s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86_400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86_400)} d`;
  return diffMs < 0 ? `in ${unit}` : `${unit} ago`;
}

// Local time with a relative form: `14:02, 3 min ago`. The local date leads when the time is not today.
export function localTime(ms: number, nowMs: number): string {
  if (!Number.isFinite(ms) || !Number.isFinite(nowMs)) return 'unknown time';
  const at = new Date(ms);
  const now = new Date(nowMs);
  const clock = `${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  const stamp = sameDay ? clock : `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())} ${clock}`;
  return `${stamp}, ${relative(nowMs - ms)}`;
}

// Colour and cursor escapes only on a terminal, with NO_COLOR unset and TERM not `dumb`.
export function colourEnabled(input: { isTTY: boolean | undefined; env: Readonly<Record<string, string | undefined>> }): boolean {
  return input.isTTY === true && input.env['NO_COLOR'] === undefined && input.env['TERM'] !== 'dumb';
}
