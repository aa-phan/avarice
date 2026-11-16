// The policy model (FR-12, SEC-4, FR-14, D-17; docs/enterprise-adaptation.md "Policy model"). Four ranked sources decide whether an action
// is allowed, denied or needs approval: the organization file (rank 1), the built-in defaults (rank 2), the user profile policy (rank 3)
// and the repository's `.avarice/policy.json` (rank 4). The approval gate, the hook and promotion all ask `evaluatePolicy`; none of them
// carries its own rules. Rules match an action by name and parameters by string equality only; richer predicates are not specified.
// A policy file is data: it is parsed by hand, unknown keys are refused, and a parsed file is the only thing the evaluator accepts. Pure.
import { classifyAction } from './action-class.ts';
import type { ActionClass } from './action-class.ts';
import type { ProfileClass } from './profile.ts';
import { err, ok } from './result.ts';
import type { Result } from './result.ts';

export type PolicyEffect = 'allow' | 'deny' | 'require-approval';
export type PolicySourceKind = 'organization' | 'user' | 'repository';
export type PolicyRank = 1 | 2 | 3 | 4;

export interface PolicyRule {
  id: string;
  action: string;
  // Every named parameter must equal the given string for the rule to apply.
  when?: Readonly<Record<string, string>>;
  effect: PolicyEffect;
  // Only on require-approval: who may approve (`local-user`).
  approvalSource?: string;
}

export interface PolicyFile {
  schema: 1;
  rules: readonly PolicyRule[];
}

export interface PolicyDecision {
  effect: PolicyEffect;
  ruleId: string;
  rank: PolicyRank;
}

// A built-in rule applies to one named action or to every action of one class. `fixed` rules are the SEC-5 rules (TLS, authentication,
// egress): no file at any rank loosens them.
export interface BuiltinRule {
  id: string;
  effect: PolicyEffect;
  action?: string;
  actionClass?: ActionClass;
  fixed?: true;
}

export const BUILTIN_POLICY: readonly BuiltinRule[] = Object.freeze([
  { id: 'builtin.read-allowed', actionClass: 'read', effect: 'allow' },
  { id: 'builtin.local-write-allowed', actionClass: 'local-write', effect: 'allow' },
  { id: 'builtin.privileged-needs-approval', actionClass: 'privileged', effect: 'require-approval' },
  { id: 'sec5.tls', action: 'net.insecure-transport', effect: 'deny', fixed: true },
  { id: 'sec5.authentication', action: 'net.unauthenticated', effect: 'deny', fixed: true },
  { id: 'sec5.egress', action: 'net.egress-unlisted', effect: 'deny', fixed: true },
] satisfies BuiltinRule[]);

// The rule id a broken organization file produces under rank 1; no file may claim it.
export const INVALID_ORGANIZATION_RULE_ID = 'org.invalid-or-missing';

const STRICTNESS: Readonly<Record<PolicyEffect, number>> = { allow: 0, 'require-approval': 1, deny: 2 };
const EFFECTS: readonly PolicyEffect[] = ['allow', 'deny', 'require-approval'];
const MAX_FILE_CHARS = 64 * 1024;
const MAX_RULES = 256;
const MAX_WHEN_KEYS = 8;
const MAX_WHEN_VALUE_CHARS = 128;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
const APPROVAL_SOURCE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const FILE_KEYS = new Set(['schema', 'rules']);
const RULE_KEYS = new Set(['id', 'action', 'when', 'effect', 'approvalSource']);

// Which source a parsed file was parsed as. `policySources` accepts a file only in the field of its own source, and only a parsed file.
const PARSED_AS = new WeakMap<object, PolicySourceKind>();

export function parsedAs(file: PolicyFile): PolicySourceKind | undefined {
  return PARSED_AS.get(file);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function refuse(source: PolicySourceKind, reason: string): Result<never> {
  return err({ kind: 'invalid', field: `${source} policy`, reason });
}

function parseRule(value: unknown, index: number, source: PolicySourceKind, seen: Set<string>): Result<PolicyRule> {
  const where = `rules[${index}]`;
  if (!isRecord(value)) return refuse(source, `${where} is not an object`);
  for (const key of Object.keys(value)) {
    if (!RULE_KEYS.has(key)) return refuse(source, `${where} has an unknown key`);
  }
  const { id, action, when, effect, approvalSource } = value;
  if (typeof id !== 'string' || !NAME.test(id)) return refuse(source, `${where} has no valid id`);
  if (id.startsWith('builtin.') || id.startsWith('sec5.') || id === INVALID_ORGANIZATION_RULE_ID) return refuse(source, `${where} uses a reserved rule id`);
  if (seen.has(id)) return refuse(source, `${where} repeats an earlier rule id`);
  seen.add(id);
  if (typeof action !== 'string' || !NAME.test(action)) return refuse(source, `${where} has no valid action`);
  if (typeof effect !== 'string' || !(EFFECTS as readonly string[]).includes(effect)) return refuse(source, `${where} has an effect that is not allow, deny or require-approval`);
  const rule: PolicyRule = { id, action, effect: effect as PolicyEffect };
  if (when !== undefined) {
    if (!isRecord(when)) return refuse(source, `${where}.when is not an object`);
    const entries = Object.entries(when);
    if (entries.length === 0 || entries.length > MAX_WHEN_KEYS) return refuse(source, `${where}.when needs between 1 and ${MAX_WHEN_KEYS} entries`);
    const matched: Record<string, string> = {};
    for (const [key, expected] of entries) {
      if (!PARAM_KEY.test(key)) return refuse(source, `${where}.when has a key that is not valid`);
      if (typeof expected !== 'string' || expected === '' || expected.length > MAX_WHEN_VALUE_CHARS) return refuse(source, `${where}.when.${key} is not a short string`);
      matched[key] = expected;
    }
    rule.when = Object.freeze(matched);
  }
  if (approvalSource !== undefined) {
    if (effect !== 'require-approval') return refuse(source, `${where} names an approvalSource on a rule that does not require approval`);
    if (typeof approvalSource !== 'string' || !APPROVAL_SOURCE.test(approvalSource)) return refuse(source, `${where} has an approvalSource that is not valid`);
    rule.approvalSource = approvalSource;
  }
  return ok(Object.freeze(rule));
}

// `raw` is the file's JSON text or its parsed value. The result is frozen and remembers the source it was parsed as.
export function parsePolicyFile(raw: unknown, source: PolicySourceKind): Result<PolicyFile> {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_FILE_CHARS) return refuse(source, 'the file is larger than 64 KiB');
    try {
      value = JSON.parse(raw);
    } catch {
      return refuse(source, 'the file is not valid JSON');
    }
  }
  if (!isRecord(value)) return refuse(source, 'the file is not an object');
  for (const key of Object.keys(value)) {
    if (!FILE_KEYS.has(key)) return refuse(source, 'the file has an unknown key');
  }
  if (value['schema'] !== 1) return refuse(source, 'the schema is not 1');
  const rawRules = value['rules'];
  if (!Array.isArray(rawRules)) return refuse(source, 'rules is not a list');
  if (rawRules.length > MAX_RULES) return refuse(source, `the file has more than ${MAX_RULES} rules`);
  const seen = new Set<string>();
  const rules: PolicyRule[] = [];
  for (const [index, entry] of rawRules.entries()) {
    const rule = parseRule(entry, index, source, seen);
    if (!rule.ok) return rule;
    rules.push(rule.value);
  }
  const file: PolicyFile = Object.freeze({ schema: 1 as const, rules: Object.freeze(rules) });
  PARSED_AS.set(file, source);
  return ok(file);
}

// The sources of one evaluation. `organization` is left out when no organization policy applies, is `'absent'` when the profile expects an
// organization file and none is there, and is the result of reading it otherwise (an error result is an unreadable or invalid file).
export interface PolicySources {
  profileClass: ProfileClass;
  organization?: Result<PolicyFile> | 'absent';
  user?: PolicyFile;
  repository?: PolicyFile;
}

function appliesTo(rule: PolicyRule, action: string, params: Readonly<Record<string, string>>): boolean {
  if (rule.action !== action) return false;
  if (rule.when === undefined) return true;
  return Object.entries(rule.when).every(([key, expected]) => Object.hasOwn(params, key) && params[key] === expected);
}

// The first rule of the highest strictness, so the answer is the same for the same file.
function strictest<T extends { effect: PolicyEffect }>(rules: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const rule of rules) {
    if (best === undefined || STRICTNESS[rule.effect] > STRICTNESS[best.effect]) best = rule;
  }
  return best;
}

function builtinFor(action: string): BuiltinRule | undefined {
  const cls = classifyAction(action);
  return strictest(BUILTIN_POLICY.filter((rule) => rule.action === action || (rule.action === undefined && rule.actionClass === cls)));
}

export function evaluatePolicy(sources: PolicySources, action: string, params: Readonly<Record<string, string>>): PolicyDecision {
  const builtin = builtinFor(action);
  // Every action matches the built-in rule of its class, so this is always found; deny is the answer if the table ever loses one.
  if (builtin === undefined) return { effect: 'deny', ruleId: 'builtin.no-rule', rank: 2 };
  if (builtin.fixed === true) return { effect: builtin.effect, ruleId: builtin.id, rank: 2 };
  const organization = sources.organization !== undefined && sources.organization !== 'absent' && sources.organization.ok ? sources.organization.value : undefined;
  const stated = strictest((organization?.rules ?? []).filter((rule) => appliesTo(rule, action, params)));
  if (stated !== undefined) return { effect: stated.effect, ruleId: stated.id, rank: 1 };
  return { effect: builtin.effect, ruleId: builtin.id, rank: 2 };
}
