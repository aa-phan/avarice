// The LaunchAgent writer (plan 03-23). Stub: filled in by the GREEN commit of the same task.
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';

export const DIGEST_LABEL_PREFIX = 'io.avarice.digest.';
export const PLIST_MARKER = '<!-- avarice:digest-schedule -->';

export interface DigestPlistInput {
  label: string;
  nodePath: string;
  nodeArgs?: readonly string[];
  entryPath: string;
  times: readonly string[];
  env: Readonly<Record<string, string>>;
  logPath: string;
}

export interface LaunchdOptions {
  agentsDir: string;
  launchctl: string;
  plutil: string;
  uid: number;
}

export interface ScheduleInstall {
  label: string;
  path: string;
  status: 'installed' | 'replaced';
}

export interface ScheduleRemoval {
  label: string;
  path: string;
  status: 'removed' | 'not-installed';
}

export function renderDigestPlist(_input: DigestPlistInput): Result<string> {
  return err({ kind: 'internal', cause: 'not implemented' });
}

export class LaunchdScheduler {
  constructor(_options: LaunchdOptions) {}

  install(_input: DigestPlistInput): Result<ScheduleInstall> {
    return err({ kind: 'internal', cause: 'not implemented' });
  }

  remove(_label: string): Result<ScheduleRemoval> {
    return err({ kind: 'internal', cause: 'not implemented' });
  }
}
