// Skeleton: the classification table arrives with the tracer's implementation.
export type ActionClass = 'read' | 'local-write' | 'privileged';

export const ACTION_CLASSES: Readonly<Record<string, ActionClass>> = Object.freeze({});

export function classifyAction(_name: string): ActionClass {
  return 'privileged';
}
