import { markDemoPages } from './demo-mark';
import { join } from 'node:path';
import type { ShareSection, WeeklyReportData } from '@jengalink/contracts';
import { createTranslator, formatDate, type Locale } from '@jengalink/i18n';
import {
  colors,
  formatRwf,
  moneySegments,
  ringSentence,
  statuses,
  towerLayout,
  towerSentence,
} from '@jengalink/ui';
import PDFDocument from 'pdfkit';

const FONTS = join(__dirname, 'fonts');
const NAVY = '#1E3A5F';
const INK = colors.ink;
const MUTED = colors.inkMuted;
const LINE = '#E5E1DA';
/** Room kept on the right of a money row for its amount. */
const AMOUNT_W = 78;

export interface ReportPdfData {
  locale: Locale;
  weekStart: string;
  weekEnd: string;
  revisionNo: number;
  generatedByName: string | null;
  generatedAt: string;
  data: WeeklyReportData;
  /** Up to 4 thumbnails (JPEG), newest first. */
  photos: { image: Buffer; takenAt: string }[];
  /** A shared copy: only these optional sections are drawn (progress and the tower always are). */
  sections?: readonly ShareSection[];
}

const fromIsoDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** The tower's looks, as in the apps (accepted solid, review hatched, in progress dashed, problem red). */
function towerLook(status: string) {
  switch (status) {
    case 'accepted':
      return {
        fill: colors.primary,
        stroke: colors.primary,
        ink: '#FFFFFF',
        dash: false,
      };
    case 'ready_for_review':
      return {
        fill: colors.primarySoft,
        stroke: colors.accent,
        ink: INK,
        dash: false,
      };
    case 'in_progress':
      return {
        fill: colors.primarySoft,
        stroke: colors.accent,
        ink: INK,
        dash: true,
      };
    case 'blocked':
    case 'changes_required':
      return {
        fill: statuses.problem.soft,
        stroke: statuses.problem.color,
        ink: statuses.problem.color,
        dash: false,
      };
    default:
      return {
        fill: colors.surfaceSunken,
        stroke: colors.borderStrong,
        ink: MUTED,
        dash: true,
      };
  }
}

/** An SVG arc path for pdfkit, from angle a to b (degrees, 0 = top, clockwise). */
function arc(cx: number, cy: number, r: number, a: number, b: number) {
  const pt = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = pt(a);
  const [x2, y2] = pt(b);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}

/** The one-page weekly report (spec §15, A0) in the reader's language. Returns the file bytes. */
export function renderWeeklyReportPdf(r: ReportPdfData): Promise<Buffer> {
  const t = createTranslator(r.locale);
  const lang = { t, locale: r.locale };
  const d = r.data;
  const show = (s: ShareSection) => !r.sections || r.sections.includes(s);
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    info: {
      Title: `${t('report.title')} ${r.weekStart}`,
      Author: d.organizationName,
    },
  });
  markDemoPages(doc);
  // One page by design (every list is capped): no automatic page break at the bottom margin.
  doc.page.margins.bottom = 0;
  doc.registerFont('body', join(FONTS, 'Inter_400Regular.ttf'));
  doc.registerFont('strong', join(FONTS, 'Inter_600SemiBold.ttf'));
  doc.registerFont('heading', join(FONTS, 'PlusJakartaSans_700Bold.ttf'));
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );
  const W = doc.page.width;
  const L = 36;
  const R = W - 36;
  const fmt = (iso: string) =>
    formatDate(r.locale, iso.length === 10 ? fromIsoDate(iso) : new Date(iso));
  const text = (
    s: string,
    x: number,
    y: number,
    o: PDFKit.Mixins.TextOptions & {
      font?: string;
      size?: number;
      color?: string;
    } = {},
  ) => {
    doc
      .font(o.font ?? 'body')
      .fontSize(o.size ?? 9)
      .fillColor(o.color ?? INK)
      .text(s, x, y, { lineBreak: true, ...o });
  };
  const title = (s: string, x: number, y: number) =>
    text(s.toUpperCase(), x, y, {
      font: 'strong',
      size: 8,
      color: MUTED,
      characterSpacing: 0.6,
    });

  // Header band with the tower mark.
  doc.rect(0, 0, W, 78).fill(NAVY);
  doc.roundedRect(L, 24, 26, 8, 2).fill('#FFFFFF');
  doc
    .roundedRect(L, 35, 26, 8, 2)
    .fillOpacity(0.7)
    .fill('#FFFFFF')
    .fillOpacity(1);
  doc.roundedRect(L + 5, 46, 21, 8, 2).fill('#F97316');
  text(t('report.title'), L + 40, 22, {
    font: 'heading',
    size: 18,
    color: '#FFFFFF',
  });
  text(
    `${t('report.weekLine', { start: fmt(r.weekStart), end: fmt(r.weekEnd) })}${r.revisionNo > 1 ? ` · ${t('report.revisionTag', { n: r.revisionNo })}` : ''}`,
    L + 40,
    46,
    {
      size: 10,
      color: '#DCE6F2',
    },
  );
  text(d.organizationName, L, 26, {
    width: R - L,
    align: 'right',
    font: 'strong',
    size: 10,
    color: '#FFFFFF',
  });

  text(d.projectName, L, 92, { font: 'heading', size: 16 });
  if (d.place) text(d.place, L, 114, { color: MUTED });

  // Row 1: progress ring · tower · money.
  const top = 138;
  const withMoney = !!d.money;
  const ringX = L;
  const towerX = L + 170;
  const towerW = withMoney ? 175 : 340;
  const moneyX = towerX + towerW + 16;

  title(t('report.progressTitle'), ringX, top);
  const cx = ringX + 70;
  const cy = top + 82;
  const radius = 54;
  const acc = Math.max(0, Math.min(100, d.progress.accepted));
  const rep = Math.max(0, Math.min(100 - acc, d.progress.reported));
  doc.lineWidth(14).circle(cx, cy, radius).stroke(colors.surfaceSunken);
  if (acc >= 100) doc.circle(cx, cy, radius).stroke(colors.primary);
  else {
    if (acc > 0)
      doc
        .path(arc(cx, cy, radius, 0, (acc / 100) * 360))
        .lineCap('round')
        .stroke(colors.primary);
    if (rep > 0)
      doc
        .path(arc(cx, cy, radius, (acc / 100) * 360, ((acc + rep) / 100) * 360))
        .lineCap('butt')
        .stroke(colors.accent);
  }
  doc.lineCap('butt');
  text(`${acc}%`, cx - 50, cy - 16, {
    width: 100,
    align: 'center',
    font: 'heading',
    size: 24,
  });
  text(
    ringSentence(
      { accepted: d.progress.accepted, reported: d.progress.reported },
      lang,
    ),
    ringX,
    cy + 66,
    { width: 150, size: 8.5, color: MUTED },
  );
  const change =
    d.progress.acceptedChange === null
      ? t('report.firstReport')
      : d.progress.acceptedChange > 0
        ? t('report.acceptedChange', { points: d.progress.acceptedChange })
        : t('report.acceptedSame');
  text(change, ringX, doc.y + 4, { width: 150, font: 'strong', size: 8.5 });

  title(t('report.towerTitle'), towerX, top);
  const n = Math.max(1, d.stages.length);
  const blockH = Math.max(11, Math.min(20, (178 - (n - 1) * 3) / n));
  const layout = towerLayout(
    d.stages.map((s, i) => ({ id: String(i), name: s.name, status: s.status })),
    towerW,
    blockH,
    3,
    10,
  );
  const ty = top + 16;
  for (const b of layout.blocks) {
    const look = towerLook(b.status);
    doc.lineWidth(1);
    if (look.dash) doc.dash(3, { space: 2 });
    doc
      .roundedRect(towerX + b.x, ty + b.y, b.width, b.height, 4)
      .fillAndStroke(look.fill, look.stroke);
    doc.undash();
    const mark =
      b.status === 'accepted'
        ? '✓ '
        : b.status === 'blocked' || b.status === 'changes_required'
          ? '! '
          : '';
    text(`${mark}${b.name}`, towerX + b.x + 6, ty + b.y + b.height / 2 - 4.5, {
      width: b.width - 12,
      height: 10,
      ellipsis: true,
      lineBreak: false,
      size: 7.5,
      color: look.ink,
      font: 'strong',
    });
  }
  text(towerSentence(layout.blocks, lang), towerX, ty + layout.height + 6, {
    width: towerW,
    size: 8.5,
    color: MUTED,
  });

  if (d.money) {
    const m = d.money;
    title(t('report.moneyTitle'), moneyX, top);
    const mw = R - moneyX;
    const segs = moneySegments(
      { contract: m.contract, paid: m.paid, approvedUnpaid: m.approvedUnpaid },
      lang,
    );
    const fills: Record<string, string> = {
      paid: statuses.paid.color,
      approved: statuses.approved.color,
      remaining: colors.surfaceSunken,
    };
    let x = moneyX;
    for (const s of segs) {
      const w = s.fraction * mw;
      if (w > 0) doc.rect(x, top + 18, w, 12).fill(fills[s.key]);
      x += w;
    }
    let y = top + 40;
    for (const s of segs) {
      doc.rect(moneyX, y + 2, 7, 7).fill(fills[s.key]);
      // Labels wrap beside the amount (Kinyarwanda and French run longer than English).
      text(s.label, moneyX + 12, y, { size: 8.5, width: mw - 12 - AMOUNT_W });
      const below = doc.y;
      text(formatRwf(s.amount), moneyX, y, {
        width: mw,
        align: 'right',
        font: 'strong',
        size: 8.5,
      });
      y = Math.max(below, y + 11) + 4;
    }
    y += 4;
    doc.moveTo(moneyX, y).lineTo(R, y).lineWidth(0.5).stroke(LINE);
    y += 6;
    for (const [label, amount] of [
      [t('money.agreedContract'), m.contract],
      [t('money.waitingForDecision'), m.awaitingDecision],
      [t('money.pendingVerification'), m.pendingVerification],
    ] as const) {
      text(label, moneyX, y, { size: 8.5, color: MUTED, width: mw - AMOUNT_W });
      const below = doc.y;
      text(formatRwf(amount), moneyX, y, {
        width: mw,
        align: 'right',
        size: 8.5,
      });
      y = Math.max(below, y + 11) + 3;
    }
    if (d.spending)
      text(
        t('money.spendingLine', {
          posted: formatRwf(d.spending.posted),
          committed: formatRwf(d.spending.committed),
          budget: formatRwf(d.spending.costBudget),
        }),
        moneyX,
        y + 4,
        {
          width: mw,
          size: 8,
          color: MUTED,
        },
      );
  }

  // Row 2: this week.
  let y = 382;
  doc
    .moveTo(L, y - 10)
    .lineTo(R, y - 10)
    .lineWidth(0.5)
    .stroke(LINE);
  if (show('work')) {
    title(t('report.thisWeek'), L, y);
    y += 14;
    if (d.work.updates === 0) text(t('report.noWork'), L, y, { color: MUTED });
    else {
      text(
        t('report.updatesLine', {
          updates: d.work.updates,
          photos: d.work.photos,
        }),
        L,
        y,
        { font: 'strong', size: 10 },
      );
      const lines = [
        d.work.authors.length
          ? t('report.byLine', { names: d.work.authors.join(', ') })
          : null,
        d.work.stagesWorked.length
          ? t('report.stagesWorked', { stages: d.work.stagesWorked.join(', ') })
          : null,
      ].filter((s): s is string => !!s);
      for (const s of lines)
        text(s, L, doc.y + 2, { width: R - L, color: MUTED });
    }
    if (d.work.blockers.length) {
      y = doc.y + 6;
      text(t('report.blockersTitle'), L, y, {
        font: 'strong',
        size: 9,
        color: statuses.problem.color,
      });
      for (const b of d.work.blockers.slice(0, 3))
        text(`! ${b.stage}: ${b.text}`, L, doc.y + 2, {
          width: R - L,
          color: statuses.problem.color,
          height: 22,
          ellipsis: true,
        });
    }

    y = Math.max(doc.y + 14, 470);
  }

  // Row 3: photos.
  if (show('photos')) {
    title(t('report.photosTitle'), L, y);
    y += 14;
    const pw = (R - L - 3 * 8) / 4;
    const ph = pw * 0.72;
    if (!r.photos.length) text(t('report.noPhotos'), L, y, { color: MUTED });
    r.photos.slice(0, 4).forEach((p, i) => {
      const px = L + i * (pw + 8);
      doc.save();
      doc.roundedRect(px, y, pw, ph, 6).clip();
      try {
        doc.image(p.image, px, y, {
          cover: [pw, ph],
          align: 'center',
          valign: 'center',
        });
      } catch {
        doc.rect(px, y, pw, ph).fill(colors.surfaceSunken);
      }
      doc.restore();
      text(fmt(p.takenAt), px, y + ph + 3, {
        width: pw,
        size: 7.5,
        color: MUTED,
      });
    });

    y = y + ph + 24;
  }

  // Row 4: decisions waiting, and what comes next.
  if (show('decisions')) {
    title(t('report.decisionsTitle'), L, y);
    y += 14;
    const now = Date.now();
    if (!d.decisions.length)
      text(t('report.noDecisions'), L, y, { color: MUTED });
    for (const dec of d.decisions.slice(0, 6)) {
      const days = Math.floor(
        (now - new Date(dec.since).getTime()) / 86_400_000,
      );
      doc.circle(L + 3, y + 5, 3).fill(statuses.waiting.color);
      text(`${t(`report.decision_${dec.kind}`)} · ${dec.title}`, L + 12, y, {
        width: 330,
        height: 11,
        ellipsis: true,
        lineBreak: false,
        font: 'strong',
      });
      if (dec.amount !== null)
        text(formatRwf(dec.amount), L + 350, y, { width: 100, align: 'right' });
      text(
        days < 1 ? t('report.waitingToday') : t('report.waitingDays', { days }),
        L + 455,
        y,
        {
          width: R - L - 455,
          align: 'right',
          color: statuses.waiting.color,
          size: 8.5,
        },
      );
      y += 15;
    }
    if (d.decisions.length > 6) {
      text(`+${d.decisions.length - 6}`, L + 12, y, { color: MUTED });
      y += 15;
    }
    y += 10;
  }

  if (d.next.length) {
    title(t('report.nextTitle'), L, y);
    y += 14;
    for (const nx of d.next) {
      text(
        nx.plannedStart
          ? t('report.nextLine', {
              stage: nx.stage,
              date: fmt(nx.plannedStart),
            })
          : nx.stage,
        L,
        y,
        { width: R - L },
      );
      y += 13;
    }
  }

  // Footer.
  doc.moveTo(L, 796).lineTo(R, 796).lineWidth(0.5).stroke(LINE);
  text(
    t('report.footer', {
      name: r.generatedByName ?? '—',
      date: fmt(r.generatedAt),
    }),
    L,
    802,
    { width: R - L, size: 7.5, color: MUTED },
  );
  doc.end();
  return done;
}
