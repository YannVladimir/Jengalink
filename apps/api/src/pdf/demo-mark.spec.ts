import PDFDocument from 'pdfkit';
import { markDemoPages } from './demo-mark';

/** Renders a 3-page document and counts the DEMO tabs in it. */
async function stamps(bufferPages: boolean) {
  const doc = new PDFDocument({ size: 'A4', compress: false, bufferPages });
  markDemoPages(doc);
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<string>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('latin1'))),
  );
  for (let i = 0; i < 3; i++) {
    if (i) doc.addPage();
    // A header band where the tab goes: the tab must still end up on top.
    doc.rect(0, 0, doc.page.width, 80).fill('#1e3a5f');
    doc.fillColor('#000').text(`Page ${i + 1}`, 50, 120);
  }
  doc.end();
  const pdf = await done;
  // pdfkit writes the text as hex: "DEMO · made-up data".
  return (pdf.match(/<44454d4f20b7206d6164652d75702064617461>/g) ?? []).length;
}

describe('demo mark on PDFs', () => {
  afterEach(() => delete process.env.DEMO_MODE);

  it('puts the tab on every page, after the page content, in a demo environment', async () => {
    process.env.DEMO_MODE = 'on';
    expect(await stamps(true)).toBe(3);
    expect(await stamps(false)).toBeGreaterThanOrEqual(3);
  });

  it('adds nothing elsewhere', async () => {
    expect(await stamps(true)).toBe(0);
  });
});
