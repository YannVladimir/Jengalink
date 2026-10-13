import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  CreatedInvitation,
  CreateInvitationRequest,
  InvitationState,
  InvitationView,
  OrganizationRole,
  ProjectRole,
} from '@jengalink/contracts';
import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizeRwandanMobile,
} from '../auth/contact';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import {
  invitations,
  organizationMemberships,
  organizations,
  projectMemberships,
  projects,
  stages,
  users,
} from '../db/schema';
import { recordEvent } from '../jobs/outbox';
import { createTranslator, isLocale, type Locale } from '@jengalink/i18n';
import { AuditService } from '../audit/audit.service';
import { AccessService, seesMoney } from './access.service';

export const INVITATION_DAYS = 7;

const PROJECT_ROLES: readonly ProjectRole[] = [
  'owner',
  'delegate',
  'manager',
  'contractor',
  'supervisor',
  'finance',
  'inspector',
  'supplier',
  'viewer',
];

/** Who may invite whom (spec §3.2). Contractors may invite the owner only while the project has none. */
export const INVITABLE: Partial<Record<ProjectRole, readonly ProjectRole[]>> = {
  owner: PROJECT_ROLES,
  manager: ['supervisor', 'inspector', 'supplier', 'viewer'],
  contractor: ['owner', 'supervisor', 'viewer'],
};

export const ROLE_LABEL: Record<string, string> = {
  owner: 'owner',
  delegate: 'owner delegate',
  manager: 'project manager',
  contractor: 'contractor',
  supervisor: 'site supervisor',
  finance: 'finance officer',
  inspector: 'inspector',
  supplier: 'supplier',
  viewer: 'viewer',
  admin: 'admin',
  member: 'member',
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const mask = (channel: 'sms' | 'email', recipient: string) =>
  channel === 'sms' ? maskPhone(recipient) : maskEmail(recipient);

type InvitationRow = typeof invitations.$inferSelect;

export function invitationState(
  i: InvitationRow,
  now = new Date(),
): InvitationState {
  if (i.acceptedAt) return 'accepted';
  if (i.declinedAt) return 'declined';
  if (i.revokedAt) return 'revoked';
  if (i.expiresAt <= now) return 'expired';
  return 'pending';
}

@Injectable()
export class InvitationsService {
  private readonly appUrl: string;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('WEB_APP_URL') ?? 'http://localhost:5173';
  }

  /** Project invitation; the inviter's role limits which roles they may grant. */
  async inviteToProject(
    userId: string,
    projectId: string,
    req: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    const role = req.role as ProjectRole;
    return this.db.transaction(async (tx) => {
      // Access first: a stranger learns nothing, not even that the input was wrong.
      const { project, roles } = await this.access.requireProject(
        userId,
        projectId,
        undefined,
        tx,
      );
      if (!PROJECT_ROLES.includes(role))
        throw new BadRequestException('Unknown project role');
      const canGrant = new Set(roles.flatMap((r) => INVITABLE[r] ?? []));
      if (!canGrant.has(role))
        throw new ForbiddenException(`You cannot invite a ${ROLE_LABEL[role]}`);
      if (role === 'owner' && !roles.includes('owner')) {
        const [owner] = await tx
          .select({ id: projectMemberships.id })
          .from(projectMemberships)
          .where(
            and(
              eq(projectMemberships.projectId, projectId),
              eq(projectMemberships.role, 'owner'),
              eq(projectMemberships.status, 'active'),
            ),
          );
        if (owner)
          throw new ForbiddenException('Only the owner can add another owner');
      }
      return this.create(tx, userId, {
        scope: 'project',
        organizationId: project.organizationId,
        projectId,
        role,
        financialVisibility:
          role === 'owner' || (req.financialVisibility ?? false),
        ...this.recipient(req),
      });
    });
  }

  async inviteToOrganization(
    userId: string,
    organizationId: string,
    req: CreateInvitationRequest,
  ): Promise<CreatedInvitation> {
    // Access first: a stranger learns nothing, not even that the input was wrong.
    await this.access.requireOrganization(userId, organizationId, true);
    if (req.role !== 'admin' && req.role !== 'member')
      throw new BadRequestException('Unknown organization role');
    return this.db.transaction((tx) =>
      this.create(tx, userId, {
        scope: 'organization',
        organizationId,
        projectId: null,
        role: req.role,
        financialVisibility: false,
        ...this.recipient(req),
      }),
    );
  }

  /** Pending invitations sent to the caller's verified phone or email. */
  async listMine(userId: string): Promise<InvitationView[]> {
    const contacts = await this.contactsOf(userId);
    if (contacts.length === 0) return [];
    const rows = await this.query()
      .where(
        and(
          inArray(invitations.recipient, contacts),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(invitations.createdAt));
    return rows.map((r) => this.toView(r));
  }

  /** One invitation sent to the caller (opened from the in-app list). */
  async getMine(userId: string, invitationId: string): Promise<InvitationView> {
    const [row] = await this.query().where(eq(invitations.id, invitationId));
    if (!row) throw new NotFoundException('Invitation not found');
    await this.assertRecipient(userId, row.invitation);
    return this.toView(row);
  }

  /** A project's invitations, newest first, for members who may invite (owner, manager, contractor). */
  async listForProject(
    userId: string,
    projectId: string,
  ): Promise<InvitationView[]> {
    const { roles } = await this.access.requireProject(userId, projectId);
    if (!roles.some((r) => INVITABLE[r]))
      throw new ForbiddenException('You cannot see who was invited');
    const rows = await this.query()
      .where(eq(invitations.projectId, projectId))
      .orderBy(desc(invitations.createdAt))
      .limit(50);
    return rows.map((r) => this.toView(r));
  }

  /** Opens a shared link. Only the person the invitation was sent to may see it. */
  async getByToken(userId: string, token: string): Promise<InvitationView> {
    const [row] = await this.query().where(
      eq(invitations.tokenHash, sha256(token)),
    );
    if (!row) throw new NotFoundException('Invitation not found');
    await this.assertRecipient(userId, row.invitation);
    return this.toView(row);
  }

  async accept(userId: string, invitationId: string): Promise<InvitationView> {
    await this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .for('update');
      if (!inv) throw new NotFoundException('Invitation not found');
      await this.assertRecipient(userId, inv, tx);
      this.assertPending(inv);

      if (inv.scope === 'project' && inv.projectId) {
        await tx
          .insert(projectMemberships)
          .values({
            organizationId: inv.organizationId,
            projectId: inv.projectId,
            userId,
            role: inv.role as ProjectRole,
            financialVisibility: inv.financialVisibility,
            createdBy: userId,
          })
          .onConflictDoNothing();
        if (inv.role === 'owner') {
          await tx
            .update(projects)
            // New revision, so the project's ETag changes once it has an owner.
            .set({
              ownerUserId: userId,
              updatedAt: new Date(),
              revision: sql`${projects.revision} + 1`,
            })
            .where(
              and(eq(projects.id, inv.projectId), isNull(projects.ownerUserId)),
            );
        }
      } else {
        await tx
          .insert(organizationMemberships)
          .values({
            organizationId: inv.organizationId,
            userId,
            role: inv.role as OrganizationRole,
            createdBy: userId,
          })
          .onConflictDoNothing();
      }
      await tx
        .update(invitations)
        .set({
          acceptedAt: new Date(),
          acceptedBy: userId,
          updatedAt: new Date(),
          revision: sql`${invitations.revision} + 1`,
        })
        .where(eq(invitations.id, inv.id));
      await this.recordAudit(tx, 'invitation.accepted', userId, inv);
    });
    return this.view(invitationId);
  }

  async decline(userId: string, invitationId: string): Promise<InvitationView> {
    await this.db.transaction(async (tx) => {
      const [inv] = await tx
        .select()
        .from(invitations)
        .where(eq(invitations.id, invitationId))
        .for('update');
      if (!inv) throw new NotFoundException('Invitation not found');
      await this.assertRecipient(userId, inv, tx);
      this.assertPending(inv);
      await tx
        .update(invitations)
        .set({ declinedAt: new Date(), updatedAt: new Date() })
        .where(eq(invitations.id, inv.id));
      await this.recordAudit(tx, 'invitation.declined', userId, inv);
    });
    return this.view(invitationId);
  }

  /** The inviter, a project owner, or an organization admin can withdraw a pending invitation. */
  async revoke(userId: string, invitationId: string): Promise<void> {
    const [inv] = await this.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, invitationId));
    if (!inv) throw new NotFoundException('Invitation not found');
    if (inv.createdBy !== userId) {
      if (inv.projectId)
        await this.access.requireProject(userId, inv.projectId, ['owner']);
      else
        await this.access.requireOrganization(userId, inv.organizationId, true);
    }
    if (invitationState(inv) !== 'pending')
      throw new ConflictException('This invitation is no longer pending');
    await this.db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(invitations.id, inv.id));
      await this.recordAudit(tx, 'invitation.revoked', userId, inv);
    });
  }

  /** Text for the invitation SMS or email (sent by the notifier from the outbox). */
  async messageFor(
    tx: Tx,
    invitationId: string,
  ): Promise<{
    channel: 'sms' | 'email';
    recipient: string;
    text: string;
  } | null> {
    const [row] = await this.query(tx).where(eq(invitations.id, invitationId));
    if (!row || invitationState(row.invitation) !== 'pending') return null;
    const t = createTranslator(await this.messageLocale(tx, row.invitation));
    const where = row.project ? `"${row.project.name}"` : row.organizationName;
    return {
      channel: row.invitation.channel,
      recipient: row.invitation.recipient,
      text: t('server.invitation', {
        who: row.inviterName ?? t('server.someone'),
        where,
        role: t(`server.role_${row.invitation.role}` as 'server.role_owner'),
        link: `${this.appUrl}/invitations`,
        how: t(
          row.invitation.channel === 'sms'
            ? 'server.invitationWithNumber'
            : 'server.invitationWithEmail',
        ),
        days: INVITATION_DAYS,
      }),
    };
  }

  /** The recipient's language if they already have an account, otherwise the inviter's. */
  private async messageLocale(tx: Tx, inv: InvitationRow): Promise<Locale> {
    const contact =
      inv.channel === 'sms' ? users.verifiedPhone : users.verifiedEmail;
    const [recipient] = await tx
      .select({ locale: users.locale })
      .from(users)
      .where(eq(contact, inv.recipient));
    if (recipient && isLocale(recipient.locale)) return recipient.locale;
    if (inv.createdBy) {
      const [inviter] = await tx
        .select({ locale: users.locale })
        .from(users)
        .where(eq(users.id, inv.createdBy));
      if (inviter && isLocale(inviter.locale)) return inviter.locale;
    }
    return 'en';
  }

  /* ---------- internals ---------- */

  private recordAudit(
    tx: Tx,
    action:
      | 'invitation.created'
      | 'invitation.accepted'
      | 'invitation.declined'
      | 'invitation.revoked',
    userId: string,
    inv: InvitationRow,
  ) {
    return this.audit.record(tx, {
      action,
      actor: { userId },
      organizationId: inv.organizationId,
      projectId: inv.projectId,
      target: { type: 'invitation', id: inv.id },
      metadata: {
        scope: inv.scope,
        role: inv.role,
        sentTo: mask(inv.channel, inv.recipient),
      },
    });
  }

  private recipient(req: CreateInvitationRequest) {
    if (req.channel === 'sms') {
      const phone = normalizeRwandanMobile(req.recipient);
      if (!phone)
        throw new BadRequestException(
          'Enter a Rwandan MTN or Airtel mobile number, or invite by email.',
        );
      return { channel: 'sms' as const, recipient: phone.e164 };
    }
    const email = normalizeEmail(req.recipient);
    if (!email) throw new BadRequestException('Enter a valid email address.');
    return { channel: 'email' as const, recipient: email };
  }

  private async create(
    tx: Tx,
    userId: string,
    v: Pick<
      InvitationRow,
      | 'scope'
      | 'organizationId'
      | 'projectId'
      | 'role'
      | 'financialVisibility'
      | 'channel'
      | 'recipient'
    >,
  ): Promise<CreatedInvitation> {
    // Re-inviting replaces the earlier pending invitation for the same person and role.
    await tx
      .update(invitations)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(invitations.organizationId, v.organizationId),
          v.projectId
            ? eq(invitations.projectId, v.projectId)
            : isNull(invitations.projectId),
          eq(invitations.recipient, v.recipient),
          eq(invitations.role, v.role),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const token = randomBytes(24).toString('base64url');
    const [inv] = await tx
      .insert(invitations)
      .values({
        ...v,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
        createdBy: userId,
      })
      .returning();
    await this.recordAudit(tx, 'invitation.created', userId, inv);
    await recordEvent(
      tx,
      'invitation.created',
      { invitationId: inv.id },
      userId,
    );
    const view = await this.view(inv.id, tx);
    return { ...view, link: `${this.appUrl}/invite/${token}` };
  }

  private async contactsOf(
    userId: string,
    tx: Tx | Database = this.db,
  ): Promise<string[]> {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    return [u?.verifiedPhone, u?.verifiedEmail].filter((c): c is string => !!c);
  }

  /** Spec §3.3: bound to the phone or email the recipient verified. */
  private async assertRecipient(
    userId: string,
    inv: InvitationRow,
    tx: Tx | Database = this.db,
  ) {
    const contacts = await this.contactsOf(userId, tx);
    if (!contacts.includes(inv.recipient)) {
      throw new ForbiddenException(
        `This invitation was sent to ${mask(inv.channel, inv.recipient)}. Sign in with that ${inv.channel === 'sms' ? 'number' : 'email'} to accept it.`,
      );
    }
  }

  private assertPending(inv: InvitationRow) {
    const state = invitationState(inv);
    if (state === 'expired')
      throw new GoneException(
        'This invitation has expired. Ask for a new one.',
      );
    if (state !== 'pending')
      throw new ConflictException(`This invitation was already ${state}.`);
  }

  private query(tx: Tx | Database = this.db) {
    const inviter = alias(users, 'inviter');
    return tx
      .select({
        invitation: invitations,
        organizationName: organizations.name,
        organizationKind: organizations.kind,
        project: projects,
        stageCount: sql<number>`(select count(*)::int from ${stages} where ${stages.projectId} = ${invitations.projectId})`,
        inviterName: inviter.displayName,
      })
      .from(invitations)
      .innerJoin(
        organizations,
        eq(organizations.id, invitations.organizationId),
      )
      .leftJoin(projects, eq(projects.id, invitations.projectId))
      .leftJoin(inviter, eq(inviter.id, invitations.createdBy))
      .$dynamic();
  }

  private async view(
    invitationId: string,
    tx: Tx | Database = this.db,
  ): Promise<InvitationView> {
    const [row] = await this.query(tx).where(eq(invitations.id, invitationId));
    return this.toView(row);
  }

  private toView(r: {
    invitation: InvitationRow;
    organizationName: string;
    organizationKind: InvitationView['organizationKind'];
    project: typeof projects.$inferSelect | null;
    stageCount: number;
    inviterName: string | null;
  }): InvitationView {
    const i = r.invitation;
    const p = r.project;
    return {
      id: i.id,
      scope: i.scope,
      organizationName: r.organizationName,
      organizationKind: r.organizationKind,
      projectId: i.projectId,
      projectName: p?.name ?? null,
      project: p && {
        type: p.type,
        status: p.status,
        currency: p.currency,
        // Only people invited into a money role (or given money access) see the price.
        contractValue: seesMoney(
          [i.role as ProjectRole],
          i.financialVisibility || i.role === 'owner',
        )
          ? p.contractValue
          : null,
        stageCount: r.stageCount,
        province: p.location.province ?? null,
        district: p.location.district ?? null,
      },
      role: i.role,
      financialVisibility: i.financialVisibility,
      invitedBy: r.inviterName,
      sentTo: mask(i.channel, i.recipient),
      state: invitationState(i),
      expiresAt: i.expiresAt.toISOString(),
    };
  }
}
