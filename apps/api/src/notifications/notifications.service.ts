import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import {
  type NotificationKind,
  type NotificationList,
  type NotificationView,
  type ProjectRole,
  DECISION_LATE_DAYS,
  daysWaiting,
  inQuietHours,
  localClock,
  type NotificationSettings,
  RegisterPushDeviceRequest,
  RemovePushDeviceRequest,
  UpdateNotificationSettings,
} from '@jengalink/contracts';
import { createHash } from 'node:crypto';
import { createTranslator, formatDate, isLocale } from '@jengalink/i18n';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { ZodPipe } from '../common/zod.pipe';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import {
  budgetChanges,
  claims,
  notifications,
  outboxEvents,
  projectMemberships,
  projects,
  pushDevices,
  siteUpdates,
  spendingRequests,
  stages,
  users,
} from '../db/schema';
import type { EventEnvelope } from '../jobs/events';
import { JobsService } from '../jobs/jobs.service';
import { recordEvent } from '../jobs/outbox';
import { PUSH_SENDER, type PushSender } from './push-sender';

const DECIDERS: readonly ProjectRole[] = ['owner', 'delegate'];
/** Who hears about a problem on site: the client and the people who run the work. */
const PROBLEM_READERS: readonly ProjectRole[] = [
  'owner',
  'delegate',
  'contractor',
  'manager',
];
const registerPipe = new ZodPipe(RegisterPushDeviceRequest);
const removePipe = new ZodPipe(RemovePushDeviceRequest);
const settingsPipe = new ZodPipe(UpdateNotificationSettings);
const quietOf = (u: { quietStart: string | null; quietEnd: string | null }) =>
  u.quietStart && u.quietEnd ? { start: u.quietStart, end: u.quietEnd } : null;
/** A stable id for "this person's reminder on this day": the unique key makes it once only. */
const dayKey = (userId: string, date: string) => {
  const h = createHash('sha256')
    .update(`reminder:${userId}:${date}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
type Row = typeof notifications.$inferSelect;
interface Draft {
  kind: NotificationKind;
  projectId: string;
  path: string;
  params: Record<string, string>;
  /** Members with these roles hear about it… */
  roles: readonly ProjectRole[] | 'all';
}

/**
 * Notifications (spec §9.4): domain events become one notification per person, which links to
 * the exact item; a second step pushes it to their phones. The text never carries amounts or
 * addresses (lock screens), and a failed push is recorded, never undone into the workflow.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  static readonly consumer = 'notify';
  static readonly pushConsumer = 'push';
  private readonly logger = new Logger(NotificationsService.name);
  /** The time quiet hours and reminders are judged at (tests move it). */
  clock: () => Date = () => new Date();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jobs: JobsService,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
  ) {}

  onModuleInit() {
    const on = <T extends Parameters<JobsService['on']>[0]>(
      type: T,
      draft: (
        payload: EventEnvelope<T>['payload'],
        tx: Tx,
      ) => Promise<Draft | null>,
    ) =>
      this.jobs.on(
        type,
        NotificationsService.consumer,
        async (payload, tx, event) => {
          const d = await draft(payload, tx);
          if (d) await this.create(tx, d, event.eventId);
        },
      );

    on('claim.submitted', async ({ claimId, projectId }, tx) => {
      const [c] = await tx.select().from(claims).where(eq(claims.id, claimId));
      return c
        ? {
            kind: 'claim_to_decide',
            projectId,
            path: `/project/${projectId}/claims/${claimId}`,
            params: { number: c.number },
            roles: DECIDERS,
          }
        : null;
    });
    on('spending.submitted', async ({ requestId, projectId }, tx) => {
      const [r] = await tx
        .select()
        .from(spendingRequests)
        .where(eq(spendingRequests.id, requestId));
      return r
        ? {
            kind: 'spending_to_decide',
            projectId,
            path: `/project/${projectId}/spending/${requestId}`,
            params: { number: r.number },
            roles: DECIDERS,
          }
        : null;
    });
    on('change.submitted', async ({ changeId, projectId }, tx) => {
      const [c] = await tx
        .select()
        .from(budgetChanges)
        .where(eq(budgetChanges.id, changeId));
      return c
        ? {
            kind: 'change_to_decide',
            projectId,
            path: `/project/${projectId}/changes/${changeId}`,
            params: { number: c.number },
            roles: DECIDERS,
          }
        : null;
    });
    on('report.published', ({ reportId, projectId, weekStart }) =>
      Promise.resolve({
        kind: 'report_published',
        projectId,
        path: `/project/${projectId}/reports/${reportId}`,
        params: { weekStart },
        roles: 'all',
      }),
    );
    on(
      'site_update.submitted',
      async ({ siteUpdateId, projectId, hasBlockers }, tx) => {
        if (!hasBlockers) return null;
        const [u] = await tx
          .select({
            stageId: siteUpdates.stageId,
            stage: stages.name,
            author: users.displayName,
          })
          .from(siteUpdates)
          .innerJoin(stages, eq(stages.id, siteUpdates.stageId))
          .leftJoin(users, eq(users.id, siteUpdates.createdBy))
          .where(eq(siteUpdates.id, siteUpdateId));
        return u
          ? {
              kind: 'update_problem',
              projectId,
              path: `/project/${projectId}/stages/${u.stageId}`,
              params: { stage: u.stage, name: u.author ?? '' },
              roles: PROBLEM_READERS,
            }
          : null;
      },
    );

    // Once decided, "waiting for your decision" is no longer news: mark it read for everyone.
    const settle = async (tx: Tx, path: string) => {
      await tx
        .update(notifications)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(and(eq(notifications.path, path), isNull(notifications.readAt)));
    };
    this.jobs.on(
      'claim.decided',
      NotificationsService.consumer,
      ({ claimId, projectId }, tx) =>
        settle(tx, `/project/${projectId}/claims/${claimId}`),
    );
    this.jobs.on(
      'spending.decided',
      NotificationsService.consumer,
      ({ requestId, projectId }, tx) =>
        settle(tx, `/project/${projectId}/spending/${requestId}`),
    );
    this.jobs.on(
      'change.decided',
      NotificationsService.consumer,
      ({ changeId, projectId }, tx) =>
        settle(tx, `/project/${projectId}/changes/${changeId}`),
    );

    this.jobs.on(
      'notification.created',
      NotificationsService.pushConsumer,
      async ({ notificationIds }, tx) => this.deliver(tx, notificationIds),
    );
  }

  /* ---------- in-app ---------- */

  async list(userId: string): Promise<NotificationList> {
    const locale = await this.localeOf(this.db, userId);
    const rows = await this.db
      .select({ n: notifications, project: projects.name })
      .from(notifications)
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [{ unread }] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return {
      unread,
      items: rows.map((r) => this.view(r.n, r.project, locale)),
    };
  }

  async markRead(
    userId: string,
    notificationId: string,
  ): Promise<NotificationView> {
    const [n] = await this.db
      .update(notifications)
      .set({
        readAt: sql`coalesce(${notifications.readAt}, now())`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
        ),
      )
      .returning();
    if (!n) throw new NotFoundException('Notification not found');
    const [p] = await this.db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, n.projectId));
    return this.view(n, p?.name ?? '', await this.localeOf(this.db, userId));
  }

  async markAllRead(userId: string): Promise<NotificationList> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return this.list(userId);
  }

  /** This phone receives the person's pushes; a token signed in elsewhere moves to them. */
  async registerDevice(userId: string, body: unknown): Promise<void> {
    const req = registerPipe.transform(body);
    await this.db
      .insert(pushDevices)
      .values({
        userId,
        token: req.token,
        platform: req.platform,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: pushDevices.token,
        set: {
          userId,
          platform: req.platform,
          lastSeenAt: new Date(),
          disabledAt: null,
          updatedAt: new Date(),
        },
      });
  }

  async removeDevice(userId: string, body: unknown): Promise<void> {
    const req = removePipe.transform(body);
    await this.db
      .delete(pushDevices)
      .where(
        and(eq(pushDevices.token, req.token), eq(pushDevices.userId, userId)),
      );
  }

  /* ---------- settings ---------- */

  async settings(userId: string): Promise<NotificationSettings> {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    return {
      remindersEnabled: u.remindersEnabled,
      quietHours: quietOf(u),
      timeZone: u.timeZone,
    };
  }

  async updateSettings(
    userId: string,
    body: unknown,
  ): Promise<NotificationSettings> {
    const req = settingsPipe.transform(body);
    await this.db
      .update(users)
      .set({
        remindersEnabled: req.remindersEnabled,
        quietStart: req.quietHours?.start ?? null,
        quietEnd: req.quietHours?.end ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    return this.settings(userId);
  }

  /* ---------- the reminder sweep (every few minutes) ---------- */

  /**
   * Releases pushes held for quiet hours that have ended, then sends each person at most one
   * reminder a day (their local day) when decisions have waited more than 2 days. Safe to run
   * from several workers: the unique (event, person) key keeps a reminder to once a day.
   */
  async sweep(
    inbox: (
      userId: string,
    ) => Promise<{ items: { since: string; projectId: string }[] }>,
  ) {
    const now = this.clock();
    let released = 0;
    let reminded = 0;
    const held = await this.db
      .select({
        id: notifications.id,
        quietStart: users.quietStart,
        quietEnd: users.quietEnd,
        timeZone: users.timeZone,
      })
      .from(notifications)
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(eq(notifications.pushStatus, 'held'));
    const ready = held
      .filter((h) => !inQuietHours(now, quietOf(h), h.timeZone))
      .map((h) => h.id);
    if (ready.length)
      await this.db.transaction(async (tx) => {
        await tx
          .update(notifications)
          .set({ pushStatus: 'pending', updatedAt: new Date() })
          .where(
            and(
              inArray(notifications.id, ready),
              eq(notifications.pushStatus, 'held'),
            ),
          );
        await recordEvent(tx, 'notification.created', {
          notificationIds: ready,
        });
        released = ready.length;
      });

    const people = await this.db
      .selectDistinct({
        id: users.id,
        quietStart: users.quietStart,
        quietEnd: users.quietEnd,
        timeZone: users.timeZone,
      })
      .from(users)
      .innerJoin(
        projectMemberships,
        and(
          eq(projectMemberships.userId, users.id),
          eq(projectMemberships.status, 'active'),
        ),
      )
      .where(eq(users.remindersEnabled, true));
    for (const u of people) {
      if (inQuietHours(now, quietOf(u), u.timeZone)) continue;
      const late = (await inbox(u.id)).items.filter(
        (i) => daysWaiting(i.since, now.getTime()) > DECISION_LATE_DAYS,
      );
      if (!late.length) continue;
      const [project] = await this.db
        .select({ organizationId: projects.organizationId })
        .from(projects)
        .where(eq(projects.id, late[0].projectId));
      await this.db.transaction(async (tx) => {
        const made = await tx
          .insert(notifications)
          .values({
            organizationId: project.organizationId,
            projectId: late[0].projectId,
            userId: u.id,
            kind: 'decisions_reminder',
            path: '/',
            params: {
              count: String(late.length),
              days: String(daysWaiting(late[0].since, now.getTime())),
            },
            sourceEventId: dayKey(u.id, localClock(now, u.timeZone).date),
          })
          .onConflictDoNothing()
          .returning({ id: notifications.id });
        if (made.length) {
          await recordEvent(tx, 'notification.created', {
            notificationIds: made.map((m) => m.id),
          });
          reminded++;
        }
      });
    }
    return { released, reminded };
  }

  /* ---------- internals ---------- */

  /** One notification per member (not the person who caused it), then one push job. */
  private async create(tx: Tx, d: Draft, eventId: string) {
    const [project] = await tx
      .select({ organizationId: projects.organizationId })
      .from(projects)
      .where(eq(projects.id, d.projectId));
    if (!project) return;
    const [source] = await tx
      .select({ actor: outboxEvents.createdBy })
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    const members = await tx
      .selectDistinct({ userId: projectMemberships.userId })
      .from(projectMemberships)
      .where(
        and(
          eq(projectMemberships.projectId, d.projectId),
          eq(projectMemberships.status, 'active'),
          d.roles === 'all'
            ? undefined
            : inArray(projectMemberships.role, [...d.roles]),
          source?.actor
            ? ne(projectMemberships.userId, source.actor)
            : undefined,
        ),
      );
    if (!members.length) return;
    const made = await tx
      .insert(notifications)
      .values(
        members.map((m) => ({
          organizationId: project.organizationId,
          projectId: d.projectId,
          userId: m.userId,
          kind: d.kind,
          path: d.path,
          params: d.params,
          sourceEventId: eventId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (made.length)
      await recordEvent(tx, 'notification.created', {
        notificationIds: made.map((m) => m.id),
      });
  }

  /** Pushes each notification to its person's phones in their language. */
  private async deliver(tx: Tx, ids: string[]) {
    const rows = await tx
      .select({
        n: notifications,
        project: projects.name,
        locale: users.locale,
        quietStart: users.quietStart,
        quietEnd: users.quietEnd,
        timeZone: users.timeZone,
      })
      .from(notifications)
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .innerJoin(users, eq(users.id, notifications.userId))
      .where(
        and(
          inArray(notifications.id, ids),
          eq(notifications.pushStatus, 'pending'),
        ),
      );
    for (const { n, project, locale, ...who } of rows) {
      // Quiet hours: the push waits (the reminder sweep releases it); the in-app list has it now.
      if (inQuietHours(this.clock(), quietOf(who), who.timeZone)) {
        await tx
          .update(notifications)
          .set({ pushStatus: 'held', updatedAt: new Date() })
          .where(eq(notifications.id, n.id));
        continue;
      }
      const devices = await tx
        .select()
        .from(pushDevices)
        .where(
          and(eq(pushDevices.userId, n.userId), isNull(pushDevices.disabledAt)),
        );
      if (!devices.length) {
        await tx
          .update(notifications)
          .set({ pushStatus: 'no_device', updatedAt: new Date() })
          .where(eq(notifications.id, n.id));
        continue;
      }
      const v = this.view(n, project, isLocale(locale) ? locale : 'en');
      const results = await this.push.send(
        devices.map((d) => ({
          token: d.token,
          title: v.title,
          body: v.body,
          data: { path: n.path, notificationId: n.id },
        })),
      );
      const gone = devices.filter((_, i) => {
        const r = results[i];
        return r && !r.ok && r.gone;
      });
      if (gone.length)
        await tx
          .update(pushDevices)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(
            inArray(
              pushDevices.id,
              gone.map((d) => d.id),
            ),
          );
      const sent = results.some((r) => r.ok);
      const error =
        results.find((r): r is Extract<typeof r, { ok: false }> => !r.ok)
          ?.error ?? null;
      if (!sent)
        this.logger.warn(`Push failed for notification ${n.id}: ${error}`);
      await tx
        .update(notifications)
        .set({
          pushStatus: sent ? 'sent' : 'failed',
          pushError: sent ? null : error,
          pushedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(notifications.id, n.id));
    }
  }

  private async localeOf(db: Database | Tx, userId: string) {
    const [u] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    return isLocale(u?.locale) ? u.locale : 'en';
  }

  private view(
    n: Row,
    project: string,
    locale: Parameters<typeof createTranslator>[0],
  ): NotificationView {
    const t = createTranslator(locale);
    const params = {
      ...n.params,
      ...(n.params.count ? { count: Number(n.params.count) } : {}),
      project,
      ...(n.params.weekStart
        ? {
            week: formatDate(
              locale,
              new Date(`${n.params.weekStart}T12:00:00`),
            ),
          }
        : {}),
    };
    return {
      id: n.id,
      kind: n.kind,
      projectId: n.projectId,
      title: t(`notify.title_${n.kind}`),
      body: t(`notify.body_${n.kind}`, params),
      path: n.path,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    };
  }
}
