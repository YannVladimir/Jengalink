import { eq, sql } from 'drizzle-orm';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { createDb, createPool, type Database } from '../src/db/client';
import { organizations, projects } from '../src/db/schema';

// Runs against jengalink_test (migrated by `pnpm db:migrate:test`).
describe('database (e2e)', () => {
  let pool: Pool;
  let db: Database;

  beforeAll(() => {
    config({ path: '.env.test', quiet: true });
    pool = createPool(process.env.DATABASE_URL!);
    db = createDb(pool);
  });

  afterEach(async () => {
    await db.execute(
      sql`truncate projects, organizations, users, outbox_events, processed_events cascade`,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('is the test database', async () => {
    const res = await db.execute<{ db: string }>(
      sql`select current_database() as db`,
    );
    expect(res.rows[0].db).toBe('jengalink_test');
  });

  it('creates a project with UUIDv7 keys and Rwanda defaults', async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Ubaka Builders', kind: 'contractor' })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({
        organizationId: org.id,
        name: 'Kicukiro house',
        location: { province: 'Kigali City', district: 'Kicukiro' },
      })
      .returning();

    expect(project.id).toMatch(/^[0-9a-f-]{14}7/); // version nibble = 7
    expect(project).toMatchObject({
      currency: 'RWF',
      timezone: 'Africa/Kigali',
      status: 'draft',
      revision: 1,
    });
    const found = await db.query.projects.findFirst({
      where: eq(projects.id, project.id),
    });
    expect(found?.location.district).toBe('Kicukiro');
  });

  it('rejects a project for an organization that does not exist', async () => {
    await expect(
      db.insert(projects).values({
        organizationId: '00000000-0000-7000-8000-000000000000',
        name: 'Orphan',
      }),
    ).rejects.toThrow();
  });

  it('rejects an unknown project status', async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Household', kind: 'household' })
      .returning();
    await expect(
      db.execute(
        sql`insert into projects (organization_id, name, status) values (${org.id}, 'X', 'finished')`,
      ),
    ).rejects.toThrow();
  });
});
