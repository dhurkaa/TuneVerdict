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

## Hard constraints

These are settled decisions. Do not reopen them without being asked.

1. **Exactly two CSV files as input.** Nothing else. No bundled sample logs, no demo
   data, no seeded sessions. Everything is computed at runtime from what the user
   supplies. The empty state and the error states are therefore first-class UI, not
   afterthoughts.
2. **No backend. No database. No API keys.** Parsing, resampling, segmentation,
   normalisation, DTW alignment, anomaly detection, uncertainty propagation and
   report generation all run in the browser. Files never leave the user's machine —
   this is both a privacy property worth stating in the UI and a deployment
   simplification.
3. **No LLM in the analysis pipeline.** Recommendations come from physical rules with
   experimentally calibrated thresholds plus statistical tests. An LLM would destroy
   reproducibility (same log, different answer tomorrow) and invalidate the
   calibration work, which is the thesis's main scientific contribution. If natural-
   language phrasing of a finished report is ever wanted, it is a cosmetic layer on
   top of an already-produced result, never part of the pipeline.
4. **Static hosting.** Deployed to GitHub Pages via GitHub Actions. The build must
   produce a fully static bundle with a correct base path for a project page.
5. **No magic numbers.** Every threshold and confidence factor lives in one constants
   module with a comment recording its provenance (which experiment, which run count,
   why that value and not the Youden peak). Rules read from there; nothing hardcodes
   a number inline.

---

## Stack

- React + TypeScript + Vite
- No UI framework; styling via CSS custom properties (design tokens, below)
- Charts drawn as inline SVG — no chart library
- CSV parsing: PapaParse
- PDF export: generated client-side
- Tests: Vitest

TypeScript is not optional here. The dangerous bugs in this domain are silent unit
errors (bar vs kPa, °C vs K, km/h vs m/s) and channel misidentification. Model units
and channel identities in the type system.

---

## Architecture

The pipeline, in order:

1. **Import and schema recognition** — accept CSV from Car Scanner, Torque Pro,
   OBDLink, TunerStudio. 200+ channel aliases, English and German, automatic unit
   conversion. Must report honestly what it recognised and what it could not.
2. **Synchronisation and resampling** to 10 Hz.
3. **WOT segment extraction and gear classification** — detect full-throttle pulls.
4. **Condition normalisation** — SAE J1349 / DIN 70020 correction for intake air
   temperature, barometric pressure, gradient, gear. Without this the comparison has
   no scientific value.
5. **Segment pairing via Dynamic Time Warping**, then comparison with bootstrap
   confidence intervals.
6. **Hybrid anomaly detection** — physical rules (knock retard, lean under load,
   boost overshoot and oscillation, IAT heat-soak, fuel rail droop, EGT) combined
   with an outlier model over the residuals.
7. **Explainable recommendation engine** — every recommendation carries: the problem,
   the zone (RPM / load), the evidence (which segments, how many pulls), a confidence
   in 0–1, and the risk if ignored.
8. **Validity Card** — a composite index: Gain × Consistency × Safety.
9. **Uncertainty propagation** — Monte Carlo. Power is linear in the vehicle
   parameters, so keep the four normalised components (inertia, aerodynamic, rolling,
   gradient) and make each draw a matrix multiply.

Nothing is displayed as a bare number. Every value carries its own uncertainty, and
every recommendation carries its own evidence.

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

Reference results to validate any reimplementation against:

- Gain accuracy: bias −2.64 hp, sd 5.50, MAE 4.64. Excluding the two scenarios with a
  known physical limit (heat-soak, overshoot): bias −0.88 hp, sd 4.13.
- Placebo pairs declared significant in only 10% of cases — correct test behaviour.
- AUC: lean 0.996 · knock 0.990 · rail 0.981 · overshoot 0.895 · ripple 0.895.
- Zero false alarms across 1353 negative pulls.
- Petrol example: absolute 253.4 ±9.4 hp (3.7%); gain +36.1 ±4.5 hp (12.5%); common-
  mode error cancellation 2.1×. Mass dominates the budget at 62%, efficiency at 31%.
- Mean confidence after recalibration: 0.712, sitting at the Wilson 95% lower bound
  (0.7225). ECE stays at 0.288 and cannot be reduced without overclaiming: empirical
  accuracy is 1.000, but 10/10 correct only proves accuracy above 0.72.
- For a ±5 hp claim, mass must be known to within 1.44% (±22 kg on 1500 kg) —
  the UI should say so: weigh the car, do not assume its mass.

---

## Design language

Instrument-grade, not racing. The industry works dark because curves read better and
the work happens on a laptop in a workshop — but this is a measuring instrument, so:
no gradients, no glows, no aggressive reds as decoration.

**Colour tokens** — each is a dark/light pair of the same name. Dark is the
application default; light exists because dark screenshots print as a smudge in an A4
thesis.

| token | dark | light |
|---|---|---|
| base | `#0D1012` | `#F5F7F7` |
| panel | `#14181B` | `#FFFFFF` |
| inset | `#1A1F23` | `#EBEFF0` |
| line | `#232A2F` | `#D9DFE1` |
| text | `#ECF1F3` | `#0F1518` |
| muted | `#93A0A8` | `#5A676E` |
| signal / ok | `#5CC8AC` | `#0E8A70` |
| caution | `#E8B04B` | `#9A6706` |
| risk | `#E2574C` | `#BE3A2E` |
| reference ("before") | `#7E8C94` | `#6A777E` |

On light, the primary button background darkens to `#0A6A57` with white text, for
contrast.

**Typography**
- IBM Plex Mono — every number, always. Monospace figures align down a column, which
  for a measuring tool is legibility, not taste.
- IBM Plex Sans — labels and prose.
- Scale: headline figure 76px mono 500 · panel title 17px sans 600 · label 11px sans
  400 with 0.14em tracking, uppercase · body 13px / 1.5.

**Spacing and shape:** 8 / 16 / 24 / 32. Radius 8 control, 12 card, 14 panel. Buttons
are 44px tall, always.

**Chart rules:** "before" is always a dashed grey line; "after" is a solid line in the
signal colour. The confidence interval is a band, never a line. No chart without its
uncertainty.

**Mark:** Δ, drawn as a single triangle outline in the signal colour.

---

## Internationalisation

Albanian and English, switchable at runtime. Albanian is the thesis language, English
is the repository and code language.

All user-facing strings go through the i18n layer from the first component — retrofitting
this is far more painful than doing it from the start. Code, comments, commit messages,
variable names and this document stay in English.

Note that technical terms differ meaningfully in Albanian: *tërheqje* (pull),
*mbipresion* (boost overshoot), *paraprirje* (timing advance), *rampa e karburantit*
(fuel rail), *përzierje e varfër* (lean mixture), *besueshmëria* (confidence),
*pasiguria* (uncertainty), *qëndrueshmëria* (consistency).

---

## Accessibility

Real `<button>`, `<a href>`, `<input>` with `<label>` — never a click handler on a div.
`aria-label` on icon-only buttons. Text contrast 4.5:1 (3:1 above 24px). Charts carry a
descriptive `role="img"` and label, since the curve itself is the information.

---

## Measurement protocol (what the UI should expect and validate)

5 pulls per session · gear 3 or 4 · 2000→5500 rpm · same road and direction ·
ΔT < 3 °C between sessions · fuel above 50% · engine at operating temperature.

The import screen should warn when the two sessions violate these — different gear,
large temperature gap, too few usable pulls — because a comparison across mismatched
conditions is the single most likely way for a user to get a confident wrong answer.

---

## What matters most

The import screen is the most important screen in the application. With no bundled
demo data it is the only thing a new user sees, and it is where everything can fail:
unknown schema, sampling rate too low, a missing key channel, two sessions from
different gears. Its empty state and its error states deserve as much design attention
as the result screen.
