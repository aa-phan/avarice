// Application dependencies (SKELETON.md "Application"). Plan 01-05 adds host, staging and artifacts.
import type { IdPrefix } from '../domain/ids.ts';
import type { Ledger } from '../ports/ledger.ts';

export interface Clock {
  nowMs(): number;
}

export interface IdSource {
  next(prefix: IdPrefix): string;
}

export interface ProfilePaths {
  profile: string;
  configHome: string;
  dataRoot: string;
  workRoot: string;
}

export interface AppDeps {
  ledger: Ledger;
  clock: Clock;
  ids: IdSource;
  profile: ProfilePaths;
}
