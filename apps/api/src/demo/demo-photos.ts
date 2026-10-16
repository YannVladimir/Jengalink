// Generated site photos for the demo (spec §34: "photos generated or licensed for demonstration").
// Simple drawings of each stage, each stamped DEMO, so nobody mistakes them for a real site.
import sharp from 'sharp';

export type DemoScene = 'site' | 'foundation' | 'walls' | 'roof' | 'interior';

const W = 1200;
const H = 900;
const GROUND = 640;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function bricks(x: number, width: number, height: number) {
  const rows: string[] = [];
  const bh = 22;
  for (let r = 0; r * bh < height; r++) {
    const y = GROUND - (r + 1) * bh;
    const offset = r % 2 ? 30 : 0;
    for (let bx = x - offset; bx < x + width; bx += 60) {
      const left = Math.max(bx, x);
      const right = Math.min(bx + 58, x + width);
      if (right > left)
        rows.push(
          `<rect x="${left}" y="${y}" width="${right - left}" height="${bh - 3}" fill="#b5653a"/>`,
        );
    }
  }
  return rows.join('');
}

function scene(kind: DemoScene, progress: number) {
  const p = Math.max(0, Math.min(1, progress));
  switch (kind) {
    case 'site':
      return `
        <ellipse cx="900" cy="${GROUND}" rx="${120 + 60 * p}" ry="70" fill="#c9a66b"/>
        <rect x="200" y="${GROUND + 40}" width="${500 * p + 100}" height="26" fill="#6b5844"/>
        <rect x="200" y="${GROUND + 120}" width="${500 * p + 100}" height="26" fill="#6b5844"/>
        <line x1="180" y1="${GROUND - 30}" x2="180" y2="${GROUND + 10}" stroke="#f97316" stroke-width="6"/>
        <line x1="820" y1="${GROUND - 30}" x2="820" y2="${GROUND + 10}" stroke="#f97316" stroke-width="6"/>`;
    case 'foundation': {
      const bars = Array.from(
        { length: 9 },
        (_, i) =>
          `<line x1="${260 + i * 80}" y1="${GROUND - 20 - 60 * p}" x2="${260 + i * 80}" y2="${GROUND}" stroke="#555" stroke-width="5"/>`,
      ).join('');
      return `
        <rect x="200" y="${GROUND - 20 - 30 * p}" width="800" height="${40 + 30 * p}" fill="#9e9e9e"/>
        ${p < 0.9 ? bars : ''}`;
    }
    case 'walls': {
      const height = 40 + 300 * p;
      return `
        ${bricks(220, 760, height)}
        ${p > 0.5 ? `<rect x="360" y="${GROUND - 200}" width="120" height="110" fill="#d9e6f2"/><rect x="720" y="${GROUND - 200}" width="120" height="110" fill="#d9e6f2"/>` : ''}
        ${p > 0.75 ? `<rect x="340" y="${GROUND - 225}" width="160" height="22" fill="#8d8d8d"/><rect x="700" y="${GROUND - 225}" width="160" height="22" fill="#8d8d8d"/>` : ''}`;
    }
    case 'roof': {
      const sheets = Array.from(
        { length: 14 },
        (_, i) =>
          `<line x1="${200 + i * 60}" y1="${GROUND - 340}" x2="${600}" y2="${GROUND - 340 - 220 * p}" stroke="#7d8b95" stroke-width="3"/>`,
      ).join('');
      return `
        ${bricks(220, 760, 340)}
        <polygon points="160,${GROUND - 340} 600,${GROUND - 340 - 220 * p} 1040,${GROUND - 340}" fill="#9aa8b1"/>
        ${sheets}`;
    }
    case 'interior': {
      const tiles = Array.from({ length: 10 }, (_, i) =>
        Array.from(
          { length: 4 },
          (_, j) =>
            `<rect x="${i * 120}" y="${GROUND + j * 65}" width="118" height="63" fill="${i / 10 < p ? '#e8e0d4' : '#7b6f63'}"/>`,
        ).join(''),
      ).join('');
      return `
        <rect x="0" y="0" width="${W}" height="${GROUND}" fill="#d8cfc4"/>
        <rect x="0" y="0" width="${W * p}" height="${GROUND}" fill="#f4efe8"/>
        <rect x="820" y="160" width="220" height="260" fill="#cfe2f3" stroke="#8a7a6a" stroke-width="10"/>
        ${tiles}`;
    }
  }
}

/** A 1200×900 JPEG of a stage at `progress` (0–1), with a caption and a DEMO stamp. */
export async function demoPhoto(
  kind: DemoScene,
  progress: number,
  caption: string,
): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc3e6"/><stop offset="1" stop-color="#e3eef8"/></linearGradient></defs>
    <rect width="${W}" height="${GROUND}" fill="url(#sky)"/>
    <rect y="${GROUND}" width="${W}" height="${H - GROUND}" fill="#a08c72"/>
    ${scene(kind, progress)}
    <rect x="0" y="${H - 90}" width="${W}" height="90" fill="rgba(0,0,0,0.55)"/>
    <text x="40" y="${H - 34}" font-family="Arial, Helvetica, sans-serif" font-size="40" fill="#fff">${esc(caption)}</text>
    <rect x="${W - 230}" y="30" width="200" height="70" rx="12" fill="#f97316"/>
    <text x="${W - 130}" y="80" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="bold" fill="#fff">DEMO</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}
