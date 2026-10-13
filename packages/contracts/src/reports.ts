// The one-tap weekly report (spec §14, §15, A0): a frozen snapshot of a week, built from records
// (progress, money, work, decisions, photos), with a one-page infographic PDF.
import { z } from "zod";
import { ContractFigures } from "./money";
import { StageDisplayStatus } from "./progress";

/** What waits for a decision, with when it started waiting. */
export const ReportDecision = z
  .object({
    kind: z.enum(["stage_review", "claim", "spending", "change", "payment"]),
    title: z.string(),
    amount: z.number().int().nullable(),
    since: z.iso.datetime({ offset: true }),
  })
  .meta({ id: "ReportDecision" });
export type ReportDecision = z.infer<typeof ReportDecision>;

/** The snapshot: everything the report shows, frozen when it was generated. */
export const WeeklyReportData = z
  .object({
    projectName: z.string(),
    organizationName: z.string(),
    place: z.string().nullable(),
    progress: z.object({
      accepted: z.number().int(),
      reported: z.number().int(),
      /** Accepted points gained since the previous report (null on the first). */
      acceptedChange: z.number().int().nullable(),
    }),
    stages: z.array(
      z.object({
        name: z.string(),
        weight: z.number().int(),
        status: StageDisplayStatus,
      }),
    ),
    work: z.object({
      updates: z.number().int(),
      photos: z.number().int(),
      authors: z.array(z.string()),
      stagesWorked: z.array(z.string()),
      blockers: z.array(z.object({ stage: z.string(), text: z.string() })),
    }),
    decisions: z.array(ReportDecision),
    /** Stages coming next, by planned start. */
    next: z.array(
      z.object({ stage: z.string(), plannedStart: z.iso.date().nullable() }),
    ),
    /** Contract money (null when the project has no agreement yet); hidden from members without money access. */
    money: ContractFigures.nullable(),
    spending: z
      .object({
        costBudget: z.number().int(),
        posted: z.number().int(),
        committed: z.number().int(),
      })
      .nullable(),
    /** Up to 4 photos from the week, newest first. */
    photoIds: z.array(z.uuid()),
  })
  .meta({ id: "WeeklyReportData" });
export type WeeklyReportData = z.infer<typeof WeeklyReportData>;

/** POST /v1/projects/:id/reports — generate the report for the week containing `weekOf` (default today). */
export const GenerateReportRequest = z
  .object({ weekOf: z.iso.date().nullable().optional() })
  .meta({ id: "GenerateReportRequest" });
export type GenerateReportRequest = z.input<typeof GenerateReportRequest>;

export const WeeklyReportSummary = z
  .object({
    id: z.uuid(),
    /** Monday and Sunday of the week (project time zone). */
    weekStart: z.iso.date(),
    weekEnd: z.iso.date(),
    revisionNo: z.number().int(),
    acceptedPercent: z.number().int(),
    decisionsWaiting: z.number().int(),
    generatedByName: z.string().nullable(),
    generatedAt: z.iso.datetime({ offset: true }),
    acknowledgedByName: z.string().nullable(),
    acknowledgedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "WeeklyReportSummary" });
export type WeeklyReportSummary = z.infer<typeof WeeklyReportSummary>;

export const ReportPhoto = z
  .object({
    id: z.uuid(),
    url: z.url().nullable(),
    thumbUrl: z.url().nullable(),
    takenAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "ReportPhoto" });
export type ReportPhoto = z.infer<typeof ReportPhoto>;

export const WeeklyReportView = WeeklyReportSummary.extend({
  projectId: z.uuid(),
  data: WeeklyReportData,
  photos: z.array(ReportPhoto),
  /** The owner (or delegate) can mark it reviewed. */
  canAcknowledge: z.boolean(),
  /** The owner, delegate, contractor or manager can make a link for someone outside the project. */
  canShare: z.boolean(),
}).meta({ id: "WeeklyReportView" });
export type WeeklyReportView = z.infer<typeof WeeklyReportView>;

/** Monday of the week containing a date (YYYY-MM-DD), and the Sunday after. */
export function weekOf(isoDate: string): { start: string; end: string } {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // Monday = 0
  const start = new Date(d.getTime() - shift * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

// ---------- Sharing (spec §26.5, §12): a limited, expiring, revocable link to one report ----------

/** Optional parts of a shared report. Progress and the tower are always shown. */
export const ShareSection = z
  .enum(["work", "photos", "decisions", "next", "money"])
  .meta({ id: "ShareSection" });
export type ShareSection = z.infer<typeof ShareSection>;
export const SHARE_SECTIONS = ShareSection.options;
export const SHARE_EXPIRY_DAYS = [1, 7, 30] as const;

/** POST /v1/projects/:id/reports/:reportId/shares (and …/shares/preview): what to share, for how long. */
export const ReportShareRequest = z
  .object({
    sections: z.array(ShareSection).max(SHARE_SECTIONS.length),
    expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30)]),
    /** The recipient may download the one-page PDF. */
    allowDownload: z.boolean(),
  })
  .meta({ id: "ReportShareRequest" });
export type ReportShareRequest = z.infer<typeof ReportShareRequest>;

export const ReportShareView = z
  .object({
    id: z.uuid(),
    reportId: z.uuid(),
    sections: z.array(ShareSection),
    allowDownload: z.boolean(),
    expiresAt: z.iso.datetime({ offset: true }),
    status: z.enum(["active", "expired", "revoked"]),
    createdByName: z.string().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    revokedAt: z.iso.datetime({ offset: true }).nullable(),
    viewCount: z.number().int(),
    lastViewedAt: z.iso.datetime({ offset: true }).nullable(),
    canRevoke: z.boolean(),
  })
  .meta({ id: "ReportShareView" });
export type ReportShareView = z.infer<typeof ReportShareView>;

/** Only the creation answer carries the link: the server keeps a hash of the token, never the token. */
export const CreatedReportShare = ReportShareView.extend({ url: z.url() }).meta(
  { id: "CreatedReportShare" },
);
export type CreatedReportShare = z.infer<typeof CreatedReportShare>;

/** What a link's recipient sees (GET /v1/shared/reports/:token), and the privacy preview before sharing. */
export const SharedReportView = z
  .object({
    weekStart: z.iso.date(),
    weekEnd: z.iso.date(),
    revisionNo: z.number().int(),
    generatedAt: z.iso.datetime({ offset: true }),
    sharedByName: z.string().nullable(),
    sections: z.array(ShareSection),
    data: WeeklyReportData,
    /** Thumbnails only (metadata stripped); originals never leave the project. */
    photos: z.array(ReportPhoto),
    expiresAt: z.iso.datetime({ offset: true }),
    allowDownload: z.boolean(),
  })
  .meta({ id: "SharedReportView" });
export type SharedReportView = z.infer<typeof SharedReportView>;

/**
 * The report as a link shows it: no one's name, the district instead of the exact place, and
 * only the chosen sections. Amounts appear only with the money section.
 */
export function sharedReportData(
  data: WeeklyReportData,
  sections: readonly ShareSection[],
): WeeklyReportData {
  const has = (s: ShareSection) => sections.includes(s);
  const money = has("money");
  return {
    ...data,
    place: data.place?.split(",").at(-1)?.trim() || null,
    work: has("work")
      ? { ...data.work, authors: [] }
      : { updates: 0, photos: 0, authors: [], stagesWorked: [], blockers: [] },
    decisions: has("decisions")
      ? data.decisions.map((d) => ({ ...d, amount: money ? d.amount : null }))
      : [],
    next: has("next") ? data.next : [],
    money: money ? data.money : null,
    spending: money ? data.spending : null,
    photoIds: has("photos") ? data.photoIds : [],
  };
}

/** POST /v1/shared/reports/:token/pdf?lang=rw — the recipient picks the PDF's language. */
export const SharedPdfQuery = z.object({ lang: z.string().max(8).optional() }).meta({ id: "SharedPdfQuery" });
export type SharedPdfQuery = z.infer<typeof SharedPdfQuery>;
