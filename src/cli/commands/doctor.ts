// avarice doctor [--json] [--online] [--repair] [--extensions]
// Diagnoses the installation offline and read-only (plan 04-25; OPS-1, OPS-6, D-20): profile, runtime, store, host, GSD, graphify, recorded adapters and runs, with a
// finding and a fix for everything that is wrong. It runs on its own composition (`composeDoctor`, which main() calls instead of createDeps), so it reports the problems
// the normal composition would refuse to start on: a store written by a newer AVARICE, an incompatible GSD, an absent or refused host. Every probe has its own 1 s
// timeout. It prints no secret value: a credential reference is shown as the reference it is, and every line passes the process redactor and the control-character strip.
//   --json         the same content as one JSON document
//   --online       adds a reachability section: the authentication check of each `delegated:<cli>` reference (the only network step; without it none is attempted)
//   --repair       deletes orphaned temporary artifact files older than 1 hour; never edits a run, a lease or a record
//   --extensions   adds the Claude configuration directories, duplicate AVARICE hook or skill registrations and instruction conflicts, as warnings
// Exit 0 when no finding has level error, 3 when at least one does, 64 for a usage error, 70 for an internal failure.
import { runDoctor } from '../../app/doctor.ts';
import type { DoctorDeps, DoctorFinding, DoctorReport } from '../../app/doctor.ts';
import type { Io, ParsedArgs } from '../args.ts';
import { createDoctorDeps } from '../doctor-deps.ts';
import type { DoctorComposition } from '../doctor-deps.ts';
import { errorLine, stripControl } from '../render/style.ts';

const EXIT_FINDINGS = 3;
const EXIT_INTERNAL = 70;
const FLAGS = ['json', 'online', 'repair', 'extensions', 'profile'];

export const booleanFlags = ['json', 'online', 'repair', 'extensions'] as const;

const USAGE = 'usage: avarice doctor [--json] [--online] [--repair] [--extensions]';

export function usage(args: ParsedArgs): string | undefined {
  if (args.positionals.length > 0) return `doctor takes no argument, found ${JSON.stringify(stripControl(args.positionals[0] ?? ''))}\n${USAGE}`;
  for (const name of Object.keys(args.flags)) {
    if (!FLAGS.includes(name)) return `unknown option --${stripControl(name)}\n${USAGE}`;
  }
  return undefined;
}

// main() calls this instead of createDeps for this command: doctor must not need what the normal composition needs (a migrated store, a GSD, a host).
export function composeDoctor(env: NodeJS.ProcessEnv, profile: string): { ok: true; value: DoctorComposition } {
  return { ok: true, value: createDoctorDeps(env, profile) };
}

function ago(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} day${days === 1 ? '' : 's'} ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours} h ago`;
  return 'under an hour ago';
}

const LABEL_WIDTH = 14;
const row = (label: string, text: string): string => `${label.padEnd(LABEL_WIDTH)}${text}`;
const more = (text: string): string => `${' '.repeat(LABEL_WIDTH)}${text}`;

export function renderDoctor(report: DoctorReport, nowMs: number): string {
  const lines: string[] = [];
  const p = report.profile;
  lines.push(row('profile', p.name === null ? 'not prepared' : `${p.name} (class ${p.class ?? 'unknown'})`));
  if (p.roots !== null) {
    lines.push(more(`config home: ${p.roots.configHome}`));
    lines.push(more(`data root: ${p.roots.dataRoot} (${p.local === true ? 'local' : 'unchecked'})   work root: ${p.roots.workRoot}`));
  }
  for (const c of p.credentials) lines.push(more(`credential ${c.name}: ${c.reference}`));

  const r = report.runtime;
  lines.push(row('runtime', `node ${r.node.version}  ${r.node.ok ? 'ok' : 'NOT OK'}${r.node.engines === null ? '' : ` (${r.node.engines})`}   sqlite ${r.sqlite.version ?? 'unknown'} (bundled)${r.sqlite.ok ? '' : '  NOT OK'}`));

  const s = report.store;
  const backup = s.lastBackup === null ? 'none yet' : ago(nowMs - Date.parse(s.lastBackup));
  lines.push(row('store', s.state === 'absent' ? 'none yet (the first command that writes creates it)' : s.state === 'unchecked' ? 'not checked' : `schema ${s.schema ?? 'unknown'} (this build writes ${s.expectedSchema})  ${s.state}   journal ${s.journalMode ?? 'unknown'}   integrity ${s.integrity ?? 'unchecked'}   last backup ${backup}`));

  const h = report.host;
  lines.push(row('host', h.admission === 'absent' ? `claude not found${h.claudeBin === null ? '' : ` (${h.claudeBin})`}` : `claude ${h.claudeVersion ?? 'did not answer'}   admission: ${h.admission}${h.refusal === null ? '' : ` (${h.refusal})`}`));
  lines.push(more(`enforcement: ${h.enforcement}   sandbox: ${h.sandbox}   hook entry: ${h.hookEntry}   restricted launch: ${h.restricted ? 'available' : 'not available'}`));
  lines.push(more(`attended hook: ${h.attended}   config dir: ${h.configDir}`));

  const g = report.gsd;
  lines.push(row('gsd', g.state === 'absent' ? `not found (admitted: ${g.admitted})` : `${g.version ?? 'unknown'}   ${g.state === 'ok' ? 'ok' : 'INCOMPATIBLE'} (admitted: ${g.admitted})${g.location === null ? '' : `   at ${g.location}`}`));

  const f = report.graphify;
  lines.push(row('graphify', f.state === 'absent' ? 'not found' : `${f.version ?? 'version unknown'}   at ${f.path ?? ''}`));

  lines.push(row('adapters', report.adapters.length === 0 ? 'none recorded' : report.adapters.map((a) => `${a.name}=${a.adapter}`).join('   ')));

  const runs = report.runs;
  if (!runs.read) {
    lines.push(row('runs', 'not read (the store is absent or cannot be read as this build\'s schema)'));
  } else {
    const counts = Object.entries(runs.byState).map(([state, n]) => `${n} ${state}`);
    lines.push(row('runs', counts.length === 0 ? 'none' : counts.join(', ')));
    for (const i of runs.interrupted) lines.push(more(`${i.kind} ${i.id}${i.title === null ? '' : ` "${i.title}"`} interrupted in ${i.state}  -> ${i.resume}`));
  }
  for (const rec of report.records) {
    lines.push(row('record', `${rec.projectId} v${rec.version}   revision ${rec.onboardedRevision}   gsd ${rec.gsdVersion}   ${rec.compatibility}${rec.reason === null ? '' : `: ${rec.reason}`}`));
  }

  if (report.online !== undefined) {
    lines.push(row('online', report.online.checks.length === 0 ? (report.online.note ?? 'nothing to check') : ''));
    for (const c of report.online.checks) lines.push(more(`${c.reference}: ${c.status}`));
  }
  if (report.repair !== undefined) lines.push(row('repair', `removed ${report.repair.removed} orphaned temporary artifact file(s), kept ${report.repair.kept} newer than 1 hour`));
  if (report.extensions !== undefined) {
    lines.push(row('extensions', `active config dir: ${report.extensions.activeConfigDir}`));
    for (const d of report.extensions.configDirs) lines.push(more(`${d.path}${d.active ? ' (active)' : ''}${d.exists ? '' : ' (absent)'}: ${d.attendedHookEntries} attended hook entr${d.attendedHookEntries === 1 ? 'y' : 'ies'}, skills ${d.skills.length === 0 ? 'none' : d.skills.join(', ')}`));
  }

  if (report.findings.length === 0) {
    lines.push('', 'no findings');
  } else {
    lines.push('', 'findings');
    for (const finding of report.findings) lines.push(...renderFinding(finding));
  }
  // Stripped once, here: whatever a recorded string held, a terminal never receives an escape sequence from it.
  return `${lines.map(stripControl).join('\n')}\n`;
}

function renderFinding(finding: DoctorFinding): string[] {
  return [`  ${finding.level.padEnd(7)} ${finding.area}: ${finding.message}`, `          fix: ${finding.fix}`];
}

export async function run(args: ParsedArgs, deps: DoctorDeps, io: Io): Promise<number> {
  const options = { online: args.flags['online'] === true, repair: args.flags['repair'] === true, extensions: args.flags['extensions'] === true };
  let report: DoctorReport;
  try {
    report = await runDoctor(deps, options);
  } catch (e) {
    io.err(`${errorLine('doctor', `failed: ${e instanceof Error ? e.message : String(e)}`)}\n`);
    return EXIT_INTERNAL;
  }
  io.out(args.flags['json'] === true ? `${JSON.stringify(report, null, 2)}\n` : renderDoctor(report, deps.clock.nowMs()));
  return report.findings.some((finding) => finding.level === 'error') ? EXIT_FINDINGS : 0;
}
