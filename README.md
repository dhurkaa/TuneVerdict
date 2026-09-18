# TuneVerdict

A client-side web application that validates an ECU tuning by comparing two OBD-2
log sessions — before and after — and producing a defensible judgement rather than
a chart.

Bachelor's thesis project, Faculty of Mechanical and Computer Engineering,
University of Mitrovica "Isa Boletini".

---

## The one-sentence framing

Existing tools treat a log as a drawing: they extract the curve and leave the
interpretation to the human. TuneVerdict moves from *visualisation* to *judgement* —
it takes two log sessions, makes them statistically comparable, detects anomalies,
and produces concrete, explainable recommendations with calibrated confidence.

**Research question:** can a reliable assessment of tuning quality be derived
automatically from OBD-2 logs — not only how much power was gained, but whether it
was gained safely and consistently?

**Core principle:** the strongest diagnostic signal is not the absolute value of any
channel, but the difference between what the ECU *requested* and what the engine
*delivered*.

---

## Running it

```bash
npm install
npm run dev
```

```bash
npm test          # 116 tests: units, schema, signal, statistics, pipeline, PDF, i18n
npm run build     # static bundle in dist/
```

The application ships no sample data. To see it do anything you need two CSV logs
of your own — see [the measurement protocol](#measurement-protocol) for what makes
a usable pair. Tests generate synthetic logs from a forward physics model
(`src/core/testing/synthetic.ts`), which is how the estimator can be checked
against a known true answer; that module is never imported by the application.

---

## Hard constraints

These are settled decisions, and the code is built around them.

1. **Exactly two CSV files as input.** No bundled sample logs, no demo data, no
   seeded sessions. Everything is computed at runtime from what the user supplies,
   which makes the empty state and the error states first-class UI.
2. **No backend, no database, no API keys.** Parsing, resampling, segmentation,
   normalisation, DTW alignment, anomaly detection, uncertainty propagation and
   report generation all run in the browser. Files never leave the machine.
3. **No LLM in the analysis pipeline.** Recommendations come from physical rules
   with calibrated thresholds plus statistical tests. Every user-facing sentence is
   a key into the i18n layer, so the same evidence produces the same sentence every
   time — reproducibility the calibration depends on.
4. **Static hosting.** Deployed to GitHub Pages by `.github/workflows/deploy.yml`,
   which sets `BASE_PATH` so a project page resolves its assets.
5. **No magic numbers.** Every threshold and confidence factor lives in
   `src/core/constants.ts` with a comment recording its provenance. Rules read from
   there; nothing hardcodes a number inline.

---

## Stack

React + TypeScript + Vite · PapaParse for CSV · Vitest for tests. No UI framework
(styling is CSS custom properties), no chart library (charts are inline SVG), no
PDF library (`src/report/pdf.ts` writes the PDF itself).

TypeScript is not decoration here. The dangerous bugs in this domain are silent
unit errors (bar vs kPa, °C vs K, km/h vs m/s) and channel misidentification, so
units and channel identities are modelled in the type system: conversion happens
exactly once, at the import boundary, and everything downstream works in the
canonical unit of its quantity.

---

## Architecture

The pipeline, in order, one module per stage:

| stage | module | what it does |
|---|---|---|
| 1 | `core/import.ts` | CSV parsing, schema recognition, unit conversion, derivation |
| 2 | `core/signal.ts` | resampling to 10 Hz, smoothing, differentiation |
| 3 | `core/segment.ts` | WOT segment extraction, gear classification |
| 4 | `core/normalise.ts` | SAE J1349 / DIN 70020 atmospheric correction |
| 5 | `core/dtw.ts` | segment pairing by Dynamic Time Warping |
| 6 | `core/detect.ts` | physical rules plus a residual outlier model |
| 7 | `core/recommend.ts` | findings → explainable recommendations |
| 8 | `core/validity.ts` | the composite index |
| 9 | `core/uncertainty.ts` | Monte Carlo propagation |
| — | `core/pipeline.ts` | the order they run in, and nothing else |

`core/channels.ts` holds 230 header aliases across Car Scanner, Torque Pro, OBDLink
and TunerStudio, English and German, each declaring the unit its values should be
read as.

Nothing is displayed as a bare number: `Estimate` carries a value, a standard
deviation and an interval, and the `Figure` component has no variant that prints
one without the other. Nothing is asserted without evidence: every `Finding`
carries which pulls it appeared in, how many samples crossed the threshold, which
channel it read, whether that channel was measured or derived, and a confidence
whose every adjustment is recorded for display.

### Reproducibility

The bootstrap and the Monte Carlo never touch `Math.random`. The seed is derived
from the input files themselves (`seedFrom`) and reported with the result, so the
same two logs produce byte-identical output on a later run. There is a test for it.

---

## Calibrated constants

Carried over from the validated Python implementation (80 runs / 847 pulls, then a
closed loop of 64 further runs with fresh seeds). Thresholds were **not** taken from
the Youden peak — that produced physically meaningless values, e.g. 0.042° for knock
detection, which is noise on a real road. They were taken from the upper bound of the
interval where recall and specificity both remain optimal.

| detector | threshold | recall | false alarms |
|---|---|---|---|
| knock | 0.70 | 0.98 | 0.00 |
| lean mixture | 0.910 | 0.97 | 0.00 |
| boost overshoot | 0.080 | 0.86 | 0.00 |
| boost oscillation | 0.045 | 0.86 | 0.00 |
| fuel rail droop | 0.025 | 0.97 | 0.00 |

Confidence is capped at **0.7225**, the Wilson 95% lower bound for ten correct
answers out of ten. The detectors were empirically perfect on the validation set,
but ten of ten only proves accuracy above that bound, so nothing may report more.
This keeps the expected calibration error at 0.288; that number is shown in the UI
rather than hidden.

### What this implementation reproduces, and what it does not

The thesis records reference results from the Python implementation. This port was
checked against the ones that can be reproduced without the original 847-pull
dataset, using synthetic logs with a known true answer:

| reference result | status here |
|---|---|
| Uncertainty budget: mass 62%, efficiency 31% | reproduced — 61% / 33% with an estimated mass (`pipeline.test.ts`) |
| Placebo pairs not declared significant | reproduced — the permutation test returns p > 0.05 on same-tune pairs |
| Zero false alarms on healthy pulls | reproduced on synthetic clean sessions; the 1353-pull negative set is not available here |
| Confidence ceiling 0.7225 from 10/10 | reproduced from first principles — `wilsonLowerBound(10, 10)` is asserted against the constant |
| Common-mode cancellation 2.1× | direction reproduced, magnitude differs: defined here as `sd(absolute) / sd(difference)`, which lands at 3–7× depending on whether the car was weighed |
| Gain accuracy: bias −2.64 hp, sd 5.50 | **not independently verified.** On synthetic logs this implementation recovers peak power to within a few percent and under-reads the gain by a few hp — the same direction and order of magnitude, but a different dataset and so not the same measurement |
| AUC figures per detector | **not verified** — reproducing them needs the labelled calibration set |

The thresholds themselves are ported as declared values. Re-deriving them requires
the original logs; if those become available, `src/core/constants.ts` is the only
file that changes.

Two known biases, both documented in the code rather than corrected away:

- Peak power read from a noisy curve is biased upward, so the session curve is
  smoothed over ±100 rpm before its peak is taken (`CURVE_SMOOTH_HALF_WINDOW`).
- Acceleration comes from a local quadratic fit, so the first and last five samples
  of a pull are discarded — within one window of the segment boundary the fit is
  still reading the coast before the throttle opened, which otherwise produces
  *negative* power at the bottom of the sweep (`PULL_EDGE_TRIM_SAMPLES`).

---

## Measurement protocol

5 pulls per session · gear 3 or 4 · 2000→5500 rpm · same road and direction ·
ΔT < 3 °C between sessions · fuel above 50% · engine at operating temperature.

`core/protocol.ts` checks all of it and reports violations beside the verdict, not
after it: a comparison across mismatched conditions is the single most likely way
for a user to get a confident wrong answer, and the failure is invisible in the
result — the numbers look exactly as convincing as real ones.

Mass deserves its own warning, which the UI gives: for a ±5 hp claim the car's mass
must be known to within 1.44%, which is ±22 kg on 1500 kg. Weigh the car; do not
assume it.

---

## Design language

Instrument-grade, not racing: no gradients, no glows, no aggressive reds as
decoration. Red means a risk finding and nothing else, which is what makes it worth
noticing.

Colour tokens are dark/light pairs of the same name (`src/styles/tokens.css`). Dark
is the default because curves read better on it and the work happens on a laptop in
a workshop; light exists because dark screenshots print as a smudge in an A4 thesis.
IBM Plex Mono for every number, IBM Plex Sans for prose. Spacing 8/16/24/32, radius
8/12/14, buttons 44px tall.

Chart rules: "before" is always a dashed grey line, "after" a solid line in the
signal colour, the confidence interval is a band and never a pair of lines, and no
chart is drawn without its uncertainty. Curves are drawn only where pulls from both
sessions actually reached.

Accessibility: real `<button>`, `<a href>` and `<input>` with `<label>` throughout —
never a click handler on a div. Charts carry `role="img"` and a description, because
the curve itself is the information.

---

## Internationalisation

Albanian and English, switchable at runtime. Albanian is the thesis language;
English is the repository and code language. Every user-facing string goes through
`src/i18n` from the first component.

Albanian is typed as a complete map over the English keys, so the build fails if a
string exists in one language and not the other. `i18n.test.ts` additionally checks
that placeholders match between languages, that no entry is silently left in
English, and that the agreed technical vocabulary is used: *tërheqje* (pull),
*mbipresion* (boost overshoot), *paraprirje* (timing advance), *rampa e karburantit*
(fuel rail), *përzierje e varfër* (lean mixture), *besueshmëria* (confidence),
*pasiguria* (uncertainty), *qëndrueshmëria* (consistency).

Errors are stored as a key plus substitutions and translated at render time, so
switching language re-renders a completed analysis instead of discarding it.

---

## Deployment

Push to `main`. The workflow typechecks, runs the tests, builds with the correct
base path and publishes to GitHub Pages. Enable Pages for the repository with
"GitHub Actions" as the source; no other configuration is needed.

---

## Project structure

```
src/
  core/            the pipeline — no React, no DOM, fully testable
    constants.ts   every threshold, with its provenance
    channels.ts    230 header aliases, EN/DE, with units
    units.ts       unit conversion, done once, at the boundary
    testing/       synthetic log generator (tests only)
  components/      React components, no framework
  i18n/            Albanian and English
  report/          the hand-written PDF writer
  styles/          design tokens and the shared vocabulary
```
