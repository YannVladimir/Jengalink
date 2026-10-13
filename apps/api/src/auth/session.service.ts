import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens, SessionInfo } from '@jengalink/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db/client';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/database.module';
import { sessions } from '../db/schema';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
const SESSION_DAYS = 30;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sessionExpiry = () => new Date(Date.now() + SESSION_DAYS * 86_400_000);

/**
 * Sessions: short-lived access tokens (15 min) plus an opaque refresh token
 * "<sessionId>.<secret>". Only the secret's hash is stored; it rotates on every
 * refresh, and presenting an old one revokes the whole session (theft signal).
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    deviceName: string | undefined,
    tx: Tx | Database = this.db,
  ): Promise<AuthTokens> {
    const secret = randomBytes(32).toString('base64url');
    const [row] = await tx
      .insert(sessions)
      .values({
        userId,
        deviceName: deviceName?.slice(0, 80),
        refreshTokenHash: sha256(secret),
        expiresAt: sessionExpiry(),
        createdBy: userId,
      })
      .returning({ id: sessions.id });
    return this.tokens(userId, row.id, secret);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const [sessionId, secret] = refreshToken.split('.');
    if (!sessionId || !secret || !/^[0-9a-f-]{36}$/.test(sessionId)) {
      throw new UnauthorizedException('Session ended');
    }
    // The transaction returns null instead of throwing, so a reuse revocation
    // commits before the 401 is raised (throwing inside would roll it back).
    const tokens = await this.db.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .for('update');
      if (!s || s.revokedAt || s.expiresAt <= new Date()) return null;
      if (!sameHash(sha256(secret), s.refreshTokenHash)) {
        // An old (already rotated) token was replayed: assume it was stolen.
        await tx
          .update(sessions)
          .set({
            revokedAt: new Date(),
            revokedReason: 'refresh_token_reuse',
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, s.id));
        await this.audit.record(tx, {
          action: 'auth.refresh_reuse_detected',
          actor: { userId: s.userId, sessionId: s.id },
          target: { type: 'session', id: s.id },
        });
        return null;
      }
      const next = randomBytes(32).toString('base64url');
      await tx
        .update(sessions)
        .set({
          refreshTokenHash: sha256(next),
          lastUsedAt: new Date(),
          expiresAt: sessionExpiry(),
          updatedAt: new Date(),
          revision: sql`${sessions.revision} + 1`,
        })
        .where(eq(sessions.id, s.id));
      return this.tokens(s.userId, s.id, next);
    });
    if (!tokens) throw new UnauthorizedException('Session ended');
    return tokens;
  }

  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const [s] = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, sessionId),
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      );
    return !!s;
  }

  /** Revokes one of the user's own sessions. Returns false if it was not theirs or already ended. */
  async revoke(
    sessionId: string,
    userId: string,
    reason: 'logout' | 'revoked_by_user',
    actorSessionId?: string,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(sessions)
        .set({
          revokedAt: new Date(),
          revokedReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
          ),
        )
        .returning({ id: sessions.id });
      if (rows.length > 0) {
        await this.audit.record(tx, {
          action: reason === 'logout' ? 'auth.signed_out' : 'session.revoked',
          actor: { userId, sessionId: actorSessionId ?? sessionId },
          target: { type: 'session', id: sessionId },
        });
      }
      return rows.length > 0;
    });
  }

  async list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  private async tokens(
    userId: string,
    sessionId: string,
    secret: string,
  ): Promise<AuthTokens> {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      sid: sessionId,
    });
    return {
      accessToken,
      expiresIn: ACCESS_TOKEN_SECONDS,
      refreshToken: `${sessionId}.${secret}`,
    };
  }
}
