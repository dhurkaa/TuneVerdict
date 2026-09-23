import { describe, expect, it } from 'vitest';
import { CONTENT_WIDTH, PdfDocument, widthOf, wrap } from './pdf';

async function textOf(blob: Blob): Promise<string> {
  return new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer()));
}

describe('text measurement', () => {
  it('measures real glyph widths, not an assumed character count', () => {
    // "iiii" and "MMMM" are the same length and nowhere near the same width.
    expect(widthOf('MMMM', 'Helvetica', 10)).toBeGreaterThan(widthOf('iiii', 'Helvetica', 10) * 3);
  });

  it('scales with font size', () => {
    expect(widthOf('TuneVerdict', 'Helvetica', 20)).toBeCloseTo(widthOf('TuneVerdict', 'Helvetica', 10) * 2, 6);
  });

  it('never wraps a line wider than the column', () => {
    const albanian =
      'Masa zë 62% të buxhetit të pasigurisë. Për një pohim ±5 hp duhet njohur brenda 1.44% — ' +
      'domethënë ±22 kg në 1500 kg. Peshoje automjetin; mos e hamendëso masën e tij.';
    const lines = wrap(albanian, 'Helvetica', 10, CONTENT_WIDTH);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(widthOf(line, 'Helvetica', 10)).toBeLessThanOrEqual(CONTENT_WIDTH);
    }
    // Wrapping must not lose or duplicate words.
    expect(lines.join(' ').split(/\s+/).length).toBe(albanian.split(/\s+/).length);
  });
});

describe('document structure', () => {
  it('produces a file a PDF reader will accept', async () => {
    const doc = new PdfDocument();
    doc.heading('Verdict');
    doc.text('Gain proven, no safety findings');
    doc.row('Gain', '+36.1 hp');
    doc.bar(0.72, { r: 0, g: 0.5, b: 0.4 });

    const pdf = await textOf(doc.toBlob());

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);

    // startxref must point at the byte offset of the xref table, or readers that
    // trust it — which is all of them — fail to open the file.
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');

    // Every object offset in the table must land on that object's header.
    const xrefBody = pdf.slice(startxref).split('\n').slice(2);
    const size = Number(/\/Size (\d+)/.exec(pdf)?.[1]);
    for (let object = 1; object < size; object++) {
      const entry = xrefBody[object] as string;
      const offset = Number(entry.slice(0, 10));
      expect(pdf.slice(offset, offset + `${object} 0 obj`.length)).toBe(`${object} 0 obj`);
    }
  });

  it('starts a new page rather than writing off the bottom of the last one', async () => {
    const doc = new PdfDocument();
    for (let i = 0; i < 140; i++) doc.text(`Line ${i} of a report that does not fit on one page.`);
    const pdf = await textOf(doc.toBlob());
    const pages = pdf.match(/\/Type \/Page[^s]/g) ?? [];
    expect(pages.length).toBeGreaterThan(1);
    expect(/\/Count (\d+)/.exec(pdf)?.[1]).toBe(String(pages.length));
  });

  it('declares a stream length that matches the stream', async () => {
    const doc = new PdfDocument();
    doc.text('Përzierje e varfër nën ngarkesë');
    const pdf = await textOf(doc.toBlob());
    const match = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);
    expect(match).not.toBeNull();
    expect((match?.[2] as string).length).toBe(Number(match?.[1]));
  });
});

describe('charts', () => {
  it('draws a two-axis chart and keeps the file valid', async () => {
    const doc = new PdfDocument();
    doc.heading('Torque and power');
    doc.chart({
      height: 200,
      xMin: 2000,
      xMax: 5500,
      xTicks: [2000, 3000, 4000, 5000],
      xLabel: 'rpm',
      intervals: 6,
      leftMin: 0,
      leftMax: 480,
      leftStep: 80,
      leftLabel: 'Nm',
      leftColour: { r: 0.2, g: 0.4, b: 0.7 },
      rightMin: 0,
      rightMax: 360,
      rightStep: 60,
      rightLabel: 'PS',
      rightColour: { r: 0.04, g: 0.42, b: 0.34 },
      series: [
        {
          axis: 'left',
          colour: { r: 0.2, g: 0.4, b: 0.7 },
          dashed: true,
          width: 1,
          points: [
            { x: 2000, y: 350 },
            { x: 5500, y: 280 },
          ],
        },
        {
          axis: 'right',
          colour: { r: 0.04, g: 0.42, b: 0.34 },
          dashed: false,
          width: 1.6,
          points: [
            { x: 2000, y: 100 },
            { x: 5500, y: 300 },
          ],
          band: [
            { x: 2000, lo: 95, hi: 105 },
            { x: 5500, lo: 290, hi: 310 },
          ],
        },
      ],
    });
    doc.text('after the chart');
    const pdf = await textOf(doc.toBlob());

    expect(pdf).toContain('[4 3] 0 d'); // the dashed "before" line
    expect(pdf).toContain('(Nm) Tj');
    expect(pdf).toContain('(PS) Tj');
    expect(pdf).toContain(' h f'); // the filled interval band
    const startxref = Number(/startxref\n(\d+)/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe('xref');
  });
});

describe('encoding', () => {
  it('keeps Albanian letters, which WinAnsi can represent', async () => {
    const doc = new PdfDocument();
    doc.text('Përzierje e varfër · Kthehu');
    const pdf = await textOf(doc.toBlob());
    // ë is 0xEB in WinAnsi and is written as an octal escape.
    expect(pdf).toContain('P\\353rzierje');
  });

  it('transliterates what WinAnsi cannot, rather than dropping it', async () => {
    // A missing glyph would render as an empty box in the thesis appendix.
    const doc = new PdfDocument();
    doc.text('λ 0.91 and σ 4.5');
    const pdf = await textOf(doc.toBlob());
    expect(pdf).toContain('lambda 0.91 and sd 4.5');
  });

  it('escapes the characters that would otherwise end a PDF string', async () => {
    const doc = new PdfDocument();
    doc.text('before (OBD) \\ after');
    const pdf = await textOf(doc.toBlob());
    expect(pdf).toContain('before \\(OBD\\) \\\\ after');
  });
});
