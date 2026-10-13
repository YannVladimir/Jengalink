import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type {
  ApiErrorBody,
  AuditEventView,
  CreatedInvitation,
  MemberView,
  OrganizationView,
  ProjectSummary,
  StartOtpResponse,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { discoverRoutes } from '../src/openapi/build';
import type { Database } from '../src/db/client';
import { DB } from '../src/db/database.module';
import { ConsoleMessageSender } from '../src/messaging/message-sender';
import { configureApp } from '../src/app.setup';

const METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'all',
  'options',
  'head',
] as const;
const FAKE_ID = '01900000-0000-7000-8000-000000000099';

/** The only routes allowed without a session. Adding a public route must update this list. */
const EXPECTED_PUBLIC = [
  'GET /health',
  'POST /v1/auth/otp/start',
  'POST /v1/auth/otp/verify',
  'POST /v1/auth/refresh',
  // A shared report link: the token is the permission, checked on every request.
  'GET /v1/shared/reports/:token',
  'POST /v1/shared/reports/:token/pdf',
].sort();

interface Route {
  method: (typeof METHODS)[number];
  path: string;
  isPublic: boolean;
}

describe('security: permission checks on every endpoint, audit trail, error shape (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let sender: ConsoleMessageSender;
  let routes: Route[];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    db = moduleRef.get(DB);
    sender = moduleRef.get(ConsoleMessageSender);

    // Discover every route from controller metadata, so new endpoints are covered automatically.
    routes = [];
    for (const mod of moduleRef.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as unknown as {
          prototype: Record<string, unknown>;
        } | null;
        if (!ctrl) continue;
        const base = (Reflect.getMetadata(PATH_METADATA, ctrl) as string) ?? '';
        const classPublic = Reflect.getMetadata('isPublic', ctrl) === true;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          const handler = ctrl.prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const sub = Reflect.getMetadata(PATH_METADATA, handler) as
            string | undefined;
          if (sub === undefined) continue;
          const method =
            METHODS[Reflect.getMetadata(METHOD_METADATA, handler) as number];
          const joined =
            `/${[base, sub].filter((p) => p && p !== '/').join('/')}`.replace(
              /\/+/g,
              '/',
            );
          const path = joined === '/health' ? joined : `/v1${joined}`;
          routes.push({
            method,
            path,
            isPublic:
              classPublic || Reflect.getMetadata('isPublic', handler) === true,
          });
        }
      }
    }
  });

  beforeEach(async () => {
    await db.execute(sql`truncate audit_events, invitations, project_memberships, organization_memberships, projects,
      organizations, sessions, otp_challenges, users, outbox_events, processed_events cascade`);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  async function user(local: string, name: string) {
    const started = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel: 'sms', destination: local })
        .expect(202)
    ).body as StartOtpResponse;
    const v = (
      await http()
        .post('/v1/auth/otp/verify')
        .send({
          challengeId: started.challengeId,
          code: sender.lastCodeFor(`+250${local.slice(1)}`),
        })
        .expect(200)
    ).body as VerifyOtpResponse;
    const auth = { Authorization: `Bearer ${v.accessToken}` };
    await http()
      .patch('/v1/me')
      .set(auth)
      .set('If-Match', `"${v.user.revision}"`)
      .send({ displayName: name })
      .expect(200);
    return {
      id: v.user.id,
      refreshToken: v.refreshToken,
      req: (method: Route['method'], url: string, body?: object) =>
        http()
          [method as 'get'](url)
          .set(auth)
          .set('Idempotency-Key', randomUUID())
          .send(body ?? {}),
    };
  }

  /** Contractor + accepted owner on one project; returns ids for the sweep. */
  async function world() {
    const contractor = await user('0788000011', 'Eric Mugisha');
    const org = (
      await contractor
        .req('post', '/v1/organizations', {
          name: 'Ubaka Builders',
          kind: 'contractor',
        })
        .expect(201)
    ).body as OrganizationView;
    const project = (
      await contractor
        .req('post', '/v1/projects', {
          organizationId: org.id,
          name: 'Kicukiro House',
          contractValue: 45_000_000,
          stages: [{ name: 'Foundation', weight: 100 }],
        })
        .expect(201)
    ).body as ProjectSummary;
    const inv = (
      await contractor
        .req('post', `/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: '0788000012',
          role: 'owner',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const owner = await user('0788000012', 'Aline Uwase');
    await owner.req('post', `/v1/invitations/${inv.id}/accept`).expect(200);
    return { contractor, owner, org, project, invitation: inv };
  }

  it('documents every route with a @Contract (so OpenAPI and the typed client are complete)', () => {
    const missing = discoverRoutes(app)
      .filter((r) => !r.contract)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(missing).toEqual([]);
  });

  it('allows exactly the intended public routes', () => {
    expect(routes.length).toBeGreaterThan(20);
    const publicRoutes = routes
      .filter((r) => r.isPublic)
      .map((r) => `${r.method.toUpperCase()} ${r.path}`)
      .sort();
    expect(publicRoutes).toEqual(EXPECTED_PUBLIC);
  });

  it('rejects every non-public route without a session (401, spec error shape)', async () => {
    for (const r of routes.filter((x) => !x.isPublic)) {
      const url = r.path.replace(/:[A-Za-z]+/g, FAKE_ID);
      const res = await http()[r.method as 'get'](url);
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({
        route: `${r.method} ${r.path}`,
        status: 401,
      });
      const body = res.body as ApiErrorBody;
      expect(body.code).toBe('unauthorized');
      expect(body.requestId).toBe(res.headers['x-request-id']);
    }
  });

  it('a signed-in stranger who knows the ids gets 404 on every project and organization route', async () => {
    const { owner, org, project } = await world();
    const members = (
      await owner.req('get', `/v1/projects/${project.id}/members`).expect(200)
    ).body as MemberView[];
    const stranger = await user('0788000013', 'Stranger');

    const scoped = routes.filter(
      (r) => !r.isPublic && /^\/v1\/(projects|organizations)\/:id/.test(r.path),
    );
    expect(scoped.length).toBeGreaterThanOrEqual(7);
    for (const r of scoped) {
      const url = r.path
        .replace(':membershipId', members[0].membershipId)
        .replace(
          ':id',
          r.path.startsWith('/v1/organizations') ? org.id : project.id,
        )
        // Any other id in the path (stage, quote, …): a well-formed id that is not theirs.
        .replace(/:[A-Za-z]+/g, FAKE_ID);
      const res = await stranger.req(r.method, url, {
        channel: 'sms',
        recipient: '0788000013',
        role: 'viewer',
      });
      expect({ route: `${r.method} ${r.path}`, status: res.status }).toEqual({
        route: `${r.method} ${r.path}`,
        status: 404,
      });
      // The error never names the hidden project.
      expect(JSON.stringify(res.body)).not.toContain('Kicukiro');
    }
  });

  it('returns the spec error shape with field errors and retry hints', async () => {
    const bad = await http()
      .post('/v1/auth/otp/start')
      .send({ channel: 'fax' })
      .expect(400);
    const body = bad.body as ApiErrorBody;
    expect(body).toMatchObject({
      statusCode: 400,
      code: 'bad_request',
      retryable: false,
    });
    expect(body.fieldErrors.map((f) => f.field)).toEqual(
      expect.arrayContaining(['channel', 'destination']),
    );
    expect(body.requestId).toBe(bad.headers['x-request-id']);

    await http()
      .post('/v1/auth/otp/start')
      .send({ channel: 'sms', destination: '0788000014' })
      .expect(202);
    const limited = (
      await http()
        .post('/v1/auth/otp/start')
        .send({ channel: 'sms', destination: '0788000014' })
        .expect(429)
    ).body as ApiErrorBody;
    expect(limited).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);

    // A well-formed incoming request id is kept, for tracing across systems.
    const traced = await http()
      .get('/health')
      .set('x-request-id', 'trace-abc-12345');
    expect(traced.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('records sensitive actions with who, when and where, without codes or full contacts', async () => {
    const { contractor, owner, project } = await world();
    const etag = (
      await owner.req('get', `/v1/projects/${project.id}`).expect(200)
    ).headers.etag;
    await owner
      .req('post', `/v1/projects/${project.id}/acceptance`, {
        decision: 'accept',
      })
      .set('If-Match', etag)
      .expect(200);
    const sup = (
      await owner
        .req('post', `/v1/projects/${project.id}/invitations`, {
          channel: 'sms',
          recipient: '0722000015',
          role: 'supervisor',
        })
        .expect(201)
    ).body as CreatedInvitation;
    const supervisor = await user('0722000015', 'Jean Habimana');
    await supervisor
      .req('post', `/v1/invitations/${sup.id}/accept`)
      .expect(200);
    const members = (
      await owner.req('get', `/v1/projects/${project.id}/members`).expect(200)
    ).body as MemberView[];
    await owner
      .req(
        'delete',
        `/v1/projects/${project.id}/members/${members.find((m) => m.role === 'supervisor')!.membershipId}`,
      )
      .expect(204);

    const trail = (
      await owner.req('get', `/v1/projects/${project.id}/audit`).expect(200)
    ).body as AuditEventView[];
    expect(trail.map((e) => e.action).reverse()).toEqual([
      'project.created',
      'invitation.created',
      'invitation.accepted',
      'project.accepted',
      'invitation.created',
      'invitation.accepted',
      'member.removed',
    ]);
    expect(trail[0]).toMatchObject({
      action: 'member.removed',
      actorName: 'Aline Uwase',
      metadata: { role: 'supervisor' },
    });

    const rows = await db.execute<{
      action: string;
      ip: string | null;
      request_id: string | null;
      actor_session_id: string | null;
      metadata: unknown;
    }>(
      sql`select action, ip, request_id, actor_session_id, metadata from audit_events`,
    );
    const signIns = rows.rows.filter((r) => r.action === 'auth.signed_in');
    expect(signIns).toHaveLength(3);
    for (const r of rows.rows) {
      expect(r.request_id).toBeTruthy();
      expect(r.ip).toBeTruthy();
      expect(r.actor_session_id).toBeTruthy();
    }
    const all = JSON.stringify(rows.rows);
    expect(all).not.toContain('+250788000012'); // contacts are masked
    expect(all).not.toMatch(/code"?:\s*"?\d{6}/); // never a sign-in code

    // Only owners read the trail; strangers cannot discover it.
    await contractor.req('get', `/v1/projects/${project.id}/audit`).expect(403);
    await supervisor.req('get', `/v1/projects/${project.id}/audit`).expect(404);
  });

  it('records a detected refresh-token theft', async () => {
    const u = await user('0788000016', 'Victim');
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken })
      .expect(200);
    await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: u.refreshToken })
      .expect(401);
    const rows = await db.execute<{ action: string }>(
      sql`select action from audit_events where actor_user_id = ${u.id}`,
    );
    expect(rows.rows.map((r) => r.action)).toContain(
      'auth.refresh_reuse_detected',
    );
  });

  it('keeps the audit trail append-only in the database itself', async () => {
    await user('0788000017', 'Someone');
    await expect(
      db.execute(sql`update audit_events set action = 'tampered'`),
    ).rejects.toThrow();
    await expect(db.execute(sql`delete from audit_events`)).rejects.toThrow();
    const rows = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from audit_events where action = 'tampered'`,
    );
    expect(rows.rows[0].n).toBe(0);
  });
});
