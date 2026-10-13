// Exports (spec §12, §21): a project summary and the money history, as PDF or CSV, built by a
// background job from one consistent snapshot. Only the person who asked can download it.
import { z } from "zod";

export const ExportKind = z
  .enum(["project_summary", "money_history"])
  .meta({ id: "ExportKind" });
export type ExportKind = z.infer<typeof ExportKind>;
export const ExportFormat = z.enum(["pdf", "csv"]).meta({ id: "ExportFormat" });
export type ExportFormat = z.infer<typeof ExportFormat>;

/** POST /v1/projects/:id/exports */
export const RequestExport = z
  .object({ kind: ExportKind, format: ExportFormat })
  .meta({ id: "RequestExport" });
export type RequestExport = z.infer<typeof RequestExport>;

export const ExportView = z
  .object({
    id: z.uuid(),
    kind: ExportKind,
    format: ExportFormat,
    /** queued → ready | failed */
    status: z.enum(["queued", "ready", "failed"]),
    /** The summary leaves money out for people who may not see it. */
    includesMoney: z.boolean(),
    fileName: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    readyAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: "ExportView" });
export type ExportView = z.infer<typeof ExportView>;

/** GET /v1/projects/:id/exports — your exports for this project, newest first. */
export const ExportList = z
  .object({ canExportMoney: z.boolean(), items: z.array(ExportView) })
  .meta({ id: "ExportList" });
export type ExportList = z.infer<typeof ExportList>;

/** At most this many exports per person per hour. */
export const EXPORTS_PER_HOUR = 10;

/**
 * One CSV cell: quoted when needed, and text that a spreadsheet would run as a formula
 * (= + - @, tab, carriage return) is prefixed with ' so it stays text (CSV injection).
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows to CSV text with a BOM, so Excel opens accents and Kinyarwanda apostrophes correctly. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
