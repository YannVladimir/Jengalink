import { SetMetadata } from '@nestjs/common';
import type { ZodObject, ZodType } from 'zod';

export const CONTRACT_METADATA = 'apiContract';

/**
 * What a route accepts and returns, for the generated OpenAPI document.
 * Schemas come from @jengalink/contracts and must carry a `.meta({ id })`.
 */
export interface RouteContract {
  summary: string;
  tag:
    | 'Health'
    | 'Auth'
    | 'Me'
    | 'Organizations'
    | 'Projects'
    | 'Invitations'
    | 'Locations'
    | 'Site updates'
    | 'Quotes'
    | 'Claims'
    | 'Spending'
    | 'Payments'
    | 'Changes'
    | 'Reports'
    | 'Notifications'
    | 'Decisions'
    | 'Exports';
  body?: ZodType;
  /** Query parameters, all strings (validate with ZodPipe on @Query()). */
  query?: ZodObject;
  /** Omit for 204 No Content. */
  response?: ZodType;
  /** The response is a list of `response`. */
  list?: boolean;
  /** Success status (default 200; 201 for creations, 204 when there is no body). */
  status?: number;
  /** The route needs If-Match with the record's revision. */
  ifMatch?: boolean;
}

export const Contract = (c: RouteContract) => SetMetadata(CONTRACT_METADATA, c);
