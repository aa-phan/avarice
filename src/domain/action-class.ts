// Action classification (FR-12, docs/enterprise-adaptation.md "Policy model"). Every action AVARICE can take is read, local-write or
// privileged, and the class lives in this one table. An action name that is not in the table is privileged: deny by default, so a new
// action added anywhere in the program starts as the most restricted class until someone classes it here. Pure.
export type ActionClass = 'read' | 'local-write' | 'privileged';

export const ACTION_CLASSES: Readonly<Record<string, ActionClass>> = Object.freeze({
  // read: observes the repository, the store or the status of a run; changes nothing outside memory.
  'context.retrieve': 'read',
  'repo.read': 'read',
  'status.read': 'read',
  // local-write: writes only inside the profile's own roots, the staging copy or a local branch the run owns.
  'workspace.write': 'local-write',
  'staging.write': 'local-write',
  'artifact.store': 'local-write',
  'handoff.local-branch': 'local-write',
  // privileged: leaves the machine, changes a shared system, or writes into the user's repository.
  'git.push': 'privileged',
  'scm.pr.create': 'privileged',
  'scm.pr.update': 'privileged',
  'scm.pr.merge': 'privileged',
  // A write through the SCM platform's API (`gh api` with a method other than GET): any change the platform allows, so it is its own action (plan 04-19).
  'scm.api.write': 'privileged',
  'scm.comment.create': 'privileged',
  'tracker.write': 'privileged',
  'release.publish': 'privileged',
  deploy: 'privileged',
  export: 'privileged',
  'onboarding.promote.copy': 'privileged',
  'onboarding.promote.commit': 'privileged',
  // The three SEC-5 actions: a request that is not TLS, carries no authentication or reaches a host off the allowlist. They are
  // privileged and the built-in policy denies them without any file being able to change that.
  'net.insecure-transport': 'privileged',
  'net.unauthenticated': 'privileged',
  'net.egress-unlisted': 'privileged',
});

export function classifyAction(name: string): ActionClass {
  return Object.hasOwn(ACTION_CLASSES, name) ? (ACTION_CLASSES[name] as ActionClass) : 'privileged';
}
