// The SEC-6 enforcement map as a code table (docs/enterprise-adaptation.md "Enforcement map"): every control, who enforces it, what AVARICE's
// part is, how it can be bypassed, and the test that proves it or the reason none does. Pure data; test/unit/enforcement-map.test.ts holds
// the table to its shape.

export const ENFORCERS = ['host', 'os-sandbox', 'external-platform', 'avarice'] as const;
export type Enforcer = (typeof ENFORCERS)[number];

// A tracked test file that proves the control, or the reason no test does yet.
export type ControlProof = { kind: 'test'; path: string } | { kind: 'unverified'; reason: string };

export interface EnforcementRow {
  id: string;
  control: string;
  enforcer: Enforcer;
  avariceRole: string;
  bypassLimitation: string;
  test: ControlProof;
  // Set on the rows a host limitation (docs/containment.md "Unresolved host limitations", items 3 and 4) leaves open.
  hostLimitation?: 3 | 4;
  // `not-claimed`: no profile claims the `enforced` strength for this row.
  profileStrength?: 'not-claimed';
}

const PLATFORM_OWNS = 'Enforced by the platform that owns it; AVARICE has no test that could prove it';
const proved = (plan: string): ControlProof => ({ kind: 'unverified', reason: `proved by plan ${plan}, the test file does not exist yet` });
const tracked = (path: string): ControlProof => ({ kind: 'test', path });

// The order is the order docs/enterprise-adaptation.md renders its table in, then the controls the sections on strength and policy add. An
// `unverified` row is a statement of what is not yet proved, never a claim: `proved by plan 04-NN` rows become test paths when that plan
// creates the file, and the two host-limitation rows stay unverified until the containment suite passes the open items.
export const ENFORCEMENT_MAP: readonly EnforcementRow[] = [
  {
    id: 'scm-branch-protection',
    control: 'Branch protection, required reviews, required checks',
    enforcer: 'external-platform',
    avariceRole: 'Records status',
    bypassLimitation: 'None from AVARICE side; the SCM platform is the authoritative control',
    test: { kind: 'unverified', reason: PLATFORM_OWNS },
  },
  {
    id: 'ci-gates',
    control: 'CI gates, deployment gates',
    enforcer: 'external-platform',
    avariceRole: 'Records results',
    bypassLimitation: 'Authoritative; AVARICE cannot loosen or replace them',
    test: { kind: 'unverified', reason: PLATFORM_OWNS },
  },
  {
    id: 'identity',
    control: 'Identity, MFA, token lifetime',
    enforcer: 'external-platform',
    avariceRole: 'Uses delegated credentials',
    bypassLimitation: 'Authoritative; a run holds no credential of its own',
    test: { kind: 'unverified', reason: PLATFORM_OWNS },
  },
  {
    id: 'host-managed-permissions',
    control: 'Host permission rules and managed settings',
    enforcer: 'host',
    avariceRole: 'None',
    bypassLimitation: 'Controlled by the organization when managed, by the user otherwise; whether managed-only permission rules hold (host limitation 4) is not established',
    test: { kind: 'unverified', reason: 'host limitation 4: the semantics of allowManagedPermissionRulesOnly for enterprise profiles are not yet resolved by a containment test' },
    hostLimitation: 4,
    profileStrength: 'not-claimed',
  },
  {
    id: 'sandbox-confinement',
    control: 'Shell and child-process confinement',
    enforcer: 'os-sandbox',
    avariceRole: 'Generates the sandbox configuration per run; refuses to launch without it',
    bypassLimitation: 'Hooks and local MCP servers run outside the sandbox; the host process is not sandboxed',
    test: tracked('test/containment/executor.test.ts'),
  },
  {
    id: 'tool-call-decisions',
    control: 'Tool-call decisions in unattended runs',
    enforcer: 'host',
    avariceRole: 'Evaluates the contract and policy in its fail-closed PreToolUse hook; the host runs in dontAsk mode',
    bypassLimitation: 'Paths the containment document leaves unverified (host limitations 3 and 4); a removed hook is caught by the launch preflight, not by the hook',
    test: tracked('test/integration/hook.test.ts'),
  },
  {
    id: 'budgets',
    control: 'Budgets',
    enforcer: 'avarice',
    avariceRole: 'Owns the ledger counts; the host enforces --max-budget-usd per invocation',
    bypassLimitation: 'Cost is a client-side estimate reported after each invocation',
    test: tracked('test/fault/budgets.test.ts'),
  },
  {
    id: 'privileged-approval',
    control: 'Privileged-command approval in the host',
    enforcer: 'host',
    avariceRole:
      "The PreToolUse hook the host runs classifies every command of a Bash call and consumes one approval per privileged command, bound to the command's parameters, the exact line and the directory it runs in; a command no approval can bind (a gh api body read from a file or standard input) is denied with no request",
    bypassLimitation:
      "Covers only these forms: git push, gh pr create, gh pr merge, gh pr edit, gh release create, gh api with a method other than GET, and npm publish; every other command, including the other gh and git forms, is not seen. It finds them behind a leading assignment, env, command, exec, nohup, nice, sudo, doas, time, timeout, xargs, setsid, stdbuf, ionice, flock, taskset, arch, caffeinate, unbuffer, chronic and coproc; behind find -exec (and -execdir, -ok, -okdir), parallel and watch; in a shell started on a literal string, eval, su -c, trap and a here-string given to a shell; and in a command substitution, a here-document body or a segment after a separator. It does not see: a name built at run time (a variable, an alias, a function); a script that pushes; a shell started on a computed string; text piped into a shell; arguments a wrapper reads from standard input (xargs, parallel fed from a pipe); interpreters running a code string (node -e, python -c); other programs that run commands (make, ssh, script, expect); repository and shell state changed by an earlier separate call (a remote's URL, git config, an exported variable); a git alias or config set by an earlier separate call; and git config files named on the line (GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM, GIT_CONFIG), which are bound as env words while their content is not read. The SCM platform's own protections are authoritative there. A brace expansion or a glob in a command, prefix or subcommand position (git pus{h,}, {git,push} origin main, git pu?h), and a brace expansion anywhere in a privileged command (git push origin {main,dev}), is refused as unreadable, because the words it forms are not the words the gate sees. A glob in the arguments after a privileged subcommand (git push origin refs/heads/*), which is pathname globbing, is not expanded by the gate: it is bound as written, so the approval binds the pattern, not the files the shell matches. A removed hook is caught by the launch preflight, not by the hook, and commands outside the host are not seen",
    test: tracked('test/integration/hook-privileged.test.ts'),
  },
  {
    id: 'approval-single-use',
    control: 'Approval single-use and binding',
    enforcer: 'avarice',
    avariceRole: 'Owns the approval ledger and the parameter digest an approval is bound to',
    bypassLimitation: 'A user with file access can edit the database',
    test: proved('04-16'),
  },
  {
    id: 'profile-isolation',
    control: 'Profile isolation',
    enforcer: 'avarice',
    avariceRole: 'Owns the per-profile data, config and work roots and the sandbox denial of other profiles',
    bypassLimitation: 'A user can copy files between directories; a profile placed outside the default parents by an environment variable is not covered by the sandbox denial',
    test: tracked('test/integration/profile-isolation.test.ts'),
  },
  {
    id: 'redaction',
    control: 'Redaction before persistence',
    enforcer: 'avarice',
    avariceRole: 'Owns the redactor applied at the event and log boundaries',
    bypassLimitation: 'Pattern-based; unknown secret formats can pass',
    test: tracked('test/integration/redaction-suite.test.ts'),
  },
  {
    id: 'prompt-injection',
    control: 'Prompt-injection scanning',
    enforcer: 'avarice',
    avariceRole: 'Shares with GSD hooks; AVARICE fences retrieved text as data and keeps authority separate from it',
    bypassLimitation: 'Heuristic; authority separation is the control that holds',
    test: tracked('test/integration/context.test.ts'),
  },
  {
    id: 'write-scope',
    control: 'Write scope',
    enforcer: 'os-sandbox',
    avariceRole: 'Computes the write scope of each invocation and run from the contract and passes it to the sandbox and the hook',
    bypassLimitation: 'The working directory is always writable to shell commands; a process outside the sandbox is not confined',
    test: tracked('test/unit/run-scope.test.ts'),
  },
  {
    id: 'network-scope',
    control: 'Network scope',
    enforcer: 'os-sandbox',
    avariceRole: 'Leaves an invocation no network; gives one supervisor step a loopback port to an allowlisting proxy',
    bypassLimitation: 'The proxy checks host names only with no TLS inspection; MCP servers and hooks reach the network directly; the host model traffic is outside the sandbox; company egress controls are authoritative in an enterprise profile',
    test: tracked('test/integration/allowlist-proxy.test.ts'),
  },
  {
    id: 'credential-denial',
    control: 'Credentials absent from the run',
    enforcer: 'os-sandbox',
    avariceRole: 'Rebuilds the environment from an allowlist and denies reads of credential directories in the sandbox and the hook',
    bypassLimitation: 'Denial is by path, not by content; a credential placed in an allowed read root is readable; an allowed MCP server that holds its own credential can act',
    test: tracked('test/unit/invocation-scope.test.ts'),
  },
  {
    id: 'organization-policy-fail-closed',
    control: 'Organization policy file, rank 1 (a missing or invalid file denies every privileged action)',
    enforcer: 'avarice',
    avariceRole: 'Reads the file without following a link and denies privileged actions when it is missing or invalid under an enterprise profile',
    bypassLimitation: 'Tamper resistance against the user holds only where the file is delivered by managed settings or an external platform',
    test: tracked('test/unit/policy-precedence.test.ts'),
  },
  {
    id: 'restricted-mode',
    control: 'Restricted mode when a layer is unavailable (unattended runs refused)',
    enforcer: 'avarice',
    avariceRole: 'Drops the run to restricted and refuses unattended runs; never substitutes instructions, an unapproved sandbox or an unapproved egress path',
    bypassLimitation: 'A restricted run produces a plan, a patch file and a decision list only; the host must still honor its restricted flag',
    test: proved('04-23'),
  },
  {
    id: 'hook-cost-fields',
    control: 'Finer budget enforcement from token or cost fields in hook input',
    enforcer: 'host',
    avariceRole: 'None until the host provides the fields; budgets use counts and client-side cost estimates',
    bypassLimitation: 'Whether hook input carries token or cost fields (host limitation 3) is not established, so no profile relies on it',
    test: { kind: 'unverified', reason: 'host limitation 3: not yet resolved by a containment test' },
    hostLimitation: 3,
    profileStrength: 'not-claimed',
  },
];
