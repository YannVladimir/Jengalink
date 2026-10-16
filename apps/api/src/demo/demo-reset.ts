// Recreates the demo environment (spec §34): wipes the database and the bucket, then builds the
// made-up projects through the real API, the way people would, so every rule and record applies.
// Usage: pnpm demo:reset   (reads .env.demo; needs DEMO_MODE=on; refuses in production)
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access --
   The builder reads a few fields from API responses the API itself has already validated. */
import './demo-env';
import { randomUUID } from 'node:crypto';
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  DEMO_CODE,
  DEMO_PEOPLE,
  type DemoPerson,
  SHARE_SECTIONS,
  stageTemplates,
} from '@jengalink/contracts';
import { NestFactory } from '@nestjs/core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client } from 'pg';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { createDb, createPool } from '../db/client';
import { type DemoScene, demoPhoto } from './demo-photos';

const env = process.env as Record<string, string>;

const STAGE_NAMES: Record<string, string> = {
  sitePrep: 'Site preparation',
  foundation: 'Foundation',
  walls: 'Walls',
  roof: 'Roof',
  openings: 'Doors and windows',
  services: 'Plumbing and electrical',
  finishes: 'Plaster and floors',
  painting: 'Painting and handover',
  assessment: 'Assessment',
  repairs: 'Repairs',
  cleaning: 'Cleaning and handover',
};

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kigali' }).format(
    new Date(),
  );
const daysAgo = (n: number) => {
  const d = new Date(`${today()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Creates the demo database on first use and brings it to the latest migration. */
async function prepareDatabase() {
  const name = new URL(env.DATABASE_URL).pathname.slice(1);
  const admin = new URL(env.DATABASE_URL);
  admin.pathname = '/postgres';
  const server = new Client({ connectionString: admin.toString() });
  await server.connect();
  try {
    const { rowCount } = await server.query(
      'select 1 from pg_database where datname = $1',
      [name],
    );
    if (!rowCount) await server.query(`create database "${name}"`);
  } finally {
    await server.end();
  }
  const pool = createPool(env.DATABASE_URL);
  try {
    await migrate(createDb(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

/** Wipes every application table and the bucket. Only ever with DEMO_MODE=on. */
async function wipe() {
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query<{ name: string }>(
      `select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`,
    );
    if (rows.length)
      await db.query(
        `truncate ${rows.map((r) => r.name).join(', ')} restart identity cascade`,
      );
    // Queued jobs for rows that no longer exist.
    await db.query('truncate pgboss.job').catch(() => undefined);
  } finally {
    await db.end();
  }
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION || 'us-east-1',
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  for (;;) {
    let page;
    try {
      page = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET }));
    } catch {
      return; // no bucket yet: the API creates it
    }
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (!keys.length) return;
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: env.S3_BUCKET,
        Delete: { Objects: keys },
      }),
    );
  }
}

type Json = Record<string, any>;

function client(base: string, token: string) {
  const call = async (
    method: string,
    path: string,
    body?: object,
    ifMatch?: string,
  ): Promise<{ body: Json; etag: string | null }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        ...(ifMatch ? { 'if-match': ifMatch } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok)
      throw new Error(
        `${method} ${path} → ${res.status} ${text.slice(0, 300)}`,
      );
    return {
      body: (text ? JSON.parse(text) : {}) as Json,
      etag: res.headers.get('etag'),
    };
  };
  return {
    get: async (path: string) => (await call('GET', path)).body,
    etag: async (path: string) => (await call('GET', path)).etag!,
    post: async (path: string, body?: object, ifMatch?: string) =>
      (await call('POST', path, body ?? {}, ifMatch)).body,
    put: async (path: string, body: object, ifMatch?: string) =>
      (await call('PUT', path, body, ifMatch)).body,
    patch: async (path: string, body: object, ifMatch?: string) =>
      (await call('PATCH', path, body, ifMatch)).body,
  };
}
type Api = ReturnType<typeof client>;

async function signIn(base: string, person: DemoPerson): Promise<Api> {
  const post = async (path: string, body: object) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
    return (await res.json()) as Json;
  };
  const started = await post('/v1/auth/otp/start', {
    channel: 'sms',
    destination: person.phone,
  });
  const v = await post('/v1/auth/otp/verify', {
    challengeId: started.challengeId,
    code: DEMO_CODE,
  });
  const api = client(base, v.accessToken as string);
  await api.patch(
    '/v1/me',
    {
      displayName: person.name,
      locale:
        person.key === 'contractor' || person.key === 'supervisor'
          ? 'rw'
          : 'en',
    },
    `"${v.user.revision}"`,
  );
  return api;
}

async function photo(
  api: Api,
  projectId: string,
  kind: DemoScene,
  progress: number,
  caption: string,
) {
  const body = await demoPhoto(kind, progress, caption);
  const grant = await api.post(`/v1/projects/${projectId}/uploads`, {
    contentType: 'image/jpeg',
    sizeBytes: body.length,
  });
  const put = await fetch(grant.url as string, {
    method: 'PUT',
    headers: grant.headers as Record<string, string>,
    body: new Uint8Array(body),
  });
  if (!put.ok) throw new Error(`photo upload → ${put.status}`);
  return { uploadKey: grant.key as string };
}

/** Invite → sign in → accept. */
async function join(
  base: string,
  by: Api,
  projectId: string,
  person: DemoPerson,
  financialVisibility = false,
) {
  const inv = await by.post(`/v1/projects/${projectId}/invitations`, {
    channel: 'sms',
    recipient: person.phone,
    role: person.role,
    financialVisibility,
  });
  const api = await signIn(base, person);
  await api.post(`/v1/invitations/${inv.id}/accept`);
  return api;
}

const who = (key: string) => DEMO_PEOPLE.find((p) => p.key === key)!;

/** Back-to-back stages: the first starts `firstStart` days ago, each lasts its number of days. */
async function planDates(
  api: Api,
  projectId: string,
  firstStart: number,
  durations: number[],
) {
  const etag = await api.etag(`/v1/projects/${projectId}/plan`);
  const plan = await api.get(`/v1/projects/${projectId}/plan`);
  let cursor = firstStart;
  await api.put(
    `/v1/projects/${projectId}/plan`,
    {
      stages: (plan.stages as Json[]).map((s, i) => {
        const days = durations[i] ?? 14;
        const stage = {
          id: s.id,
          name: s.name,
          weight: s.weight,
          plannedStart: daysAgo(cursor),
          plannedEnd: daysAgo(cursor - days + 1),
          criteria: s.criteria,
        };
        cursor -= days;
        return stage;
      }),
    },
    etag,
  );
}

async function accept(owner: Api, projectId: string) {
  const etag = await owner.etag(`/v1/projects/${projectId}`);
  await owner.post(
    `/v1/projects/${projectId}/acceptance`,
    { decision: 'accept' },
    etag,
  );
}

async function agreeQuote(
  contractor: Api,
  owner: Api,
  projectId: string,
  quote: object,
) {
  const q = await contractor.post(`/v1/projects/${projectId}/quotes`, quote);
  const sent = await contractor.post(
    `/v1/projects/${projectId}/quotes/${q.id}/send`,
  );
  await owner.post(
    `/v1/projects/${projectId}/quotes/${q.id}/decision`,
    { decision: 'accept', revision: 1 },
    `"${sent.version}"`,
  );
}

async function submitted(api: Api, path: string, body: object) {
  const d = await api.post(path, body);
  return api.post(`${path}/${d.id}/submit`, undefined, `"${d.version}"`);
}

async function house(base: string, eric: Api, orgId: string) {
  const template = stageTemplates.house;
  const p = await eric.post('/v1/projects', {
    organizationId: orgId,
    name: 'Kicukiro family house',
    type: 'house',
    location: {
      province: 'Kigali City',
      district: 'Kicukiro',
      sector: 'Niboye',
    },
    contractValue: 48_600_000,
    stages: template.map((s) => ({
      name: STAGE_NAMES[s.key],
      weight: s.weight,
    })),
  });
  const id = p.id as string;
  await planDates(eric, id, 40, [7, 21, 25, 21, 21, 21, 28, 21]);
  const aline = await join(base, eric, id, who('owner'));
  const jean = await join(base, eric, id, who('supervisor'));
  const grace = await join(base, aline, id, who('finance'), true);
  await join(base, aline, id, who('supplier'));
  await join(base, aline, id, who('inspector'));
  await accept(aline, id);
  await agreeQuote(eric, aline, id, {
    title: 'Three-bedroom house, Niboye (Demo agreement)',
    scope:
      'Demo only. Site preparation, foundation, walls, roof, doors and windows, plumbing and electrical, plaster, floors and painting, as on drawing set DEMO-A01 to A06.',
    milestones: [
      { name: 'Site preparation and foundation', amount: 9_500_000 },
      { name: 'Walls and ring beam', amount: 12_000_000 },
      { name: 'Roof', amount: 8_000_000 },
      { name: 'Doors, windows, plumbing and electrical', amount: 10_000_000 },
      { name: 'Plaster, floors and painting', amount: 7_900_000 },
      {
        name: 'Cement and steel (at cost)',
        amount: 1_100_000,
        basis: 'reimbursable',
        feePercent: 10,
      },
    ],
    validUntil: daysAgo(-30),
  });

  const stages = (await eric.get(`/v1/projects/${id}/stages`)) as Json[];
  const stage = (name: string) =>
    stages.find((s) => s.name === name)!.id as string;
  const updates: Json[] = [];
  const update = async (
    by: Api,
    stageName: string,
    day: number,
    note: string,
    shots: [DemoScene, number, string][],
    blockers?: string,
  ) => {
    const photos = [];
    for (const [kind, progress, caption] of shots)
      photos.push(await photo(by, id, kind, progress, caption));
    updates.push(
      await by.post(`/v1/projects/${id}/updates`, {
        stageId: stage(stageName),
        eventDate: daysAgo(day),
        note,
        blockers,
        photos,
      }),
    );
  };
  await update(
    eric,
    'Site preparation',
    36,
    'Site cleared, levelled and set out',
    [
      ['site', 0.4, 'Day 1 · clearing'],
      ['site', 1, 'Day 3 · set out with pegs'],
    ],
  );
  await update(
    jean,
    'Foundation',
    31,
    'Trenches dug to 80 cm and blinding poured',
    [['foundation', 0.2, 'Day 6 · trenches']],
  );
  await update(
    eric,
    'Foundation',
    26,
    'Footings and foundation walls finished',
    [
      ['foundation', 0.6, 'Day 11 · footings'],
      ['foundation', 0.85, 'Day 12 · foundation walls'],
    ],
  );
  await update(
    jean,
    'Foundation',
    21,
    'Ground slab poured; curing for seven days',
    [['foundation', 1, 'Day 16 · slab poured']],
  );
  await update(eric, 'Walls', 14, 'First eight courses of blocks laid', [
    ['walls', 0.25, 'Day 23 · first courses'],
  ]);
  await update(
    jean,
    'Walls',
    10,
    'Work paused two days waiting for cement',
    [],
    'Cement delivery from the supplier is two days late',
  );
  await update(eric, 'Walls', 5, 'Walls at window height on all sides', [
    ['walls', 0.55, 'Day 32 · window height'],
    ['walls', 0.65, 'Day 33 · back wall'],
  ]);
  await update(jean, 'Walls', 1, 'Lintels cast over the windows and doors', [
    ['walls', 0.85, 'Day 37 · lintels'],
  ]);

  // Stages: site preparation accepted by the owner; the foundation waiting for her review.
  const ready = async (name: string) =>
    (
      await eric.post(`/v1/projects/${id}/stages/${stage(name)}/submit`, {
        note: `${name} finished; please review the photos.`,
      })
    ).stage as Json;
  const prep = await ready('Site preparation');
  await aline.post(
    `/v1/projects/${id}/stages/${prep.id}/review`,
    { decision: 'accept' },
    `"${prep.revision}"`,
  );
  await ready('Foundation');

  // Money: an approved and partly paid claim, a claim waiting for the owner.
  const claims = `/v1/projects/${id}/claims`;
  const c1 = await submitted(eric, claims, {
    milestoneIndex: 0,
    amount: 9_500_000,
    note: 'Site preparation and foundation complete, as in the updates.',
    siteUpdateIds: updates.slice(0, 4).map((u) => u.id as string),
  });
  await aline.post(
    `${claims}/${c1.id}/decision`,
    { decision: 'approve', amount: 9_500_000 },
    `"${c1.version}"`,
  );
  const payments = `/v1/projects/${id}/payments`;
  const paid = await aline.post(payments, {
    claimId: c1.id,
    payer: 'Aline Uwase',
    beneficiary: 'Ubaka Builders (Demo)',
    amount: 6_000_000,
    method: 'mtn_momo',
    reference: 'DEMO-MP0001',
    paymentDate: daysAgo(18),
  });
  const first = (paid.payments as Json[])[0];
  await eric.post(
    `${payments}/${first.id}/verify`,
    { decision: 'settle' },
    `"${first.version}"`,
  );
  await aline.post(payments, {
    claimId: c1.id,
    payer: 'Aline Uwase',
    beneficiary: 'Ubaka Builders (Demo)',
    amount: 3_500_000,
    method: 'bank_transfer',
    reference: 'DEMO-BK0002',
    paymentDate: daysAgo(2),
    note: 'Second part of the foundation payment.',
  });
  await submitted(eric, claims, {
    milestoneIndex: 1,
    amount: 4_000_000,
    note: 'Walls to lintel level (about a third of the walls package).',
    siteUpdateIds: updates.slice(4).map((u) => u.id as string),
  });

  // Spending on the at-cost package: approved with a posted expense, returned, and waiting.
  const spending = `/v1/projects/${id}/spending`;
  const cement = await submitted(eric, spending, {
    milestoneIndex: 5,
    purpose: 'Cement for the walls',
    lines: [
      {
        description: 'Cement bags, 50 kg',
        quantity: '40',
        unit: 'bag',
        unitRate: 15_000,
      },
    ],
  });
  await aline.post(
    `${spending}/${cement.id}/decision`,
    { decision: 'approve', amount: cement.amount },
    `"${cement.version}"`,
  );
  await grace.post(`${spending}/${cement.id}/expenses`, {
    description: 'Cement, first delivery (20 bags)',
    supplierName: 'Kigali Hardware (Demo)',
    expenseDate: daysAgo(9),
    amount: 300_000,
  });
  const steel = await submitted(eric, spending, {
    milestoneIndex: 5,
    purpose: 'Steel bars for the ring beam',
    lines: [
      {
        description: 'Y12 steel bars',
        quantity: '30',
        unit: 'bar',
        unitRate: 12_500,
      },
    ],
  });
  await aline.post(
    `${spending}/${steel.id}/decision`,
    {
      decision: 'request_changes',
      amount: steel.amount,
      note: 'Please add a second quotation.',
    },
    `"${steel.version}"`,
  );
  await submitted(eric, spending, {
    milestoneIndex: 5,
    purpose: 'Sand for plastering',
    lines: [
      {
        description: 'Sand, 10-tonne truck',
        quantity: '2',
        unit: 'truck',
        unitRate: 120_000,
      },
    ],
  });

  // A budget change the owner asked for, waiting for her decision.
  await submitted(eric, `/v1/projects/${id}/changes`, {
    category: 'owner_request',
    reason:
      'Add a garden wall along the road side, as the owner asked on site.',
    scheduleDays: 5,
    lines: [{ milestoneIndex: 4, delta: 1_200_000 }],
  });
  return { id, jean, aline };
}

async function renovation(base: string, eric: Api, orgId: string) {
  const p = await eric.post('/v1/projects', {
    organizationId: orgId,
    name: 'Remera apartment renovation',
    type: 'renovation',
    location: { province: 'Kigali City', district: 'Gasabo', sector: 'Remera' },
    contractValue: 15_800_000,
    stages: stageTemplates.renovation.map((s) => ({
      name: STAGE_NAMES[s.key],
      weight: s.weight,
    })),
  });
  const id = p.id as string;
  await planDates(eric, id, 16, [10, 14, 14, 21, 7]);
  const samuel = await join(base, eric, id, who('owner2'));
  const claudine = await join(base, eric, id, who('supervisor2'));
  await accept(samuel, id);
  await agreeQuote(eric, samuel, id, {
    title: 'Kitchen and bathroom renovation (Demo agreement)',
    scope:
      'Demo only. Damp repair, new plumbing and wiring in the kitchen and bathroom, tiles and paint.',
    milestones: [
      { name: 'Assessment and damp repair', amount: 2_300_000 },
      { name: 'Plumbing and electrical', amount: 4_500_000 },
      { name: 'Tiles and finishes', amount: 7_000_000 },
      { name: 'Cleaning and handover', amount: 2_000_000 },
    ],
    validUntil: daysAgo(-30),
  });
  const stages = (await eric.get(`/v1/projects/${id}/stages`)) as Json[];
  const u1 = await claudine.post(`/v1/projects/${id}/updates`, {
    stageId: stages[0].id,
    eventDate: daysAgo(12),
    note: 'Damp found behind the kitchen tiles; old tiles removed',
    photos: [
      await photo(claudine, id, 'interior', 0.15, 'Kitchen · old tiles off'),
    ],
  });
  const u2 = await eric.post(`/v1/projects/${id}/updates`, {
    stageId: stages[1].id,
    eventDate: daysAgo(3),
    note: 'Walls treated and replastered',
    photos: [await photo(eric, id, 'interior', 0.55, 'Kitchen · replastered')],
  });
  await submitted(eric, `/v1/projects/${id}/claims`, {
    milestoneIndex: 0,
    amount: 2_300_000,
    note: 'Assessment and damp repair done.',
    siteUpdateIds: [u1.id, u2.id],
  });
}

/** Waits until the job workers have made every thumbnail and sent every event. */
async function settle() {
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    for (let i = 0; i < 120; i++) {
      const { rows } = await db.query<{ media: string; events: string }>(
        `select (select count(*) from media where scan_status = 'pending') as media,
                (select count(*) from outbox_events where published_at is null) as events`,
      );
      if (Number(rows[0].media) === 0 && Number(rows[0].events) === 0) return;
      await pause(1000);
    }
    throw new Error('Photos or events still waiting after two minutes');
  } finally {
    await db.end();
  }
}

async function main() {
  if (env.DEMO_MODE !== 'on')
    throw new Error('Set DEMO_MODE=on: demo:reset wipes the whole database');
  if (env.APP_ENV === 'production')
    throw new Error('Refusing to touch a production environment');
  const started = Date.now();
  console.log(
    `Wiping ${new URL(env.DATABASE_URL).pathname.slice(1)} and ${env.S3_BUCKET}…`,
  );
  await prepareDatabase();
  await wipe();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn'],
  });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  try {
    console.log('Building the demo projects…');
    const eric = await signIn(base, who('contractor'));
    const org = await eric.post('/v1/organizations', {
      name: 'Ubaka Builders (Demo)',
      kind: 'contractor',
    });
    const h = await house(base, eric, org.id as string);
    await renovation(base, eric, org.id as string);
    await settle();
    // The weekly report once the photos are ready, shared by the owner.
    const report = await h.jean.post(`/v1/projects/${h.id}/reports`, {});
    const share = await h.aline.post(
      `/v1/projects/${h.id}/reports/${report.id}/shares`,
      { sections: [...SHARE_SECTIONS], expiresInDays: 30, allowDownload: true },
    );
    await settle();
    console.log(
      `Demo ready in ${((Date.now() - started) / 1000).toFixed(0)} s. Sign in with code ${DEMO_CODE}:`,
    );
    for (const p of DEMO_PEOPLE)
      console.log(
        `  ${p.phone}  ${p.name.padEnd(22)} ${p.role} · ${{ house: 'Kicukiro family house', renovation: 'Remera apartment renovation', both: 'both projects' }[p.project]}`,
      );
    console.log(`  Shared report link: ${share.url}`);
  } finally {
    await app.close();
  }
}

void main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
