import type { Tx } from '../db/client';
import { outboxEvents } from '../db/schema';
import type { EventPayloads, EventType } from './events';

/**
 * Records an event inside the caller's transaction. If the transaction rolls back,
 * the event never existed; if it commits, the relay will deliver it.
 */
export async function recordEvent<T extends EventType>(
  tx: Tx,
  type: T,
  payload: EventPayloads[T],
  createdBy?: string,
): Promise<string> {
  const [row] = await tx
    .insert(outboxEvents)
    .values({ type, payload: payload as Record<string, unknown>, createdBy })
    .returning({ id: outboxEvents.id });
  return row.id;
}
