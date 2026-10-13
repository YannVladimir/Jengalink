// The decision inbox (spec §4.2, §5): everything waiting on me across my projects, oldest first,
// each linked to the screen where the decision is made.
import { z } from "zod";

export const DecisionKind = z
  .enum(["accept_project", "quote", "stage_review", "claim", "spending", "change", "payment", "receipt"])
  .meta({ id: "DecisionKind" });
export type DecisionKind = z.infer<typeof DecisionKind>;

export const DecisionItem = z
  .object({
    kind: DecisionKind,
    projectId: z.uuid(),
    projectName: z.string(),
    /** The item: a stage name, a claim number and package, a supplier… */
    title: z.string(),
    amount: z.number().int().nullable(),
    /** When it started waiting on me. */
    since: z.iso.datetime({ offset: true }),
    /** The app route where it is decided (the web adds an "s" to /projects). */
    path: z.string(),
  })
  .meta({ id: "DecisionItem" });
export type DecisionItem = z.infer<typeof DecisionItem>;

/** GET /v1/decisions */
export const DecisionInbox = z
  .object({
    count: z.number().int(),
    /** The oldest item's start: "oldest waiting 4 days". */
    oldestSince: z.iso.datetime({ offset: true }).nullable(),
    items: z.array(DecisionItem),
  })
  .meta({ id: "DecisionInbox" });
export type DecisionInbox = z.infer<typeof DecisionInbox>;

/** A decision waiting longer than this is late (orange on Home, reminded in Phase 5). */
export const DECISION_LATE_DAYS = 2;

/** Whole days waited (0 = since today). */
export const daysWaiting = (since: string, now = Date.now()) => Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000));
