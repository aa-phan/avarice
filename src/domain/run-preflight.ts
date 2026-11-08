// Start preflight (plan 02-10; D-04, D-16, T-02-30, T-02-31). Pure: the application gathers the facts from repository objects
// and passes them in, and every refusal is a code and one message the owner reads. A start refused here has created nothing.

// Claude's discretion per CONTEXT.md, recommended by RESEARCH Open Question 2. The limits count commits and age outside
// `.avarice/**` and `.planning/**` past the onboarded revision (the graph and intel describe the pin, so code that moved since
// no longer matches them). A run does not lower them per profile in this phase.
export const STALENESS_LIMITS = { commits: 25, days: 14 } as const;

export type PreflightCode = 'revision-mismatch' | 'not-descendant' | 'stale-commits' | 'stale-age' | 'no-conventions' | 'no-planning';

export interface PreflightRefusal {
  code: PreflightCode;
  message: string;
}

export interface RunPreflightFacts {
  // The active record's onboarded revision, a full commit SHA.
  pin: string;
  // The source HEAD, for the message of a history that does not descend from the pin.
  head?: string;
  // The base revision the brief names, as the brief parser normalized it (lower case, 7 to 40 hexadecimal digits).
  briefBaseRevision?: string;
  staleness: {
    descendant: boolean;
    commitsOutside: number;
    // Age in days of the oldest commit outside `.avarice/**` and `.planning/**` past the pin; null when there is none.
    oldestOutsideAgeDays: number | null;
  };
  // Whether D-16 found `.avarice/config.json` at the pin or at a descendant commit that changes only `.avarice/**`.
  conventions: 'found' | 'not_found';
  // Whether the pin tree holds `.planning/ROADMAP.md`.
  roadmapAtPin: boolean;
}

export type RunPreflightVerdict = { ok: true } | { ok: false; refusal: PreflightRefusal };

const short = (sha: string): string => sha.slice(0, 7);
const REONBOARD = 're-onboard the repository (adoption and refresh arrive in a later phase)';

const refuse = (code: PreflightCode, message: string): RunPreflightVerdict => ({ ok: false, refusal: { code, message } });

// The rules in the order the owner can act on them: which revision, whether the history still leads from it, how far the code
// moved, then what the revision lacks.
export function judgeRunPreflight(facts: RunPreflightFacts): RunPreflightVerdict {
  const { pin, staleness } = facts;
  const named = facts.briefBaseRevision;
  if (named !== undefined && !pin.startsWith(named.toLowerCase())) {
    return refuse('revision-mismatch', `the brief names base revision ${named} but the repository was onboarded at ${short(pin)}; ${REONBOARD}, or name the onboarded revision in the brief`);
  }
  if (!staleness.descendant) {
    const head = facts.head === undefined ? 'the source HEAD' : `the source HEAD ${short(facts.head)}`;
    return refuse('not-descendant', `${head} does not descend from the onboarded revision ${short(pin)}; ${REONBOARD}`);
  }
  if (staleness.commitsOutside > STALENESS_LIMITS.commits) {
    return refuse(
      'stale-commits',
      `the source has ${staleness.commitsOutside} commits past the onboarded revision ${short(pin)} outside .avarice/ and .planning/ (limit ${STALENESS_LIMITS.commits}); ${REONBOARD}`,
    );
  }
  if (staleness.oldestOutsideAgeDays !== null && staleness.oldestOutsideAgeDays > STALENESS_LIMITS.days) {
    return refuse(
      'stale-age',
      `the oldest commit past the onboarded revision ${short(pin)} outside .avarice/ and .planning/ is ${staleness.oldestOutsideAgeDays.toFixed(2)} days old (limit ${STALENESS_LIMITS.days}); ${REONBOARD}`,
    );
  }
  if (facts.conventions === 'not_found') {
    return refuse(
      'no-conventions',
      '.avarice/config.json is missing: conventions are read only from the onboarded revision or from a later commit that changes only .avarice/ (D-16), so commit the file as its own commit',
    );
  }
  if (!facts.roadmapAtPin) {
    return refuse('no-planning', `the onboarded revision ${short(pin)} has no .planning/ROADMAP.md; planning initialization arrives in a later phase`);
  }
  return { ok: true };
}
