// Notifications (spec §9.4, §5): in-app and push, linked to the exact item. No amounts or site
// addresses in the text, so nothing sensitive shows on a lock screen.
import { z } from "zod";

export const NotificationKind = z
  .enum([
    "claim_to_decide",
    "spending_to_decide",
    "change_to_decide",
    "report_published",
    "update_problem",
    "decisions_reminder",
  ])
  .meta({ id: "NotificationKind" });
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationView = z
  .object({
    id: z.uuid(),
    kind: NotificationKind,
    projectId: z.uuid(),
    /** Title and body in the reader's language. */
    title: z.string(),
    body: z.string(),
    /** The exact item, as an app route: /project/<id>/claims/<claimId>; the web adds an "s" to /projects. */
    path: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    readAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "NotificationView" });
export type NotificationView = z.infer<typeof NotificationView>;

export const NotificationList = z
  .object({ unread: z.number().int(), items: z.array(NotificationView) })
  .meta({ id: "NotificationList" });
export type NotificationList = z.infer<typeof NotificationList>;

/** POST /v1/me/push-devices — this phone's Expo push token (sent after sign-in and whenever it changes). */
export const RegisterPushDeviceRequest = z
  .object({
    token: z
      .string()
      .regex(
        /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/,
        "Not an Expo push token",
      ),
    platform: z.enum(["ios", "android"]),
  })
  .meta({ id: "RegisterPushDeviceRequest" });
export type RegisterPushDeviceRequest = z.infer<
  typeof RegisterPushDeviceRequest
>;

/** POST /v1/me/push-devices/remove — on sign-out, so this phone stops receiving the account's pushes. */
export const RemovePushDeviceRequest = z
  .object({ token: z.string().max(200) })
  .meta({ id: "RemovePushDeviceRequest" });
export type RemovePushDeviceRequest = z.infer<typeof RemovePushDeviceRequest>;

/** The web routes are the app routes with /projects instead of /project. */
export const webPathOf = (path: string) =>
  path.replace(/^\/project\//, "/projects/");

const HHMM = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");

/** GET/PUT /v1/me/notification-settings (spec §9.4: per-person reminders and quiet hours). */
export const NotificationSettings = z
  .object({
    /** A daily nudge when decisions have waited more than 2 days. */
    remindersEnabled: z.boolean(),
    /** No pushes in this window (they wait until it ends); null = pushes any time. */
    quietHours: z.object({ start: HHMM, end: HHMM }).nullable(),
    /** The clock quiet hours follow. */
    timeZone: z.string(),
  })
  .meta({ id: "NotificationSettings" });
export type NotificationSettings = z.infer<typeof NotificationSettings>;

export const UpdateNotificationSettings = NotificationSettings.omit({
  timeZone: true,
}).meta({ id: "UpdateNotificationSettings" });
export type UpdateNotificationSettings = z.infer<
  typeof UpdateNotificationSettings
>;

export const DEFAULT_QUIET_HOURS = { start: "21:00", end: "07:00" } as const;

/** The local "HH:MM" and "YYYY-MM-DD" of an instant in a time zone. */
export function localClock(
  at: Date,
  timeZone: string,
): { time: string; date: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    time: `${parts.hour}:${parts.minute}`,
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Inside quiet hours? Windows may cross midnight (21:00–07:00). */
export function inQuietHours(
  at: Date,
  quiet: { start: string; end: string } | null,
  timeZone: string,
): boolean {
  if (!quiet || quiet.start === quiet.end) return false;
  const { time } = localClock(at, timeZone);
  return quiet.start < quiet.end
    ? time >= quiet.start && time < quiet.end
    : time >= quiet.start || time < quiet.end;
}
