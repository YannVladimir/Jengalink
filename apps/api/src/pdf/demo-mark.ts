/** A small "DEMO" tab on every page when the API runs as a demo environment (spec §34). */
export function markDemoPages(doc: PDFKit.PDFDocument) {
  if (process.env.DEMO_MODE !== 'on') return;
  const stamp = () => {
    // Drawn in the top margin; the page's text position and font size stay as they were.
    const { x, y } = doc;
    const size = (doc as unknown as { _fontSize: number })._fontSize;
    const width = 140;
    const left = doc.page.width - width - 24;
    doc.save();
    doc.rect(left, 0, width, 20).fill('#f97316');
    doc
      .fillColor('#ffffff')
      .fontSize(8.5)
      .text('DEMO · made-up data', left, 6, {
        width,
        align: 'center',
        lineBreak: false,
      });
    doc.restore();
    doc.fontSize(size);
    doc.x = x;
    doc.y = y;
  };
  // Stamped last, on top of headers drawn in the same spot. Buffered documents can revisit every
  // page; otherwise each page is stamped as it starts and the last one again at the end.
  const buffered = !!(doc.options as { bufferPages?: boolean }).bufferPages;
  if (!buffered) doc.on('pageAdded', stamp);
  const end = doc.end.bind(doc);
  doc.end = () => {
    if (buffered) {
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        stamp();
      }
    } else stamp();
    end();
  };
}
