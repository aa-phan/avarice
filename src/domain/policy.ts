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

const usable = (file: PolicyFile | undefined, kind: PolicySourceKind): PolicyFile | undefined => (file !== undefined && PARSED_AS.get(file) === kind ? file : undefined);

// The most restrictive rule of one file that applies to the action and the parameters.
const statedBy = (file: PolicyFile | undefined, action: string, params: Readonly<Record<string, string>>): PolicyRule | undefined =>
  strictest((file?.rules ?? []).filter((rule) => appliesTo(rule, action, params)));

// Rank 1 is broken when a file was expected and cannot be used: an error result (unreadable or invalid), a value that was not parsed as an
// organization file, or `'absent'` under an enterprise profile. A personal profile that names no file passes `organization` out altogether.
function organizationBroken(sources: PolicySources): boolean {
  const organization = sources.organization;
  if (organization === undefined) return false;
  if (organization === 'absent') return sources.profileClass === 'enterprise';
  return !organization.ok || usable(organization.value, 'organization') === undefined;
}

// The decision for one action, by rank (docs/enterprise-adaptation.md "Sources and precedence"):
//   - a fixed SEC-5 rule decides first and nothing changes it;
//   - a broken rank 1 denies every privileged action (D-17), whatever the other ranks say;
//   - a rule the organization states decides its own rank and cannot be loosened by a lower rank;
//   - otherwise the built-in rule decides, and under a personal profile the user's rule may replace it (loosen or restrict);
//   - ranks 3 and 4 then only restrict: a rule of the user (enterprise profile, or any rule over an organization rule) or of the repository
//     replaces the answer only when it is stricter. The repository never loosens, in any profile.
// A file that was not produced by `parsePolicyFile` for its own source is unusable: at rank 1 that is a broken file, at ranks 3 and 4 it is
// absent, which can only leave the stricter built-in default in force.
export function evaluatePolicy(sources: PolicySources, action: string, params: Readonly<Record<string, string>>): PolicyDecision {
  const builtin = builtinFor(action);
  // Every action matches the built-in rule of its class, so this is always found; deny is the answer if the table ever loses one.
  if (builtin === undefined) return { effect: 'deny', ruleId: 'builtin.no-rule', rank: 2 };
  if (builtin.fixed === true) return { effect: builtin.effect, ruleId: builtin.id, rank: 2 };
  if (organizationBroken(sources) && classifyAction(action) === 'privileged') return { effect: 'deny', ruleId: INVALID_ORGANIZATION_RULE_ID, rank: 1 };

  const organization = sources.organization !== undefined && sources.organization !== 'absent' && sources.organization.ok ? usable(sources.organization.value, 'organization') : undefined;
  const orgRule = statedBy(organization, action, params);
  const userRule = statedBy(usable(sources.user, 'user'), action, params);
  const repositoryRule = statedBy(usable(sources.repository, 'repository'), action, params);

  let decision: PolicyDecision;
  if (orgRule !== undefined) decision = { effect: orgRule.effect, ruleId: orgRule.id, rank: 1 };
  else if (userRule !== undefined && sources.profileClass === 'personal') decision = { effect: userRule.effect, ruleId: userRule.id, rank: 3 };
  else decision = { effect: builtin.effect, ruleId: builtin.id, rank: 2 };

  for (const [rule, rank] of [[userRule, 3], [repositoryRule, 4]] as const) {
    if (rule !== undefined && STRICTNESS[rule.effect] > STRICTNESS[decision.effect]) decision = { effect: rule.effect, ruleId: rule.id, rank };
  }
  return decision;
}

const SOURCE_FIELDS: ReadonlySet<string> = new Set(['profileClass', 'organization', 'user', 'repository']);

const invalidSources = (reason: string): Result<never> => err({ kind: 'invalid', field: 'policy sources', reason });

// The only way to build `PolicySources` from values whose type is not known at the call site (FR-14, T-04-12). The sources are the four
// declared kinds and nothing else: a field that names anything other than the profile class and the three files is refused, and each file
// must be what `parsePolicyFile` returned for that source. Text from a brief, a context item, tool output or model output has no field to
// go into and no way to become a parsed file of its own accord. The evaluator has no parameter that takes such text either.
export function policySources(input: Readonly<Record<string, unknown>>): Result<PolicySources> {
  for (const key of Object.keys(input)) {
    if (!SOURCE_FIELDS.has(key)) return invalidSources('only profileClass, organization, user and repository are policy sources');
  }
  const profileClass = input['profileClass'];
  if (profileClass !== 'personal' && profileClass !== 'enterprise') return invalidSources('profileClass is not personal or enterprise');
  const sources: PolicySources = { profileClass };

  const organization = input['organization'];
  if (organization !== undefined) {
    if (organization === 'absent') {
      sources.organization = 'absent';
    } else if (isRecord(organization) && organization['ok'] === true) {
      const value = organization['value'] as PolicyFile;
      if (usable(value, 'organization') === undefined) return invalidSources('organization is not a parsed organization policy file');
      sources.organization = ok(value);
    } else if (isRecord(organization) && organization['ok'] === false && isRecord(organization['error']) && typeof organization['error']['kind'] === 'string') {
      sources.organization = organization as unknown as Result<never>;
    } else {
      return invalidSources('organization is not absent and not the result of reading the organization file');
    }
  }
  for (const kind of ['user', 'repository'] as const) {
    const file = input[kind];
    if (file === undefined) continue;
    if (usable(file as PolicyFile, kind) === undefined) return invalidSources(`${kind} is not a parsed ${kind} policy file`);
    sources[kind] = file as PolicyFile;
  }
  return ok(sources);
}
