// Schema version 3 (stub for the RED run of plan 03-02; the real DDL replaces it in the GREEN commit).
import type { Migration } from '../migrate.ts';

export const MIGRATION_0003: Migration = { version: 3, sql: 'SELECT 1;' };
