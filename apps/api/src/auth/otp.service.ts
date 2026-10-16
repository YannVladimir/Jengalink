import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DEMO_CODE,
  demoPersonFor,
  type MeResponse,
  OtpChannel,
  type StartOtpResponse,
  type VerifyOtpResponse,
} from '@jengalink/contracts';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { createTranslator, isLocale, type Locale } from '@jengalink/i18n';
import { AuditService } from '../audit/audit.service';
import { DB } from '../db/database.module';
import { otpChallenges, users } from '../db/schema';
import {
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizeRwandanMobile,
} from './contact';
import {
  MESSAGE_SENDER,
  type MessageSender,
} from '../messaging/message-sender';
import { SessionService } from './session.service';

// Spec §26.5: capped retries, resend delay, short expiry, number and device throttles.
/** The sign-in code message, in the user's language. */
export const codeMessage = (code: string, locale: Locale = 'en') =>
  createTranslator(locale)('server.otpCode', { code });

export const OTP_LIMITS = {
  ttlSeconds: 5 * 60,
  maxAttempts: 5,
  resendDelaySeconds: 60,
  perDestinationPerHour: 5,
  perIpPerHour: 20,
} as const;

const tooMany = (message: string, retryAfterSeconds: number) =>
  new HttpException(
    {
      statusCode: 429,
      message,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)),
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

export const toMe = (u: typeof users.$inferSelect): MeResponse => ({
  id: u.id,
  displayName: u.displayName,
  verifiedPhone: u.verifiedPhone,
  verifiedEmail: u.verifiedEmail,
  locale: isLocale(u.locale) ? u.locale : 'en',
  legalAcceptedVersion: u.legalAcceptedVersion,
  revision: u.revision,
});

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly pepper: string;
  private readonly demo: boolean;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(MESSAGE_SENDER) private readonly sender: MessageSender,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    config: ConfigService,
  ) {
    this.pepper = config.getOrThrow<string>('OTP_PEPPER');
    this.demo = config.get<string>('DEMO_MODE') === 'on';
  }

  private hash(destination: string, code: string) {
    return createHmac('sha256', this.pepper)
      .update(`${destination}:${code}`)
      .digest('hex');
  }

  async start(
    channel: OtpChannel,
    rawDestination: string,
    ip: string | undefined,
    locale: Locale = 'en',
  ): Promise<StartOtpResponse> {
    const destination = this.normalize(channel, rawDestination);
    const hourAgo = new Date(Date.now() - 3_600_000);
    // Demo environment: many visitors share the demo people, so their numbers skip the per-number
    // limits and get the fixed code (nothing is sent). The per-network limit still applies.
    const demoPerson =
      this.demo && channel === 'sms' && !!demoPersonFor(destination);

    const [latest] = await this.db
      .select({ createdAt: otpChallenges.createdAt })
      .from(otpChallenges)
      .where(eq(otpChallenges.destination, destination))
      .orderBy(desc(otpChallenges.createdAt))
      .limit(1);
    if (latest && !demoPerson) {
      const wait =
        OTP_LIMITS.resendDelaySeconds -
        (Date.now() - latest.createdAt.getTime()) / 1000;
      if (wait > 0)
        throw tooMany('Please wait before asking for a new code.', wait);
    }

    const [perDest] = await this.db
      .select({ n: count() })
      .from(otpChallenges)
      .where(
        and(
          eq(otpChallenges.destination, destination),
          gt(otpChallenges.createdAt, hourAgo),
        ),
      );
    if (!demoPerson && perDest.n >= OTP_LIMITS.perDestinationPerHour) {
      throw tooMany('Too many codes requested. Try again in an hour.', 3600);
    }
    if (ip) {
      const [perIp] = await this.db
        .select({ n: count() })
        .from(otpChallenges)
        .where(
          and(
            eq(otpChallenges.requestIp, ip),
            gt(otpChallenges.createdAt, hourAgo),
          ),
        );
      if (perIp.n >= OTP_LIMITS.perIpPerHour) {
        throw tooMany(
          'Too many sign-in attempts from this network. Try again later.',
          3600,
        );
      }
    }

    const code = demoPerson
      ? DEMO_CODE
      : randomInt(0, 1_000_000).toString().padStart(6, '0');
    const expiresAt = new Date(Date.now() + OTP_LIMITS.ttlSeconds * 1000);
    const [challenge] = await this.db
      .insert(otpChallenges)
      .values({
        channel,
        destination,
        codeHash: this.hash(destination, code),
        expiresAt,
        requestIp: ip,
      })
      .returning({ id: otpChallenges.id, createdAt: otpChallenges.createdAt });

    try {
      if (!demoPerson)
        await this.sender.send(channel, destination, codeMessage(code, locale));
    } catch (err) {
      await this.db
        .update(otpChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(otpChallenges.id, challenge.id));
      this.logger.error(`Code delivery failed (${channel})`, err as Error);
      throw new ServiceUnavailableException(
        'We could not send the code. Please try again.',
      );
    }

    return {
      challengeId: challenge.id,
      sentTo:
        channel === 'sms' ? maskPhone(destination) : maskEmail(destination),
      expiresAt: expiresAt.toISOString(),
      resendAfter: new Date(
        challenge.createdAt.getTime() + OTP_LIMITS.resendDelaySeconds * 1000,
      ).toISOString(),
    };
  }

  async verify(
    challengeId: string,
    code: string,
    deviceName?: string,
    locale?: Locale,
  ): Promise<VerifyOtpResponse> {
    type Outcome = { error: HttpException } | { ok: VerifyOtpResponse };
    const result = await this.db.transaction(async (tx): Promise<Outcome> => {
      const [c] = await tx
        .select()
        .from(otpChallenges)
        .where(eq(otpChallenges.id, challengeId))
        .for('update');
      if (!c || c.consumedAt || c.expiresAt <= new Date()) {
        return {
          error: new BadRequestException(
            'This code has expired. Ask for a new one.',
          ),
        };
      }
      if (c.attempts >= OTP_LIMITS.maxAttempts) {
        return {
          error: tooMany('Too many wrong codes. Ask for a new one.', 60),
        };
      }
      const expected = Buffer.from(c.codeHash);
      const given = Buffer.from(this.hash(c.destination, code));
      if (
        expected.length !== given.length ||
        !timingSafeEqual(expected, given)
      ) {
        const attempts = c.attempts + 1;
        await tx
          .update(otpChallenges)
          .set({
            attempts,
            updatedAt: new Date(),
            revision: sql`${otpChallenges.revision} + 1`,
          })
          .where(eq(otpChallenges.id, c.id));
        const left = OTP_LIMITS.maxAttempts - attempts;
        // Commit the failed attempt; the error is thrown after the transaction.
        return {
          error:
            left > 0
              ? new UnauthorizedException({
                  statusCode: 401,
                  message: 'Wrong code.',
                  attemptsLeft: left,
                })
              : tooMany('Too many wrong codes. Ask for a new one.', 60),
        };
      }

      await tx
        .update(otpChallenges)
        .set({ consumedAt: new Date(), updatedAt: new Date() })
        .where(eq(otpChallenges.id, c.id));

      // Phone and email are separate identities; they are never merged automatically (spec §26.5).
      const contact =
        c.channel === 'sms' ? users.verifiedPhone : users.verifiedEmail;
      let [user] = await tx
        .select()
        .from(users)
        .where(eq(contact, c.destination));
      const isNewUser = !user;
      if (!user) {
        [user] = await tx
          .insert(users)
          .values(
            c.channel === 'sms'
              ? { verifiedPhone: c.destination, ...(locale ? { locale } : {}) }
              : { verifiedEmail: c.destination, ...(locale ? { locale } : {}) },
          )
          .returning();
      }
      const tokens = await this.sessions.create(user.id, deviceName, tx);
      await this.audit.record(tx, {
        action: 'auth.signed_in',
        actor: {
          userId: user.id,
          sessionId: tokens.refreshToken.split('.')[0],
        },
        metadata: {
          channel: c.channel,
          newUser: isNewUser,
          contact:
            c.channel === 'sms'
              ? maskPhone(c.destination)
              : maskEmail(c.destination),
        },
      });
      return { ok: { ...tokens, user: toMe(user), isNewUser } };
    });
    if ('error' in result) throw result.error;
    return result.ok;
  }

  private normalize(channel: OtpChannel, raw: string): string {
    if (channel === 'sms') {
      const phone = normalizeRwandanMobile(raw);
      if (!phone) {
        throw new BadRequestException(
          'Enter a Rwandan MTN or Airtel mobile number, for example 078 123 4567. Living abroad? Sign in with email.',
        );
      }
      return phone.e164;
    }
    const email = normalizeEmail(raw);
    if (!email) throw new BadRequestException('Enter a valid email address.');
    return email;
  }
}
