import { markDemoPages } from './demo-mark';
import { join } from 'node:path';
import { createTranslator, formatDate, type Locale } from '@jengalink/i18n';
import PDFDocument from 'pdfkit';

const FONTS = join(__dirname, 'fonts');
const NAVY = '#1E3A5F';
const ORANGE = '#C2410C';
const INK = '#1F2937';
const MUTED = '#6B7280';
const LINE = '#E5E1DA';
const ZEBRA = '#F7F5F1';

export interface QuotePdfData {
  locale: Locale;
  number: string;
  revision: number;
  sent: boolean;
  date: string;
  validUntil: string;
  organizationName: string;
  clientName: string | null;
  projectName: string;
  projectPlace: string | null;
  title: string;
  scope: string;
  milestones: {
    name: string;
    description: string | null;
    amount: number;
    basis: 'fixed' | 'reimbursable';
    feePercent: number | null;
  }[];
  commercialBasis: 'fixed' | 'reimbursable' | 'hybrid';
  total: number;
  currency: string;
  exclusions: string[];
  terms: string | null;
  /** Shown as a stamp when this revision was accepted. */
  accepted?: {
    byName: string | null;
    at: string;
    agreementVersion: number | null;
  } | null;
}

const money = (currency: string, n: number) =>
  `${currency} ${Math.round(n).toLocaleString('en-US')}`;
const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** The branded quotation PDF (spec §37.1), in the reader's language. Returns the file bytes. */
export function renderQuotePdf(q: QuotePdfData): Promise<Buffer> {
  const t = createTranslator(q.locale);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    bufferPages: true,
    info: {
      Title: `${t('quote.pdfQuote')} ${q.number}`,
      Author: q.organizationName,
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

  const W = doc.page.width;
  const left = 48;
  const right = W - 48;
  const width = right - left;
  const bottom = () => doc.page.height - 72;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // Header band with the JengaLink tower mark.
  doc.rect(0, 0, W, 96).fill(NAVY);
  doc.roundedRect(left, 30, 30, 9, 2).fill('#FFFFFF');
  doc
    .roundedRect(left, 42, 30, 9, 2)
    .fillOpacity(0.7)
    .fill('#FFFFFF')
    .fillOpacity(1);
  doc.roundedRect(left + 6, 54, 24, 9, 2).fill('#F97316');
  doc
    .font('heading')
    .fontSize(20)
    .fillColor('#FFFFFF')
    .text('JengaLink', left + 40, 37);
  doc
    .font('heading')
    .fontSize(22)
    .text(t('quote.pdfQuote'), left, 28, { width, align: 'right' });
  doc
    .font('body')
    .fontSize(10)
    .fillColor('#D6E0EC')
    .text(`${q.number} · ${t('quote.revision', { n: q.revision })}`, left, 58, {
      width,
      align: 'right',
    });

  // Details grid.
  doc.y = 120;
  const cell = (
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
  ) => {
    doc
      .font('body')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(label.toUpperCase(), x, y, { width: w, characterSpacing: 0.5 });
    doc
      .font('strong')
      .fontSize(10.5)
      .fillColor(INK)
      .text(value, x, y + 12, { width: w });
  };
  const colW = width / 3;
  const top = doc.y;
  cell(t('quote.pdfFrom'), q.organizationName, left, top, colW - 12);
  cell(t('quote.pdfFor'), q.clientName ?? '—', left + colW, top, colW - 12);
  cell(
    t('quote.pdfProject'),
    q.projectPlace ? `${q.projectName}\n${q.projectPlace}` : q.projectName,
    left + colW * 2,
    top,
    colW,
  );
  cell(
    t('quote.pdfDate'),
    formatDate(q.locale, q.date),
    left,
    top + 46,
    colW - 12,
  );
  cell(
    t('quote.pdfValid'),
    formatDate(q.locale, fromIsoDate(q.validUntil)),
    left + colW,
    top + 46,
    colW - 12,
  );
  cell(
    t('quote.pdfTotal'),
    money(q.currency, q.total),
    left + colW * 2,
    top + 46,
    colW,
  );
  doc
    .moveTo(left, top + 88)
    .lineTo(right, top + 88)
    .lineWidth(1)
    .strokeColor(LINE)
    .stroke();

  // Title and scope.
  doc
    .font('heading')
    .fontSize(17)
    .fillColor(INK)
    .text(q.title, left, top + 104, { width });
  doc
    .font('body')
    .fontSize(9.5)
    .fillColor(MUTED)
    .text(
      `${t('basis.pdfBasis')}: ${t(`basis.${q.commercialBasis}`)}`,
      left,
      doc.y + 2,
      { width },
    );
  doc.moveDown(0.6);
  const heading = (text: string) => {
    ensure(40);
    doc.moveDown(0.4);
    doc
      .font('heading')
      .fontSize(11.5)
      .fillColor(NAVY)
      .text(text, left, doc.y, { width });
    doc.moveDown(0.3);
  };
  heading(t('quote.pdfScope'));
  doc
    .font('body')
    .fontSize(10)
    .fillColor(INK)
    .text(q.scope, left, doc.y, { width, lineGap: 2 });

  // Milestones table.
  heading(t('quote.pdfMilestones'));
  const amountW = 120;
  const nameW = width - amountW - 34;
  const row = (
    i: number,
    name: string,
    desc: string | null,
    amount: string,
  ) => {
    doc.font('strong').fontSize(10);
    const h = Math.max(
      24,
      doc.heightOfString(name, { width: nameW }) +
        (desc
          ? doc
              .font('body')
              .fontSize(8.5)
              .heightOfString(desc, { width: nameW }) + 4
          : 0) +
        12,
    );
    ensure(h);
    const y = doc.y;
    if (i % 2 === 0) doc.rect(left, y, width, h).fill(ZEBRA);
    doc
      .font('body')
      .fontSize(9)
      .fillColor(MUTED)
      .text(String(i + 1), left + 8, y + 7, { width: 20 });
    doc
      .font('strong')
      .fontSize(10)
      .fillColor(INK)
      .text(name, left + 30, y + 6, { width: nameW });
    if (desc)
      doc
        .font('body')
        .fontSize(8.5)
        .fillColor(MUTED)
        .text(desc, left + 30, doc.y + 1, { width: nameW });
    doc
      .font('strong')
      .fontSize(10)
      .fillColor(INK)
      .text(amount, right - amountW - 8, y + 6, {
        width: amountW,
        align: 'right',
      });
    doc.y = y + h;
  };
  ensure(24);
  doc
    .font('body')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(t('quote.milestoneName').toUpperCase(), left + 30, doc.y, {
      width: nameW,
      characterSpacing: 0.5,
      continued: false,
    });
  doc.text(
    t('quote.pdfAmount').toUpperCase(),
    right - amountW - 8,
    doc.y - 10.5,
    { width: amountW, align: 'right', characterSpacing: 0.5 },
  );
  doc.moveDown(0.4);
  q.milestones.forEach((m, i) => {
    const basis =
      m.basis === 'reimbursable'
        ? t('basis.pdfReimbursable', { fee: m.feePercent ?? 0 })
        : t('basis.pdfFixed');
    row(
      i,
      m.name,
      m.description ? `${basis} · ${m.description}` : basis,
      money(q.currency, m.amount),
    );
  });
  ensure(34);
  const ty = doc.y + 4;
  doc
    .moveTo(left, ty)
    .lineTo(right, ty)
    .lineWidth(2)
    .strokeColor(ORANGE)
    .stroke();
  doc
    .font('heading')
    .fontSize(12.5)
    .fillColor(INK)
    .text(t('quote.pdfTotal'), left + 30, ty + 9, { width: nameW });
  doc.text(money(q.currency, q.total), right - amountW - 8 - 60, ty + 9, {
    width: amountW + 60,
    align: 'right',
  });
  doc.y = ty + 34;

  if (q.exclusions.length) {
    heading(t('quote.pdfExclusions'));
    for (const e of q.exclusions) {
      ensure(18);
      doc
        .font('body')
        .fontSize(10)
        .fillColor(INK)
        .text(`•  ${e}`, left + 4, doc.y, { width: width - 4, lineGap: 1 });
    }
  }
  if (q.accepted) {
    ensure(60);
    doc.moveDown(0.8);
    const y = doc.y;
    doc
      .roundedRect(left, y, width, 46, 8)
      .lineWidth(1.5)
      .strokeColor('#15803D')
      .stroke();
    doc
      .font('heading')
      .fontSize(12)
      .fillColor('#15803D')
      .text(
        t('agreement.pdfAccepted', {
          name: q.accepted.byName ?? '—',
          date: formatDate(q.locale, q.accepted.at),
        }),
        left + 14,
        y + 9,
        { width: width - 28 },
      );
    if (q.accepted.agreementVersion)
      doc
        .font('body')
        .fontSize(9)
        .fillColor(MUTED)
        .text(
          t('agreement.version', { n: q.accepted.agreementVersion }),
          left + 14,
          y + 27,
          { width: width - 28 },
        );
    doc.y = y + 56;
  }
  if (q.terms) {
    heading(t('quote.pdfTerms'));
    doc
      .font('body')
      .fontSize(10)
      .fillColor(INK)
      .text(q.terms, left, doc.y, { width, lineGap: 2 });
  }

  // Footer on every page: the records-only statement and page numbers.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    // Not sent yet: a light watermark on top of every page, so nobody mistakes it for the real offer.
    if (!q.sent) {
      doc.save();
      doc.rotate(-30, { origin: [W / 2, 420] });
      doc
        .font('heading')
        .fontSize(54)
        .fillColor(ORANGE)
        .fillOpacity(0.07)
        .text(t('quote.pdfDraft'), 0, 400, {
          width: W,
          align: 'center',
          lineBreak: false,
        });
      doc.restore();
      doc.fillOpacity(1);
    }
    const fy = doc.page.height - 48;
    doc
      .moveTo(left, fy - 8)
      .lineTo(right, fy - 8)
      .lineWidth(0.5)
      .strokeColor(LINE)
      .stroke();
    doc
      .font('body')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(t('quote.pdfFooter'), left, fy, {
        width: width - 90,
        lineBreak: true,
        height: 24,
      });
    doc.text(
      t('quote.pdfPage', { n: i + 1, total: range.count }),
      right - 90,
      fy,
      { width: 90, align: 'right' },
    );
  }
  doc.end();
  return done;
}
