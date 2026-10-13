// Error body returned by every API error (spec §3.3), and the audit trail view.
import { z } from 'zod';

export const FieldError = z.object({ field: z.string(), message: z.string() }).meta({ id: 'FieldError' });
export type FieldError = z.infer<typeof FieldError>;

export const ApiErrorBody = z
  .looseObject({
    statusCode: z.number().int(),
    /** Stable machine code: bad_request, unauthorized, forbidden, not_found, conflict, gone, rate_limited… */
    code: z.string(),
    /** Plain-language message safe to show the user. Never names hidden records. */
    message: z.string(),
    fieldErrors: z.array(FieldError),
    /** Matches the x-request-id response header; quote it when reporting a problem. */
    requestId: z.string(),
    /** True when trying again later may succeed (429, 5xx). */
    retryable: z.boolean(),
  })
  .meta({ id: 'ApiErrorBody' });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/** GET /v1/projects/:id/audit (owners only). */
export const AuditEventView = z
  .object({
    id: z.uuid(),
    action: z.string(),
    actorName: z.string().nullable(),
    targetType: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    occurredAt: z.iso.datetime(),
  })
  .meta({ id: 'AuditEventView' });
export type AuditEventView = z.infer<typeof AuditEventView>;

export const HealthResponse = z
  .object({
    status: z.enum(['ok', 'degraded']),
    service: z.literal('jengalink-api'),
    database: z.enum(['ok', 'down']),
    storage: z.enum(['ok', 'down']),
    time: z.iso.datetime(),
  })
  .meta({ id: 'HealthResponse' });
export type HealthResponse = z.infer<typeof HealthResponse>;
