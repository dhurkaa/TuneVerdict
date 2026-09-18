/**
 * A minimal PDF writer.
 *
 * The report has to leave the browser as a file that can go into an A4 thesis
 * appendix, and it has to do so with no server and no PDF library — so the file
 * is assembled here: objects, a content stream, an xref table and a trailer.
 *
 * Two deliberate limitations, both fine for this document:
 *   - Only the standard Type 1 fonts (Helvetica) are used, so nothing is embedded
 *     and the file stays a few kilobytes.
 *   - Text is encoded as WinAnsi. That covers Albanian (ë, ç) and °, ±, ×; the
 *     handful of characters it does not cover are transliterated rather than
 *     dropped, so a reader never meets an empty box.
 */

import { HELVETICA_WIDTHS, HELVETICA_BOLD_WIDTHS } from './fontMetrics';

const PAGE_WIDTH = 595.28; // A4 at 72 dpi
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN;

export type FontName = 'Helvetica' | 'Helvetica-Bold';

/**
 * Characters WinAnsi cannot represent, and what to write instead. Losing a glyph
 * silently would be worse than transliterating it: "lambda 0.91" is readable,
 * an empty box is not.
 */
const TRANSLITERATIONS: Record<string, string> = {
  'λ': 'lambda',
  'σ': 'sd',
  '−': '-',
  '–': '-',
  '—': '-',
  '↔': '<->',
  '·': '-',
  '→': '->',
  '≤': '<=',
  '≥': '>=',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '…': '...',
};

function transliterate(text: string): string {
  let out = '';
  for (const char of text) {
    const replacement = TRANSLITERATIONS[char];
    if (replacement !== undefined) {
      out += replacement;
      continue;
    }
    const code = char.codePointAt(0) ?? 63;
    out += code <= 0xff ? char : '?';
  }
  return out;
}

/** Escape for a PDF literal string, emitting non-ASCII bytes as octal escapes. */
function escapeText(text: string): string {
  let out = '';
  for (const char of transliterate(text)) {
    const code = char.charCodeAt(0);
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += char;
  }
  return out;
}

function widthOf(text: string, font: FontName, size: number): number {
  const widths = font === 'Helvetica-Bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
  let total = 0;
  for (const char of transliterate(text)) {
    const code = char.charCodeAt(0);
    total += widths[code] ?? 556;
  }
  return (total * size) / 1000;
}

/** Greedy word wrap against the real glyph widths, not an assumed character count. */
export function wrap(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (widthOf(candidate, font, size) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

interface Op {
  readonly text: string;
}

/**
 * A page under construction. Content is accumulated as a list of operators and
 * serialised once the page is closed.
 */
class Page {
  readonly ops: Op[] = [];
  y = PAGE_HEIGHT - MARGIN;

  push(text: string): void {
    this.ops.push({ text });
  }

  content(): string {
    return this.ops.map((op) => op.text).join('\n');
  }
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** Print-safe equivalents of the interface's tokens. */
export const REPORT_COLOURS = {
  text: { r: 0.06, g: 0.08, b: 0.09 },
  muted: { r: 0.35, g: 0.4, b: 0.43 },
  line: { r: 0.79, g: 0.82, b: 0.83 },
  signal: { r: 0.04, g: 0.42, b: 0.34 },
  caution: { r: 0.49, g: 0.33, b: 0.02 },
  risk: { r: 0.65, g: 0.18, b: 0.14 },
} as const satisfies Record<string, Rgb>;

export class PdfDocument {
  private readonly pages: Page[] = [];
  private page: Page;

  constructor() {
    this.page = new Page();
    this.pages.push(this.page);
  }

  private ensure(height: number): void {
    if (this.page.y - height < MARGIN) {
      this.page = new Page();
      this.pages.push(this.page);
    }
  }

  text(
    value: string,
    options: {
      font?: FontName;
      size?: number;
      colour?: Rgb;
      indent?: number;
      leading?: number;
      maxWidth?: number;
    } = {},
  ): void {
    const font = options.font ?? 'Helvetica';
    const size = options.size ?? 10;
    const colour = options.colour ?? REPORT_COLOURS.text;
    const indent = options.indent ?? 0;
    const leading = options.leading ?? size * 1.45;
    const maxWidth = options.maxWidth ?? CONTENT_WIDTH - indent;

    for (const line of wrap(value, font, size, maxWidth)) {
      this.ensure(leading);
      this.page.push(
        `BT /${font === 'Helvetica-Bold' ? 'F2' : 'F1'} ${size} Tf ` +
          `${colour.r} ${colour.g} ${colour.b} rg ` +
          `1 0 0 1 ${(MARGIN + indent).toFixed(2)} ${(this.page.y - size).toFixed(2)} Tm ` +
          `(${escapeText(line)}) Tj ET`,
      );
      this.page.y -= leading;
    }
  }

  /** A label and a value on one line, the value right-aligned like a read-out. */
  row(label: string, value: string, options: { bold?: boolean; colour?: Rgb } = {}): void {
    const size = 10;
    const leading = size * 1.6;
    this.ensure(leading);
    const font: FontName = options.bold ? 'Helvetica-Bold' : 'Helvetica';
    const colour = options.colour ?? REPORT_COLOURS.text;
    const valueWidth = widthOf(value, font, size);

    this.page.push(
      `BT /F1 ${size} Tf ${REPORT_COLOURS.muted.r} ${REPORT_COLOURS.muted.g} ${REPORT_COLOURS.muted.b} rg ` +
        `1 0 0 1 ${MARGIN.toFixed(2)} ${(this.page.y - size).toFixed(2)} Tm (${escapeText(label)}) Tj ET`,
    );
    this.page.push(
      `BT /${options.bold ? 'F2' : 'F1'} ${size} Tf ${colour.r} ${colour.g} ${colour.b} rg ` +
        `1 0 0 1 ${(PAGE_WIDTH - MARGIN - valueWidth).toFixed(2)} ${(this.page.y - size).toFixed(2)} Tm ` +
        `(${escapeText(value)}) Tj ET`,
    );
    this.page.y -= leading;
  }

  heading(value: string): void {
    this.space(10);
    this.text(value, { font: 'Helvetica-Bold', size: 13 });
    this.rule();
  }

  rule(): void {
    this.ensure(10);
    this.page.push(
      `${REPORT_COLOURS.line.r} ${REPORT_COLOURS.line.g} ${REPORT_COLOURS.line.b} RG 0.7 w ` +
        `${MARGIN} ${(this.page.y - 2).toFixed(2)} m ${(PAGE_WIDTH - MARGIN).toFixed(2)} ${(this.page.y - 2).toFixed(2)} l S`,
    );
    this.page.y -= 10;
  }

  space(height = 8): void {
    this.page.y -= height;
  }

  /** A filled proportion bar, for the validity factors. */
  bar(fraction: number, colour: Rgb): void {
    const height = 6;
    this.ensure(height + 6);
    const width = CONTENT_WIDTH;
    const filled = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0)) * width;
    const y = this.page.y - height;
    this.page.push(`0.92 0.94 0.94 rg ${MARGIN} ${y.toFixed(2)} ${width.toFixed(2)} ${height} re f`);
    if (filled > 0) {
      this.page.push(
        `${colour.r} ${colour.g} ${colour.b} rg ${MARGIN} ${y.toFixed(2)} ${filled.toFixed(2)} ${height} re f`,
      );
    }
    this.page.y -= height + 6;
  }

  /** Serialise to a Blob. */
  toBlob(): Blob {
    const objects: string[] = [];
    const pageCount = this.pages.length;

    // Object numbering: 1 catalog, 2 pages, 3 F1, 4 F2, then per page a page
    // object and its content stream.
    const firstPageObject = 5;
    const pageIds = this.pages.map((_, i) => firstPageObject + i * 2);

    objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
    objects.push(
      `2 0 obj\n<< /Type /Pages /Count ${pageCount} /Kids [${pageIds
        .map((id) => `${id} 0 R`)
        .join(' ')}] >>\nendobj\n`,
    );
    objects.push(
      `3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    );
    objects.push(
      `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`,
    );

    this.pages.forEach((page, index) => {
      const pageId = pageIds[index] as number;
      const streamId = pageId + 1;
      const content = page.content();
      objects.push(
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>\nendobj\n`,
      );
      objects.push(
        `${streamId} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`,
      );
    });

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (const object of objects) {
      offsets.push(pdf.length);
      pdf += object;
    }

    const xrefOffset = pdf.length;
    const count = objects.length + 1;
    pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    // Every byte written above is ASCII (non-ASCII text went out as octal
    // escapes), so a one-byte-per-character conversion is exact and the xref
    // offsets computed from string lengths are correct byte offsets.
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: 'application/pdf' });
  }
}

export { CONTENT_WIDTH, MARGIN, PAGE_HEIGHT, PAGE_WIDTH, widthOf };
