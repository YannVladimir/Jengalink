import { LIMITS, RateLimit } from '../common/rate-limit';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import {
  AuthTokens,
  MeResponse,
  RefreshRequest,
  RevokeSessionRequest,
  SessionInfo,
  StartOtpRequest,
  StartOtpResponse,
  UpdateMeRequest,
  VerifyOtpRequest,
  VerifyOtpResponse,
} from '@jengalink/contracts';
import { and, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { Contract } from '../common/contract';
import {
  IfMatch,
  VersionConflictException,
  WithETag,
} from '../common/versioning';
import { ZodPipe } from '../common/zod.pipe';
import type { Database } from '../db/client';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/database.module';
import { users } from '../db/schema';
import { type AuthUser, CurrentUser, Public } from './auth.guard';
import { OtpService, toMe } from './otp.service';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('otp/start')
  @HttpCode(202)
  @Contract({
    tag: 'Auth',
    summary: 'Send a 6-digit sign-in code by SMS or email',
    body: StartOtpRequest,
    response: StartOtpResponse,
    status: 202,
  })
  start(
    @Body(new ZodPipe(StartOtpRequest)) body: StartOtpRequest,
    @Req() req: Request,
  ): Promise<StartOtpResponse> {
    return this.otp.start(body.channel, body.destination, req.ip, body.locale);
  }

  @Public()
  @RateLimit(LIMITS.otpVerify)
  @Post('otp/verify')
  @HttpCode(200)
  @Contract({
    tag: 'Auth',
    summary: 'Check the code and start a session',
    body: VerifyOtpRequest,
    response: VerifyOtpResponse,
  })
  verify(
    @Body(new ZodPipe(VerifyOtpRequest)) body: VerifyOtpRequest,
  ): Promise<VerifyOtpResponse> {
    return this.otp.verify(
      body.challengeId,
      body.code,
      body.deviceName,
      body.locale,
    );
  }

  @Public()
  @RateLimit(LIMITS.refresh)
  @Post('refresh')
  @HttpCode(200)
  @Contract({
    tag: 'Auth',
    summary: 'Exchange the refresh token for new tokens (rotates)',
    body: RefreshRequest,
    response: AuthTokens,
  })
  refresh(
    @Body(new ZodPipe(RefreshRequest)) body: RefreshRequest,
  ): Promise<AuthTokens> {
    return this.sessions.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @Contract({ tag: 'Auth', summary: 'End this session' })
  async logout(@CurrentUser() auth: AuthUser): Promise<void> {
    await this.sessions.revoke(
      auth.sessionId,
      auth.userId,
      'logout',
      auth.sessionId,
    );
  }
}

@Controller()
export class MeController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  @Get('me')
  @WithETag()
  @Contract({
    tag: 'Me',
    summary: 'Your profile (ETag = revision)',
    response: MeResponse,
  })
  async me(@CurrentUser() auth: AuthUser): Promise<MeResponse> {
    const [u] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!u) throw new NotFoundException();
    return toMe(u);
  }

  /** Requires If-Match: only applies if nobody changed the profile since it was read. */
  @Patch('me')
  @WithETag()
  @Contract({
    tag: 'Me',
    summary: 'Update your name or language',
    body: UpdateMeRequest,
    response: MeResponse,
    ifMatch: true,
  })
  async update(
    @CurrentUser() auth: AuthUser,
    @IfMatch() expectedRevision: number,
    @Body(new ZodPipe(UpdateMeRequest)) body: UpdateMeRequest,
  ): Promise<MeResponse> {
    const u = await this.db.transaction(async (tx) => {
      // Compare-and-set in one statement: two concurrent edits cannot both win.
      const [row] = await tx
        .update(users)
        .set({
          ...body,
          updatedAt: new Date(),
          revision: sql`${users.revision} + 1`,
        })
        .where(
          and(eq(users.id, auth.userId), eq(users.revision, expectedRevision)),
        )
        .returning();
      if (!row) {
        const [current] = await tx
          .select({ revision: users.revision })
          .from(users)
          .where(eq(users.id, auth.userId));
        throw new VersionConflictException(current?.revision);
      }
      await this.audit.record(tx, {
        action: 'profile.updated',
        actor: auth,
        target: { type: 'user', id: auth.userId },
        metadata: { fields: Object.keys(body) },
      });
      return row;
    });
    return toMe(u);
  }

  @Get('me/sessions')
  @Contract({
    tag: 'Me',
    summary: 'Your signed-in devices',
    response: SessionInfo,
    list: true,
  })
  list(@CurrentUser() auth: AuthUser): Promise<SessionInfo[]> {
    return this.sessions.list(auth.userId, auth.sessionId);
  }

  /** Spec §19.2: POST /sessions/revoke — sign out another device. */
  @Post('sessions/revoke')
  @HttpCode(204)
  @Contract({
    tag: 'Me',
    summary: 'Sign out another of your devices',
    body: RevokeSessionRequest,
  })
  async revoke(
    @CurrentUser() auth: AuthUser,
    @Body(new ZodPipe(RevokeSessionRequest)) body: RevokeSessionRequest,
  ): Promise<void> {
    const done = await this.sessions.revoke(
      body.sessionId,
      auth.userId,
      'revoked_by_user',
      auth.sessionId,
    );
    if (!done) throw new NotFoundException('Session not found');
  }
}
