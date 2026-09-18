/**
 * Glyph widths for the two standard fonts the report uses, in 1/1000 em, indexed
 * by character code.
 *
 * These come from the Adobe AFM metrics for Helvetica and Helvetica-Bold. They
 * are here so that word wrapping measures text rather than guessing at it: an
 * estimate of "about 90 characters per line" produces a report whose lines
 * sometimes run off the page, and a thesis appendix is not the place to discover
 * that.
 *
 * Codes outside the table fall back to 556, the width of a digit.
 */

function table(start: number, widths: readonly number[]): Record<number, number> {
  const out: Record<number, number> = {};
  widths.forEach((width, index) => {
    out[start + index] = width;
  });
  return out;
}

/** Helvetica, codes 32–126. */
export const HELVETICA_WIDTHS: Record<number, number> = {
  ...table(32, [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
    1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
    333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
    556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
  ]),
  // The WinAnsi accented letters Albanian needs share the widths of their bases.
  0xeb: 556, // ë
  0xe7: 500, // ç
  0xcb: 667, // Ë
  0xc7: 722, // Ç
  0xb0: 400, // °
  0xb1: 584, // ±
  0xd7: 584, // ×
  0x96: 556, // – (en dash)
};

/** Helvetica-Bold, codes 32–126. */
export const HELVETICA_BOLD_WIDTHS: Record<number, number> = {
  ...table(32, [
    278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
    975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
    667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
    333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
    611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
  ]),
  0xeb: 556,
  0xe7: 556,
  0xcb: 667,
  0xc7: 722,
  0xb0: 400,
  0xb1: 584,
  0xd7: 584,
  0x96: 556,
};
