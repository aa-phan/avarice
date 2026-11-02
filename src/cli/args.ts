// Minimal argument parser and the command-module contract.
//   positionals          words that are not flags
//   --flag value         a value flag; the next word is consumed unless the flag is declared boolean
//   --flag=value         a value flag with the value attached
//   --flag               a boolean flag (true)
//   --                   everything after it is positional
export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | true>;
}

export interface ParseOptions {
  // Flags that never take a value, so `--json path` leaves `path` positional.
  boolean?: readonly string[];
}

export function parseArgs(argv: readonly string[], options: ParseOptions = {}): ParsedArgs {
  const booleans = new Set(options.boolean ?? []);
  const positionals: string[] = [];
  const flags: Record<string, string | true> = {};
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
      continue;
    }
    const name = word.slice(2);
    const next = argv[i + 1];
    if (!booleans.has(name) && next !== undefined && !next.startsWith('--')) {
      flags[name] = next;
      i += 1;
    } else {
      flags[name] = true;
    }
  }
  return { positionals, flags };
}

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

// What a file under src/cli/commands/ exports. `readOnly` makes composition open the store read-only.
export interface CommandModule<Deps> {
  run(args: ParsedArgs, deps: Deps, io: Io): Promise<number> | number;
  readOnly?: boolean;
  booleanFlags?: readonly string[];
}
