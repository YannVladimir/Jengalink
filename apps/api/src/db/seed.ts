// Synthetic demo data for development and demos (spec §34). Never real people.
// Usage: pnpm db:seed (dev) — refuses to run in production. Safe to run twice.
import { config } from 'dotenv';
import { stageTemplates } from '@jengalink/contracts';
import { and, eq } from 'drizzle-orm';
import { createDb, createPool } from './client';
import {
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  stages,
  users,
} from './schema';

/** Fictional people. Numbers sit in a block reserved for demos (0788 000 0xx). */
const PEOPLE = [
  {
    key: 'owner',
    displayName: 'Aline Uwase (demo)',
    verifiedPhone: '+250788000101',
    locale: 'en',
  },
  {
    key: 'contractor',
    displayName: 'Eric Mugisha (demo)',
    verifiedPhone: '+250788000102',
    locale: 'rw',
  },
  {
    key: 'supervisor',
    displayName: 'Jean Habimana (demo)',
    verifiedPhone: '+250788000103',
    locale: 'rw',
  },
] as const;

/** English names for the house template (the apps translate templates; saved names are plain text). */
const STAGE_NAMES: Record<string, string> = {
  sitePrep: 'Site preparation',
  foundation: 'Foundation',
  walls: 'Walls',
  roof: 'Roof',
  openings: 'Doors and windows',
  services: 'Plumbing and electrical',
  finishes: 'Plaster and floors',
  painting: 'Painting and handover',
};

async function main() {
  config({ path: process.argv[2] ?? '.env', quiet: true });
  if (process.env.APP_ENV === 'production') {
    throw new Error('Refusing to seed demo data into production.');
  }
  const pool = createPool(process.env.DATABASE_URL!);
  const db = createDb(pool);
  try {
    await db.transaction(async (tx) => {
      const ids: Record<string, string> = {};
      for (const p of PEOPLE) {
        const [existing] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.verifiedPhone, p.verifiedPhone));
        ids[p.key] =
          existing?.id ??
          (
            await tx
              .insert(users)
              .values({
                displayName: p.displayName,
                verifiedPhone: p.verifiedPhone,
                locale: p.locale,
              })
              .returning({ id: users.id })
          )[0].id;
      }

      const orgName = 'Ubaka Builders (demo)';
      let [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.name, orgName));
      if (!org) {
        [org] = await tx
          .insert(organizations)
          .values({
            name: orgName,
            kind: 'contractor',
            createdBy: ids.contractor,
          })
          .returning();
        await tx.insert(organizationMemberships).values({
          organizationId: org.id,
          userId: ids.contractor,
          role: 'admin',
          createdBy: ids.contractor,
        });
      }

      const projectName = 'Kicukiro House (demo)';
      let [project] = await tx
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, org.id),
            eq(projects.name, projectName),
          ),
        );
      if (!project) {
        [project] = await tx
          .insert(projects)
          .values({
            organizationId: org.id,
            name: projectName,
            ownerUserId: ids.owner,
            type: 'house',
            contractValue: 45_000_000,
            location: {
              province: 'Kigali City',
              district: 'Kicukiro',
              sector: 'Niboye',
            },
            status: 'active',
            createdBy: ids.contractor,
          })
          .returning();
        await tx.insert(projectMemberships).values([
          {
            organizationId: org.id,
            projectId: project.id,
            userId: ids.owner,
            role: 'owner',
            financialVisibility: true,
            createdBy: ids.contractor,
          },
          {
            organizationId: org.id,
            projectId: project.id,
            userId: ids.contractor,
            role: 'contractor',
            financialVisibility: true,
            createdBy: ids.contractor,
          },
          {
            organizationId: org.id,
            projectId: project.id,
            userId: ids.supervisor,
            role: 'supervisor',
            createdBy: ids.contractor,
          },
        ]);
      }
      const existingStages = await tx
        .select({ id: stages.id })
        .from(stages)
        .where(eq(stages.projectId, project.id));
      if (existingStages.length === 0) {
        await tx.insert(stages).values(
          stageTemplates.house.map((st, i) => ({
            organizationId: org.id,
            projectId: project.id,
            name: STAGE_NAMES[st.key] ?? st.key,
            weight: st.weight,
            position: i + 1,
            createdBy: ids.contractor,
          })),
        );
      }
      console.log(
        `Demo data ready: ${projectName} · owner 0788 000 101 · contractor 0788 000 102 · supervisor 0788 000 103`,
      );
    });
  } finally {
    await pool.end();
  }
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
