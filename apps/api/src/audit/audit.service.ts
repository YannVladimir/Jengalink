import { Inject, Injectable } from '@nestjs/common';
import type { AuditEventView } from '@jengalink/contracts';
import { and, desc, eq } from 'drizzle-orm';
import { requestContext } from '../common/request-context';
import type { Database, Tx } from '../db/client';
import { DB } from '../db/database.module';
import { auditEvents, users } from '../db/schema';

/** Sensitive actions that are always recorded (spec §21: login-sensitive changes, invitations, roles, approvals…). */
export type AuditAction =
  | 'auth.signed_in'
  | 'auth.signed_out'
  | 'auth.refresh_reuse_detected'
  | 'session.revoked'
  | 'profile.updated'
  | 'organization.created'
  | 'project.created'
  | 'project.accepted'
  | 'project.changes_requested'
  | 'stage_plan.saved'
  | 'invitation.created'
  | 'invitation.accepted'
  | 'invitation.declined'
  | 'invitation.revoked'
  | 'member.removed'
  | 'media.quarantined'
  | 'stage.submitted'
  | 'stage.accepted'
  | 'stage.changes_requested'
  | 'quote.created'
  | 'quote.sent'
  | 'quote.accepted'
  | 'quote.declined'
  | 'claim.created'
  | 'claim.submitted'
  | 'claim.cancelled'
  | 'claim.approved'
  | 'claim.rejected'
  | 'claim.changes_requested'
  | 'claim.revised'
  | 'claim.approval_cancelled'
  | 'spending.created'
  | 'spending.submitted'
  | 'spending.approved'
  | 'spending.rejected'
  | 'spending.changes_requested'
  | 'spending.closed'
  | 'spending.withdrawn'
  | 'expense.posted'
  | 'receipt.captured'
  | 'receipt.updated'
  | 'receipt.reviewed'
  | 'payment.recorded'
  | 'payment.settled'
  | 'payment.disputed'
  | 'payment.cancelled'
  | 'change.created'
  | 'change.submitted'
  | 'change.applied'
  | 'change.rejected'
  | 'change.withdrawn'
  | 'report.generated'
  | 'report.acknowledged'
  | 'report.shared'
  | 'report.share_revoked'
  | 'export.requested'
  | 'export.downloaded';

export interface AuditEntry {
  action: AuditAction;
  actor: { userId: string | null; sessionId?: string | null };
  organizationId?: string | null;
  projectId?: string | null;
  target?: { type: string; id: string };
  /** Safe fields only: roles, masked contacts, reasons. Never codes or tokens. */
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Write inside the action's own transaction, so the action and its record commit together. */
  async record(tx: Tx | Database, e: AuditEntry): Promise<void> {
    const ctx = requestContext();
    await tx.insert(auditEvents).values({
      action: e.action,
      actorUserId: e.actor.userId,
      actorSessionId: e.actor.sessionId ?? ctx?.sessionId ?? null,
      organizationId: e.organizationId ?? null,
      projectId: e.projectId ?? null,
      targetType: e.target?.type ?? null,
      targetId: e.target?.id ?? null,
      metadata: e.metadata ?? {},
      ip: ctx?.ip ?? null,
      requestId: ctx?.requestId ?? null,
    });
  }

  /** A project's trail, newest first. Caller must already be authorised (owner). */
  async forProject(projectId: string, limit = 100): Promise<AuditEventView[]> {
    const rows = await this.db
      .select({ e: auditEvents, actorName: users.displayName })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.projectId, projectId)))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(limit);
    return rows.map(({ e, actorName }) => ({
      id: e.id,
      action: e.action,
      actorName,
      targetType: e.targetType,
      metadata: e.metadata,
      occurredAt: e.createdAt.toISOString(),
    }));
  }
}
