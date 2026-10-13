import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from './index';

// Drizzle applies snake_case at query time; config holds the TypeScript keys.
const snake = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const columnNames = (t: PgTable) =>
  getTableConfig(t).columns.map((c) => snake(c.name));

const tables = (Object.values(schema) as unknown[]).filter(
  (v): v is PgTable => v instanceof PgTable,
);

// Append-only tables are never updated, so they carry no updated_at/revision.
const appendOnly = new Set([
  'processed_events',
  'audit_events',
  'project_acceptances',
  'stage_reviews',
  'agreements',
  'claim_decisions',
  'claim_revisions',
  'spending_decisions',
  'budget_movements',
  'budget_change_decisions',
]);

describe('schema conventions (spec §16.3, §17.1)', () => {
  it.each(tables.map((t) => [getTableConfig(t).name, t] as const))(
    '%s has a UUID primary key and audit columns',
    (name, table) => {
      const id = getTableConfig(table).columns.find((c) => c.name === 'id');
      expect(id?.primary).toBe(true);
      expect(id?.getSQLType()).toBe('uuid');
      if (appendOnly.has(name)) {
        expect(columnNames(table)).toContain('created_at');
        return;
      }
      expect(columnNames(table)).toEqual(
        expect.arrayContaining([
          'created_at',
          'updated_at',
          'created_by',
          'revision',
        ]),
      );
    },
  );

  const projectRecords = tables.filter((t) =>
    columnNames(t).includes('project_id'),
  );

  // No project records yet (the first arrive in Phase 3); the guard then applies to each.
  (projectRecords.length ? it.each : it.skip.each)(
    projectRecords.map((t) => [getTableConfig(t).name, t] as const),
  )(
    '%s is scoped by organization_id + project_id with a composite FK to projects',
    (_name, table) => {
      const { foreignKeys } = getTableConfig(table);
      expect(columnNames(table)).toContain('organization_id');
      const composite = foreignKeys.some((fk) => {
        const ref = fk.reference();
        return (
          getTableConfig(ref.foreignTable).name === 'projects' &&
          ref.columns.map((c) => snake(c.name)).join() ===
            'organization_id,project_id'
        );
      });
      expect(composite).toBe(true);
    },
  );
});
