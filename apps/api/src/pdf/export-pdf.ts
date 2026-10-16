import { markDemoPages } from './demo-mark';
import { join } from 'node:path';
import { createTranslator, formatDate, type Locale } from '@jengalink/i18n';
import { colors, formatRwf } from '@jengalink/ui';
import PDFDocument from 'pdfkit';
import type { HistoryRow, SummaryData } from '../exports/export-data';

const FONTS = join(__dirname, 'fonts');
const NAVY = '#1E3A5F';
const MUTED = colors.inkMuted;
const LINE = '#E5E1DA';
const L = 40;
const BOTTOM = 790;

interface Meta {
  locale: Locale;
  projectName: string;
  organizationName: string;
  requesterName: string;
  generatedAt: Date;
  /** The project's clock: dates and times are written in it. */
  timeZone: string;
}

/** A plain A4 document with the header band, page numbers and the footer note. */
function documentFor(meta: Meta, title: string) {
  const t = createTranslator(meta.locale);
  const doc = new PDFDocument({
    size: 'A4',
    margin: L,
    bufferPages: true,
    info: {
      Title: `${title} · ${meta.projectName}`,
      Author: meta.organizationName,
    },
  });
  markDemoPages(doc);
  doc.registerFont('body', join(FONTS, 'Inter_400Regular.ttf'));
  doc.registerFont('strong', join(FONTS, 'Inter_600SemiBold.ttf'));
  doc.registerFont('heading', join(FONTS, 'PlusJakartaSans_700Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const R = doc.page.width - L;
  doc.rect(0, 0, doc.page.width, 64).fill(NAVY);
  doc
    .font('heading')
    .fontSize(17)
    .fillColor('#FFFFFF')
    .text(title, L, 18, { width: R - L });
  doc
    .font('body')
    .fontSize(10)
    .fillColor('#DCE6F2')
    .text(`${meta.projectName} · ${meta.organizationName}`, L, 40, {
      width: R - L,
    });
  doc.y = 84;
  const finish = () => {
    const range = doc.bufferedPageRange();
    const note = t('exports.generatedOn', {
      date: formatDate(meta.locale, meta.generatedAt, meta.timeZone),
      name: meta.requesterName,
    });
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.moveTo(L, 800).lineTo(R, 800).lineWidth(0.5).stroke(LINE);
      doc
        .font('body')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(note, L, 806, { width: R - L - 40 });
      doc.text(`${i + 1} / ${range.count}`, R - 40, 806, {
        width: 40,
        align: 'right',
      });
    }
    doc.end();
    return done;
  };
  return { doc, t, R, finish };
}

/** A table that breaks across pages, repeating its header row. Columns are widths in points. */
function table(
  doc: PDFKit.PDFDocument,
  cols: { label: string; width: number; align?: 'left' | 'right' }[],
  rows: string[][],
) {
  const header = () => {
    let x = L;
    const y = doc.y;
    doc.font('strong').fontSize(8).fillColor(MUTED);
    // Long labels ("Amount (RWF)") may wrap: the row is as tall as its tallest label.
    const h = Math.max(
      ...cols.map((c) =>
        doc.heightOfString(c.label.toUpperCase(), {
          width: c.width - 6,
          characterSpacing: 0.4,
        }),
      ),
    );
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), x, y, {
        width: c.width - 6,
        align: c.align ?? 'left',
        characterSpacing: 0.4,
      });
      x += c.width;
    }
    doc.y = y + h + 5;
    doc
      .moveTo(L, doc.y - 3)
      .lineTo(L + cols.reduce((t, c) => t + c.width, 0), doc.y - 3)
      .lineWidth(0.5)
      .stroke(LINE);
  };
  header();
  for (const row of rows) {
    doc.font('body').fontSize(8.5);
    const h =
      Math.max(
        ...row.map((v, i) =>
          doc.heightOfString(v || ' ', { width: cols[i].width - 6 }),
        ),
      ) + 6;
    if (doc.y + h > BOTTOM) {
      doc.addPage();
      doc.y = L;
      header();
    }
    const y = doc.y;
    let x = L;
    row.forEach((v, i) => {
      doc
        .font(i === 0 ? 'strong' : 'body')
        .fontSize(8.5)
        .fillColor(colors.ink)
        .text(v, x, y, {
          width: cols[i].width - 6,
          align: cols[i].align ?? 'left',
        });
      x += cols[i].width;
    });
    doc.y = y + h;
  }
  doc.moveDown(0.6);
}

function section(doc: PDFKit.PDFDocument, title: string) {
  if (doc.y > BOTTOM - 60) {
    doc.addPage();
    doc.y = L;
  }
  doc.moveDown(0.4);
  doc.font('heading').fontSize(12).fillColor(colors.ink).text(title, L, doc.y);
  doc.moveDown(0.3);
}

function pairs(doc: PDFKit.PDFDocument, R: number, items: [string, string][]) {
  for (const [k, v] of items) {
    const y = doc.y;
    doc
      .font('body')
      .fontSize(9.5)
      .fillColor(MUTED)
      .text(k, L, y, { width: 200 });
    doc
      .font('strong')
      .fontSize(9.5)
      .fillColor(colors.ink)
      .text(v, L + 210, y, { width: R - L - 210 });
    doc.y = Math.max(doc.y, y + 14) + 2;
  }
}

const day = (locale: Locale, iso: string | null) =>
  iso ? formatDate(locale, new Date(`${iso}T12:00:00`)) : '—';

export function renderSummaryPdf(d: SummaryData, meta: Meta): Promise<Buffer> {
  const { doc, t, R, finish } = documentFor(
    meta,
    createTranslator(meta.locale)('exports.kind_project_summary'),
  );
  const status =
    d.status === 'draft' || d.status === 'active'
      ? t(`exports.projectStatus_${d.status}`)
      : t('exports.projectStatus_other');
  section(doc, t('exports.section_project'));
  pairs(doc, R, [
    [t('exports.field_status'), status],
    [t('exports.field_contractor'), d.organizationName],
    ...(d.place
      ? ([[t('exports.field_place'), d.place]] as [string, string][])
      : []),
  ]);
  section(doc, t('exports.section_progress'));
  pairs(doc, R, [
    [t('exports.field_accepted'), `${d.progress.accepted}%`],
    [t('exports.field_reported'), `${d.progress.reported}%`],
  ]);
  section(doc, t('exports.section_stages'));
  table(
    doc,
    [
      { label: t('exports.col_stage'), width: 190 },
      { label: t('exports.col_weight'), width: 60, align: 'right' },
      { label: t('exports.col_status'), width: 105 },
      { label: t('exports.col_start'), width: 80 },
      { label: t('exports.col_end'), width: 80 },
    ],
    d.stages.map((s) => [
      s.name,
      String(s.weight),
      t(`stage.${s.status}`),
      day(meta.locale, s.plannedStart),
      day(meta.locale, s.plannedEnd),
    ]),
  );
  if (d.money) {
    section(doc, t('exports.section_money'));
    pairs(doc, R, [
      [t('exports.field_contract'), formatRwf(d.money.contract)],
      [t('exports.field_paid'), formatRwf(d.money.paid)],
      [t('exports.field_approved'), formatRwf(d.money.approvedUnpaid)],
      [t('exports.field_waiting'), formatRwf(d.money.awaitingDecision)],
      [t('exports.field_pending'), formatRwf(d.money.pendingVerification)],
      [t('exports.field_toCome'), formatRwf(d.money.stillToCome)],
    ]);
    if (d.spending)
      doc
        .font('body')
        .fontSize(9)
        .fillColor(MUTED)
        .text(
          t('money.spendingLine', {
            posted: formatRwf(d.spending.posted),
            committed: formatRwf(d.spending.committed),
            budget: formatRwf(d.spending.costBudget),
          }),
          L,
          doc.y,
          { width: R - L },
        );
  }
  if (d.agreements?.length) {
    section(doc, t('exports.section_agreements'));
    table(
      doc,
      [
        { label: t('exports.col_version'), width: 70 },
        { label: t('exports.col_ref'), width: 160 },
        { label: t('exports.col_date'), width: 120 },
        { label: t('exports.col_value'), width: 165, align: 'right' },
      ],
      d.agreements.map((a) => [
        `v${a.version}`,
        a.ref,
        formatDate(meta.locale, a.date, meta.timeZone),
        formatRwf(a.value),
      ]),
    );
  }
  section(doc, t('exports.section_team'));
  table(
    doc,
    [
      { label: t('exports.col_name'), width: 260 },
      { label: t('exports.col_role'), width: 255 },
    ],
    d.team.map((m) => [m.name, t(`server.role_${m.role}`)]),
  );
  return finish();
}

export function renderHistoryPdf(
  rows: HistoryRow[],
  meta: Meta,
): Promise<Buffer> {
  const { doc, t, finish } = documentFor(
    meta,
    createTranslator(meta.locale)('exports.kind_money_history'),
  );
  if (!rows.length)
    doc
      .font('body')
      .fontSize(10)
      .fillColor(MUTED)
      .text(t('exports.historyEmpty'), L, doc.y);
  else
    table(
      doc,
      [
        { label: t('exports.col_date'), width: 62 },
        { label: t('exports.col_type'), width: 92 },
        { label: t('exports.col_ref'), width: 82 },
        { label: t('exports.col_details'), width: 140 },
        { label: t('exports.col_amount'), width: 70, align: 'right' },
        { label: t('exports.col_by'), width: 69 },
      ],
      rows.map((r) => [
        formatDate(meta.locale, r.at, meta.timeZone),
        t(`exports.type_${r.type}`),
        r.ref,
        r.details,
        r.amount === null ? '' : formatRwf(r.amount).replace(/^RWF\s*/, ''),
        r.by ?? '',
      ]),
    );
  return finish();
}
