// Sign-in and session contracts (Phase 2: phone OTP, email for owners abroad).
// Each schema is the single source: the API validates with it, OpenAPI is
// generated from it, and the TypeScript type of the same name is derived from it.
import { z } from 'zod';

export const OtpChannel = z.enum(['sms', 'email']);
export type OtpChannel = z.infer<typeof OtpChannel>;

/** English, Kinyarwanda, French, Swahili. */
export const AppLocale = z.enum(['en', 'rw', 'fr', 'sw']).meta({ id: 'AppLocale' });
export type AppLocale = z.infer<typeof AppLocale>;

/** POST /v1/auth/otp/start */
export const StartOtpRequest = z
  .object({
    channel: OtpChannel,
    /** Rwandan mobile number (07…, +2507…) for sms, or an email address. */
    destination: z.string().min(3).max(254),
    /** Language of the code message (the app's current language). */
    locale: AppLocale.optional(),
  })
  .meta({ id: 'StartOtpRequest' });
export type StartOtpRequest = z.infer<typeof StartOtpRequest>;

/** Same answer whether or not an account exists, so numbers cannot be probed. */
export const StartOtpResponse = z
  .object({
    challengeId: z.uuid(),
    /** Masked, e.g. "+250 78* *** 456" or "a***@example.com". */
    sentTo: z.string(),
    expiresAt: z.iso.datetime(),
    /** Earliest time a new code may be requested. */
    resendAfter: z.iso.datetime(),
  })
  .meta({ id: 'StartOtpResponse' });
export type StartOtpResponse = z.infer<typeof StartOtpResponse>;

/** POST /v1/auth/otp/verify */
export const VerifyOtpRequest = z
  .object({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
    deviceName: z.string().max(80).optional(),
    /** Saved as the language of a new account. */
    locale: AppLocale.optional(),
  })
  .meta({ id: 'VerifyOtpRequest' });
export type VerifyOtpRequest = z.infer<typeof VerifyOtpRequest>;

export const AuthTokens = z
  .object({
    accessToken: z.string(),
    /** Seconds until the access token expires. */
    expiresIn: z.number().int(),
    /** Opaque; exchange at POST /v1/auth/refresh. Rotates on every use. */
    refreshToken: z.string(),
  })
  .meta({ id: 'AuthTokens' });
export type AuthTokens = z.infer<typeof AuthTokens>;

export const MeResponse = z
  .object({
    id: z.uuid(),
    displayName: z.string().nullable(),
    verifiedPhone: z.string().nullable(),
    verifiedEmail: z.string().nullable(),
    locale: AppLocale,
    /** Send as If-Match when updating (spec §19.1). */
    revision: z.number().int(),
  })
  .meta({ id: 'MeResponse' });
export type MeResponse = z.infer<typeof MeResponse>;

export const VerifyOtpResponse = AuthTokens.extend({
  user: MeResponse,
  /** True on the first sign-in: the app asks for a name next. */
  isNewUser: z.boolean(),
}).meta({ id: 'VerifyOtpResponse' });
export type VerifyOtpResponse = z.infer<typeof VerifyOtpResponse>;

/** POST /v1/auth/refresh */
export const RefreshRequest = z
  .object({ refreshToken: z.string().min(10).max(200) })
  .meta({ id: 'RefreshRequest' });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

/** PATCH /v1/me (needs If-Match) */
export const UpdateMeRequest = z
  .object({
    displayName: z.string().trim().min(2).max(80).optional(),
    locale: AppLocale.optional(),
  })
  .refine((v) => v.displayName !== undefined || v.locale !== undefined, 'Nothing to update')
  .meta({ id: 'UpdateMeRequest' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** GET /v1/me/sessions */
export const SessionInfo = z
  .object({
    id: z.uuid(),
    deviceName: z.string().nullable(),
    createdAt: z.iso.datetime(),
    lastUsedAt: z.iso.datetime(),
    current: z.boolean(),
  })
  .meta({ id: 'SessionInfo' });
export type SessionInfo = z.infer<typeof SessionInfo>;

/** POST /v1/sessions/revoke */
export const RevokeSessionRequest = z.object({ sessionId: z.uuid() }).meta({ id: 'RevokeSessionRequest' });
export type RevokeSessionRequest = z.infer<typeof RevokeSessionRequest>;
