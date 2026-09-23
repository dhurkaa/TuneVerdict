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
npm test          # 203 tests: units, schema, signal, statistics, pipeline, torque, corrections, Autotuner logs, ECU torque, PDF, i18n, AI endpoint
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

### The result screen

One screen, read like a dyno sheet: the verdict and the key figures across the top
(power and torque before → after, gain, safety), **one chart with torque (N·m, left
axis) and power (PS / hp / kW, right axis)** — before dashed, after solid with its
95% band, peaks marked, a hover or arrow-key readout at any rpm, and the
"608 Nm @ 3000 · 294 PS @ 4000 rpm" lines underneath — with the key points beside
it and everything else in tabs. Peak torque has its own Monte Carlo interval: it is
not peak power scaled, because it sits at a different rpm. The same chart is drawn
into the PDF report.

After the verdict, five deterministic stages turn it into something a tuner can
act on:

| module | what it does |
|---|---|
| `core/bands.ts` | splits the rpm range into proven gain, proven loss and not proven — a peak figure hides a low-end loss |
| `core/tracking.ts` | requested vs delivered for boost, λ, rail pressure and (reconstructed) ignition advance — the core principle, made visible |
| `core/corrections.ts` | places findings into rpm × manifold-pressure cells and sizes a change per cell from the evidence |
| `core/margins.ts` | distance to each detector threshold per zone, using exactly the series the detectors read |
| `core/loggingAdvice.ts` | what the next recording should include, and what its absence cost this one |

The correction table obeys one rule without exception: **every suggestion moves
toward safety** — less advance, more fuel, less boost — **and none toward power**.
A log can prove that a cell did harm; it cannot prove that a cell has headroom.
There is a test that fails if the table ever suggests otherwise.

`core/channels.ts` holds 230 header aliases across Car Scanner, Torque Pro, OBDLink
and TunerStudio, English and German, each declaring the unit its values should be
read as.

Nothing is displayed as a bare number: `Estimate` carries a value, a standard
deviation and an interval, and the `Figure` component has no variant that prints
one without the other. Nothing is asserted without evidence: every `Finding`
carries which pulls it appeared in, how many samples crossed the threshold, which
channel it read, whether that channel was measured or derived, and a confidence
whose every adjustment is recorded for display.

### Car health check

Below the chart, `core/health.ts` grades five systems of the car — turbo & boost,
fuel system, combustion, temperatures and torque delivery — as good, watch,
concern or not logged, on both logs, from fixed thresholds (`HEALTH_*` in
`constants.ts`), the detector findings and requested-vs-delivered tracking. Each
system shows the measured values behind its status, and a 0–100 score summarises
the systems the log could judge.

When the AI is configured, the **AI mechanic** reads that check (mode `health` of
`/api/explain`, instruction fixed on the server) and answers in JSON: a note under
each system on what the values mean for the car and their likely causes, an
overall condition, and a workshop checklist. It explains the statuses; it never
sets them, and the panel says so.

### Reproducibility

The bootstrap and the Monte Carlo never touch `Math.random`. The seed is derived
from the input files themselves (`seedFrom`) and reported with the result, so the
same two logs produce byte-identical output on a later run. There is a test for it.

### AI explanation (operator-provided)

Every comparison gets an automatic **"Key messages"** summary under the verdict,
and the result screen ends with an **"Ask about this result"** panel for follow-up
questions. The summary is included in the PDF under its own heading, marked as not
part of the verdict. Customers need no account and no key, and see no settings.

**The key is the operator's and it lives on the server, never in the browser.**
The analysis still runs entirely client-side; the only server code is one function,
`api/explain.ts` (logic in `server/explain.ts`), that holds the key, adds the fixed
instructions and relays the answer. A key in the front-end bundle would be
published to every visitor — anyone could copy it from the browser's developer
tools and spend it.

| where | how to set the key |
|---|---|
| local development | copy `.env.example` to `.env.local` and set `OPENAI_API_KEY=sk-...`; `npm run dev` serves `/api/explain` itself |
| Vercel | Project → Settings → Environment Variables → `OPENAI_API_KEY` (optionally `OPENAI_MODEL`, default `gpt-5.5`) |

Never prefix the variable with `VITE_`: Vite copies `VITE_*` variables into the
browser bundle. `ANTHROPIC_API_KEY` works as an alternative provider when no
OpenAI key is set. Without any key the AI panels simply do not appear.

The AI is the phrasing layer CLAUDE.md allows on top of a finished report, and it
cannot become part of the pipeline:

- It runs only after the analysis is complete and receives the finished summary
  (numbers, findings, suggested changes, already translated) — never the CSV files.
  Nothing it returns feeds back into any number, finding or verdict.
- The instructions are set by the server, not the page: the model is told the
  analysis is final, to work only from the correction table, never to suggest more
  advance, more boost or a leaner mixture, and to decline unrelated requests.

**Cost and abuse.** The operator pays for every request, so the endpoint accepts
only what the application sends: the context must parse as a TuneVerdict result,
the summary uses a fixed instruction, questions are size-limited, answers are
capped at 4000 tokens, and each client address gets 30 requests per 10 minutes
(per server instance). A public endpoint without user accounts cannot be made
abuse-proof, so **set a monthly spending limit in the OpenAI dashboard.**

This is a deliberate, narrow exception to constraint 2 (no backend, no API keys):
the analysis has no backend and needs no key; only the optional AI does.

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

5 pulls per session · gear 3 or 4 · 2000→5500 rpm (diesel: 1500→4500) · same road and direction ·
ΔT < 3 °C between sessions · fuel above 50% · engine at operating temperature.

`core/protocol.ts` checks all of it and reports violations beside the verdict, not
after it: a comparison across mismatched conditions is the single most likely way
for a user to get a confident wrong answer, and the failure is invisible in the
result — the numbers look exactly as convincing as real ones.

### Logger logs (Autotuner, Bosch EDC and similar)

Logs written by ECU flashing tools import directly: millisecond timestamps are
detected from the median step, "Boost pressure" that is really absolute manifold
pressure (mbar) is detected from its closed-pedal reading and converted to gauge,
rail pressure in bar and the logged gear are recognised. A run through several
gears is split at the gear changes and the gear both sessions share is compared.

A single pull per session is accepted, but the verdict then uses an *assumed*
3% pull-to-pull scatter (`PRIOR_PULL_CV`) instead of a measured one, and says so.
When both logs carry the ECU's own calculated torque, **that is the primary
basis of the result**: the headline, the chart and the report lead with the ECU's
full-load curve, built from every settled high-pedal sample in every gear (the
kick-down ramp and the half-second overshoot after it are left out; part-pedal
samples on the torque limiter are kept — a turbo-diesel reaches it well before the
pedal is floored — and neighbouring rpm bins are averaged 1-2-1). Power is torque ×
rpm at the crank, the figure the manufacturer quotes. On the reference Mercedes
220d (OM654) stock log this gives 387 Nm @ 3400 / 192 PS against the factory
400 Nm (held to 2800 rpm, below what the log covers) / 194 PS.

The chart fits both axes to the data, with shared gridlines, and draws each curve
as a monotone cubic through the points: smooth, but never above or below a
logged value. The PDF draws the same curves.
The power measured from acceleration stays beside it as a cross-check; when it
disagrees with the ECU on the stock log by more than 10%, the vehicle model is
off for that log and the result says so.

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

**Vercel (recommended — required for the AI).** Import the repository in Vercel; it
detects Vite, builds `dist/` and deploys `api/explain.ts` as a serverless function.
Set `OPENAI_API_KEY` under Environment Variables and redeploy.

**GitHub Pages.** Pushing to `main` also typechecks, tests, builds with the correct
base path and publishes to Pages. Pages serves static files only, so the AI panels
do not appear there; everything else works.

---

## Project structure

```
api/explain.ts     Vercel function: the AI endpoint (holds the key)
server/            its logic and the provider calls, shared with the dev server
src/
  ai/              the AI client (talks to /api/explain only) and the prompts
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
