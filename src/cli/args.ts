// Minimal argument parser and the command-module contract.
//   positionals          words that are not flags
//   --flag value         a value flag; the next word is consumed unless the flag is declared boolean
//   --flag=value         a value flag with the value attached
//   --flag               a boolean flag (true)
//   --                   everything after it is positional
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
  // Every value a flag was given, in order, for repeatable flags (`--budget a=1 --budget b=2`); `flags` keeps the last.
  repeated?: Record<string, string[]>;
}

export interface ParseOptions {
  // Flags that never take a value, so `--json path` leaves `path` positional.
  boolean?: readonly string[];
}

export function parseArgs(argv: readonly string[], options: ParseOptions = {}): ParsedArgs {
  const booleans = new Set(options.boolean ?? []);
  const positionals: string[] = [];
  // Null-prototype maps, so a flag named `__proto__`, `constructor` or `toString` is an ordinary key and never
  // reaches Object.prototype (review WR-05).
  const flags: Record<string, string | true> = Object.create(null);
  const repeated: Record<string, string[]> = Object.create(null);
  const note = (name: string, value: string): void => {
    (repeated[name] ??= []).push(value);
  };
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i] as string;
    if (word === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!word.startsWith('--') || word.length === 2) {
      positionals.push(word);
      continue;
    }
    const eq = word.indexOf('=');
    if (eq !== -1) {
      flags[word.slice(2, eq)] = word.slice(eq + 1);
      note(word.slice(2, eq), word.slice(eq + 1));
      continue;
    }
    const name = word.slice(2);
    const next = argv[i + 1];
    if (!booleans.has(name) && next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      note(name, next);
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positionals, flags, repeated };
}

const BUDGET_FLAG = /^([A-Za-z][A-Za-z0-9]*)=(.+)$/;

// Repeatable `--budget name=value`, shared by `onboard` and `start`. The names and the lower-only rule belong to the contract
// compilers (RC-5); this only checks the shape, so a typo creates nothing. Returns the overrides or a message for the usage line.
export function parseBudgetFlags(args: ParsedArgs): Record<string, number> | string {
  if (args.flags['budget'] === true) return '--budget needs name=value';
  const out: Record<string, number> = {};
  for (const entry of args.repeated?.['budget'] ?? []) {
    const match = BUDGET_FLAG.exec(entry);
    const value = match === null ? Number.NaN : Number(match[2]);
    if (match === null || !Number.isFinite(value)) return `--budget ${JSON.stringify(entry)} is not name=value with a number`;
    out[match[1] as string] = value;
  }
  return out;
}

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// What a file under src/cli/commands/ exports. `readOnly` makes composition open the store read-only.
export interface CommandModule<Deps> {
  run(args: ParsedArgs, deps: Deps, io: Io): Promise<number> | number;
  readOnly?: boolean;
  // Composition also locates GSD and builds its adapter (a read-only command that reads the indexes through GSD).
  needsGsd?: boolean;
  booleanFlags?: readonly string[];
  // Checked before the profile is resolved, so a usage error leaves nothing on disk. Returns the error text.
  // `env` is the environment the command runs in: the process environment, or the one a test passes to main().
  usage?(args: ParsedArgs, env?: NodeJS.ProcessEnv): string | undefined;
}
