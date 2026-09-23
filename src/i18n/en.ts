/**
 * English strings.
 *
 * English is the repository and code language; Albanian is the thesis language.
 * Every user-facing string in the application goes through this layer from the
 * first component — retrofitting i18n is far more painful than doing it from the
 * start, and a half-translated interface is worse than an untranslated one.
 *
 * `{name}` placeholders are substituted by the `t` function.
 */

export const en = {
  // --- shell -------------------------------------------------------------
  'app.title': 'TuneVerdict',
  'app.tagline': 'Judgement, not a chart.',
  'app.lead':
    'Compare two OBD-2 log sessions — before and after a tune — and get a defensible assessment: how much was gained, whether it was gained safely, and how certain any of it is.',
  'app.privacy': 'Everything runs in your browser. Your logs never leave this machine.',
  'app.theme.toDark': 'Switch to dark theme',
  'app.theme.toLight': 'Switch to light theme',
  'app.language': 'Language',
  'app.thesis':
    'Bachelor’s thesis · Faculty of Mechanical and Computer Engineering · University of Mitrovica "Isa Boletini"',

  'common.before': 'Before',
  'common.after': 'After',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.none': 'None',
  'common.session': 'Session',
  'common.back': 'Back to import',
  'common.of': 'of',
  'common.showDetails': 'Show details',
  'common.hideDetails': 'Hide details',

  // --- import screen -----------------------------------------------------
  'import.title': 'Two sessions',
  'import.lead':
    'One CSV from before the tune, one from after. Recorded on the same road, in the same gear, in the same conditions.',
  'import.drop.before': 'Before the tune',
  'import.drop.after': 'After the tune',
  'import.drop.hint': 'Drop a CSV here, or choose a file',
  'import.drop.browse': 'Choose file',
  'import.drop.replace': 'Replace',
  'import.drop.remove': 'Remove',
  'import.drop.reading': 'Reading…',

  'import.file.format': 'Recognised as',
  'import.file.rows': 'Rows',
  'import.file.rate': 'Sample rate',
  'import.file.duration': 'Duration',
  'import.file.channels': 'Channels found',

  'import.schema.title': 'What was recognised',
  'import.schema.recognised': 'Recognised channels',
  'import.schema.unrecognised': 'Not recognised',
  'import.schema.unrecognisedHint': 'These columns were left out of the analysis. Nothing was guessed from them.',
  'import.schema.derived': 'Computed from other channels',
  'import.schema.assumed': 'Assumed',
  'import.schema.missingRecommended': 'Missing, and worth having',
  'import.schema.missingHint':
    'The analysis will run without these, but each one that is missing removes a class of findings.',
  'import.schema.dropped': '{count} samples dropped as out of range',
  'import.schema.derivedFrom': 'from {channels}',
  'import.assumed.baroSeaLevel':
    'No barometric channel: sea-level pressure assumed. This is carried as an uncertainty, not hidden.',

  'import.vehicle.title': 'The car',
  'import.vehicle.lead':
    'Power is inferred from how fast the car accelerated, so these describe what was being accelerated. Mass is the one that matters most.',
  'import.vehicle.mass': 'Mass, including driver and fuel',
  'import.vehicle.massHint':
    'Mass is 62% of the uncertainty budget. For a ±5 hp claim it must be known to 1.44% — that is ±22 kg on 1500 kg. Weigh the car; do not assume it.',
  'import.vehicle.massWeighed': 'This mass was measured, not estimated',
  'import.vehicle.dragArea': 'Drag area (Cd·A)',
  'import.vehicle.rolling': 'Rolling resistance',
  'import.vehicle.efficiency': 'Drivetrain efficiency',
  'import.vehicle.inertia': 'Rotational inertia factor',
  'import.vehicle.fuel': 'Fuel',
  'import.vehicle.fuelHint':
    'Decides how a logged air-fuel ratio becomes λ. On E85 the same AFR number means something entirely different.',
  'import.vehicle.standard': 'Correction standard',
  'import.vehicle.standardHint':
    'SAE J1349 references dry air at 990 hPa and 25 °C; DIN 70020 references 1013 hPa and 20 °C and gives the larger numbers.',
  'import.fuel.gasoline': 'Petrol',
  'import.fuel.diesel': 'Diesel',
  'import.fuel.e85': 'E85',
  'import.fuel.lpg': 'LPG',

  'import.analyse': 'Analyse',
  'import.analysing': 'Analysing…',
  'import.waitingBoth': 'Both sessions are needed before anything can be compared.',

  'import.empty.title': 'Nothing is loaded yet',
  'import.empty.body':
    'This application ships no sample data. Everything you see will be computed from the two files you supply, in this browser.',
  'import.empty.protocol': 'What a usable pair of logs looks like',
  'protocol.rule.pulls': '5 full-throttle pulls per session',
  'protocol.rule.gear': 'Third or fourth gear, the same in both sessions',
  'protocol.rule.rpm': '2000 → 5500 rpm (diesel: 1500 → 4500), one continuous sweep',
  'protocol.rule.road': 'The same road, in the same direction',
  'protocol.rule.temp': 'Intake air temperature within 3 °C between sessions',
  'protocol.rule.fuel': 'Fuel above half a tank',
  'protocol.rule.warm': 'Engine at operating temperature',
  'protocol.rule.rate': 'Logged at 10 Hz where the tool allows it',

  // --- errors ------------------------------------------------------------
  'import.error.title': 'This file could not be used',
  'import.error.empty': '{label} contains no rows that look like log data.',
  'import.error.tooFewRows': '{label} has only {rows} data rows — too few to analyse.',
  'import.error.noTime':
    '{label} has no usable time column. Every row needs a timestamp, or the samples cannot be placed on a common time base.',
  'import.error.sampleRate':
    '{label} was logged at {rate} Hz. Below {minimum} Hz the transients this application looks for cannot be recovered, and interpolating up to 10 Hz would invent them.',
  'import.error.missingRequired': '{label} is missing a channel the analysis cannot run without: {channels}.',
  'import.error.read': 'The file could not be read.',
  'analysis.error.tooFewPulls':
    'No usable full-throttle pull was found in {session}. {rejected} candidate stretches were rejected — too short, crossing a gear change, or with engine speed falling. Log at least one full-throttle pull held in one gear for 500 rpm or more.',

  // --- channels ----------------------------------------------------------
  'channel.time': 'Time',
  'channel.rpm': 'Engine speed',
  'channel.speed': 'Vehicle speed',
  'channel.throttle': 'Throttle position',
  'channel.pedal': 'Accelerator pedal',
  'channel.engineLoad': 'Engine load',
  'channel.map': 'Manifold pressure',
  'channel.boost': 'Boost pressure',
  'channel.boostTarget': 'Boost target',
  'channel.baro': 'Barometric pressure',
  'channel.iat': 'Intake air temperature',
  'channel.coolant': 'Coolant temperature',
  'channel.ambient': 'Ambient temperature',
  'channel.oilTemp': 'Oil temperature',
  'channel.egt': 'Exhaust gas temperature',
  'channel.lambda': 'Lambda',
  'channel.lambdaTarget': 'Lambda target',
  'channel.shortTrim': 'Short term fuel trim',
  'channel.longTrim': 'Long term fuel trim',
  'channel.timing': 'Timing advance',
  'channel.knockRetard': 'Knock retard',
  'channel.fuelRail': 'Fuel rail pressure',
  'channel.fuelRailTarget': 'Fuel rail target',
  'channel.maf': 'Mass air flow',
  'channel.gear': 'Gear',
  'channel.fuelLevel': 'Fuel level',
  'channel.battery': 'Battery voltage',
  'channel.injectorDuty': 'Injector duty cycle',

  'requirement.required': 'Required',
  'requirement.recommended': 'Recommended',
  'requirement.optional': 'Optional',
  'provenance.measured': 'Measured',
  'provenance.derived': 'Derived',
  'provenance.assumed': 'Assumed',
  'provenance.missing': 'Missing',

  // --- segmentation ------------------------------------------------------
  'segment.rejected.tooShort': 'too short',
  'segment.rejected.rpmSpan': 'too little rpm covered',
  'segment.rejected.rpmFalling': 'engine speed fell during the pull',
  'segment.rejected.noGearRatio': 'gear could not be determined',
  'segment.rejected.tooFewSamples': 'too few valid samples',

  // --- protocol violations ----------------------------------------------
  'protocol.title': 'Protocol',
  'protocol.none': 'Both sessions follow the measurement protocol.',
  'protocol.lead':
    'A comparison across mismatched conditions is the most likely way to get a confident wrong answer, so the conditions are checked before the verdict is read.',
  'protocol.fewerPullsThanProtocol':
    '{session}: {found} usable pulls, where the protocol asks for {expected}. The interval will be wider than it needs to be.',
  'protocol.lowSampleRate':
    '{session} was logged at {rate} Hz, below the {target} Hz the transient detectors want. Gain estimates stay valid; boost overshoot and oscillation lose recall.',
  'protocol.mixedGears':
    '{session} contains pulls in more than one gear ({gears}). Those are not five comparable measurements.',
  'protocol.engineCold':
    '{session}: median coolant temperature {coolant} °C, below the {minimum} °C the protocol asks for.',
  'protocol.lowFuel':
    '{session}: fuel at {level}%, below the {minimum}% the protocol asks for. Fuel mass becomes a hidden variable.',
  'protocol.correctionOutOfBand':
    '{session}: {pulls} of {total} pulls needed an atmospheric correction outside the band SAE J1349 declares valid. The conditions were too far apart to reconcile by correction alone.',
  'protocol.rpmCoverageHigh':
    '{session} only reached {reached} rpm, short of {expected}. Nothing is claimed above the rpm the pulls actually covered.',
  'protocol.rpmCoverageLow': '{session} started at {started} rpm, above the {expected} the protocol asks for.',
  'protocol.gearMismatch':
    'The two sessions were driven in different gears ({before} and {after}). This is the single most likely way to get a confident wrong answer, and the comparison should not be trusted.',
  'protocol.iatMismatch':
    'Intake air temperature differs by {delta} °C between sessions ({before} °C and {after} °C), where the protocol allows {maximum} °C. Beyond this the correction is doing more work than the tune is.',
  'protocol.ratioMismatch':
    'The rpm-to-speed ratio differs by {delta}% between sessions although the gear matches — different tyres, or a different final drive.',

  // --- result: headline --------------------------------------------------
  'result.title': 'Verdict',
  'result.verdict.good': 'Gain proven, no safety findings',
  'result.verdict.mixed': 'Gain proven, with reservations',
  'result.verdict.bad': 'Not defensible',
  'result.verdict.inconclusive': 'No proven difference',
  'result.verdict.goodBody':
    'The difference between the two sessions is larger than the measurement noise, the pulls agree with each other, and no safety rule fired.',
  'result.verdict.mixedBody':
    'There is a real gain, but something in the data argues against leaving the tune as it is. The findings below say what.',
  'result.verdict.badBody':
    'The evidence does not support this tune as it stands. Read the findings before driving it.',
  'result.verdict.inconclusiveBody':
    'The difference between the two sessions is not distinguishable from the scatter between pulls. That is a statement about the evidence, not about the tune: nothing here proves it did nothing.',

  'result.gain': 'Gain',
  'result.gainPercent': 'Relative gain',
  'result.peakBefore': 'Peak, before',
  'result.peakAfter': 'Peak, after',
  'result.significant': 'Statistically significant',
  'result.notSignificant': 'Not statistically significant',
  'result.pValue': 'p = {value}',
  'result.interval': '95% interval {lo} to {hi}',
  'result.plusMinus': '± {sd}',

  // --- result: validity card --------------------------------------------
  'result.validity.title': 'Validity',
  'result.validity.formula': 'Gain × Consistency × Safety',
  'result.validity.lead':
    'Multiplicative on purpose. A sum would let a large gain buy off a dangerous one; a product cannot be talked round.',
  'result.validity.gain': 'Gain',
  'result.validity.consistency': 'Consistency',
  'result.validity.safety': 'Safety',
  'result.validity.index': 'Index',
  'result.validity.gainHint': 'Zero unless the gain is larger than the noise.',
  'result.validity.consistencyHint': 'How closely the pulls of the after session agree.',
  'result.validity.safetyHint': 'One, minus what each finding takes away, weighted by its confidence.',

  // --- result: chart -----------------------------------------------------
  'result.chart.title': 'Power against engine speed',
  'result.chart.description':
    'Two power curves plotted against engine speed. The before session is a dashed grey line, the after session a solid line in the signal colour, each inside a shaded band showing its 95% interval. Peak before {before} hp, peak after {after} hp.',
  'result.chart.before': 'Before (dashed)',
  'result.chart.after': 'After',
  'result.chart.band': '95% interval',
  'result.chart.rpm': 'rpm',
  'result.chart.power': 'hp',
  'result.chart.deltaTitle': 'Difference, with its interval',
  'result.chart.deltaDescription':
    'The difference between the two sessions across the rpm range, with a shaded 95% interval. Where the band crosses zero, no gain is proven at that engine speed.',
  'result.chart.zero': 'No difference',
  'result.chart.coverage': 'Drawn only where pulls from both sessions actually reached.',

  // --- result: findings --------------------------------------------------
  'result.findings.title': 'Findings and what to do about them',
  'result.findings.none':
    'No rule fired and no pull behaved unlike its siblings. That is not a certificate of health — it is the absence of evidence of harm in the channels this log contained.',
  'result.findings.zone': '{low}–{high} rpm',
  'result.findings.action': 'What to do',
  'result.findings.risk': 'If ignored',
  'result.findings.evidence': 'Evidence',
  'result.findings.confidence': 'Confidence',
  'result.findings.pulls': 'Seen in {count} of {total} pulls',
  'result.findings.samples': '{exceeding} of {total} samples in this zone crossed the threshold',
  'result.findings.peak': 'Worst value {peak}, threshold {threshold}',
  'result.findings.channel': 'Channel: {channel} ({provenance})',
  'result.findings.whyConfidence': 'How this confidence was reached',
  'result.findings.inSession': 'In the {session} session',

  'finding.knock': 'Knock retard',
  'finding.lean': 'Lean mixture under load',
  'finding.boostOvershoot': 'Boost overshoot',
  'finding.boostOscillation': 'Boost oscillation',
  'finding.fuelRailDroop': 'Fuel rail pressure droop',
  'finding.iatHeatSoak': 'Intake heat-soak',
  'finding.egt': 'Exhaust gas temperature',
  'finding.residualOutlier': 'Pull unlike its siblings',

  'advice.knock.action':
    'Reduce ignition advance in this zone, or raise the fuel octane. Check that the knock sensor reading is genuine before changing anything else.',
  'advice.knock.risk':
    'Sustained detonation destroys pistons and ring lands. This is the one finding that should stop the car being driven hard until it is resolved.',
  'advice.lean.action':
    'Add fuel in this zone until λ returns to the 0.78–0.85 a loaded engine wants. Check fuel pressure and injector capacity before assuming the map is wrong.',
  'advice.lean.risk':
    'A lean mixture at full load raises combustion temperature exactly where there is no margin left, and leads to detonation and melted pistons.',
  'advice.boostOvershoot.action':
    'Slow the wastegate or boost controller response, or lower the duty ramp, so that pressure arrives at target rather than past it.',
  'advice.boostOvershoot.risk':
    'Repeated overshoot loads the turbocharger and the head gasket beyond what the tune declares, and can trip the ECU into a boost-cut fault.',
  'advice.boostOscillation.action':
    'Retune the boost controller: reduce gain, or check for a leaking hose or a sticking wastegate actuator.',
  'advice.boostOscillation.risk':
    'Hunting pressure makes the fuelling and timing tables chase a moving target, so neither is ever right for long.',
  'advice.fuelRailDroop.action':
    'Check the pump, the filter and the injector duty at the top of the rev range. The fuel system is running out of capacity before the engine does.',
  'advice.fuelRailDroop.risk':
    'Falling rail pressure leans the mixture exactly where the load is highest, which is the same failure as a lean map with a different cause.',
  'advice.iatHeatSoak.action':
    'Let the car cool between pulls, or improve the charge cooling. Repeat the session with a longer gap between pulls.',
  'advice.iatHeatSoak.risk':
    'Later pulls are effectively a different engine from earlier ones, so the session averages two states and the comparison is compromised.',
  'advice.egt.action':
    'Check the fuelling and timing in this zone, and confirm the sensor is reading correctly before acting on it.',
  'advice.egt.risk':
    'Sustained high exhaust temperature damages the turbine and the valves. This detector is outside the calibrated set, so treat it as a prompt to look, not as a measurement.',
  'advice.residualOutlier.action':
    'Look at this pull on its own. Something changed — traffic, gradient, a gear change, a sensor dropout — and it is diluting the session average.',
  'advice.residualOutlier.risk':
    'One unlike pull widens every interval in this report and can shift the headline figure without being visible in it.',

  'confidence.base': 'Starting point for a detector that fired',
  'confidence.agreeingPulls': 'It happened in more than one pull',
  'confidence.margin': 'The value is well past the threshold, not just over it',
  'confidence.derivedChannel': 'The channel was computed, not measured',
  'confidence.uncalibratedDetector': 'This detector is outside the calibrated set',
  'confidence.lowSampleRate': 'The log is slower than 10 Hz',
  'confidence.outOfBandCorrection': 'The atmospheric correction left its valid band',
  'confidence.wilsonCap': 'Capped: ten correct answers out of ten prove accuracy above 0.72, not above 1.00',

  // --- result: uncertainty ----------------------------------------------
  'result.uncertainty.title': 'Where the uncertainty comes from',
  'result.uncertainty.lead':
    'Power is inferred from acceleration, so every error in the car’s description becomes an error in the answer. This is which one, and by how much.',
  'result.uncertainty.budget': 'Share of the variance',
  'result.uncertainty.cancellationTitle': 'Common-mode cancellation',
  'result.uncertainty.seedTitle': 'Reproducibility',
  'result.uncertainty.component.mass': 'Mass',
  'result.uncertainty.component.dragArea': 'Drag area',
  'result.uncertainty.component.rollingResistance': 'Rolling resistance',
  'result.uncertainty.component.efficiency': 'Drivetrain efficiency',
  'result.uncertainty.component.inertia': 'Rotational inertia',
  'result.uncertainty.massAdvice':
    'Mass leads the budget. For a ±5 hp claim it must be known to within 1.44% — ±22 kg on 1500 kg. Weigh the car; do not assume its mass.',
  'result.uncertainty.cancellation':
    'The difference is {factor}× better determined than either absolute figure, because both sessions are the same car on the same road and the shared errors cancel in the subtraction.',
  'result.uncertainty.ece':
    'Confidence values carry an expected calibration error of {ece} and are capped at {cap}. The detectors were right every time on the validation set, but ten out of ten is only evidence of accuracy above 0.72 — reporting more than that would be overclaiming.',
  'result.uncertainty.seed': 'Seed {seed} · computed {when}',
  'result.uncertainty.reproducible':
    'The random source is seeded from the input, so this same pair of files produces this same result every time.',

  // --- result: sessions --------------------------------------------------
  'result.sessions.title': 'The two sessions',
  'result.sessions.pullsAccepted': 'Pulls used',
  'result.sessions.pullsRejected': 'Pulls rejected',
  'result.sessions.gear': 'Gear',
  'result.sessions.gearRelative':
    'Relative label. The log carried no gear channel, so gears were recovered by clustering rpm against speed: this says both sessions used the same gear, not which one.',
  'result.sessions.iat': 'Mean intake air temperature',
  'result.sessions.iatRise': 'Intake temperature rise',
  'result.sessions.correction': 'Mean correction factor',
  'result.sessions.cv': 'Pull-to-pull variation',
  'result.sessions.rate': 'Source sample rate',
  'result.sessions.peak': 'Peak power',
  'result.pulls.title': 'Pulls',
  'result.pulls.index': '#',
  'result.pulls.window': 'Window',
  'result.pulls.rpm': 'rpm span',
  'result.pulls.iat': 'IAT',
  'result.pulls.correction': 'Correction',
  'result.pulls.status': 'Status',
  'result.pulls.used': 'used',
  'result.pulls.rejectedBecause': 'rejected: {reason}',
  'result.pairing.title': 'Pull pairing',
  'result.pairing.lead':
    'Each before-pull matched to its closest after-pull by Dynamic Time Warping, so that findings can be reported against a specific counterpart rather than against an average.',
  'result.pairing.pair': 'before #{before} ↔ after #{after}',
  'result.pairing.distance': 'distance {distance}',

  // --- result: gain across the band --------------------------------------
  'result.bands.title': 'Across the rpm range',
  'result.bands.average': 'Average difference across the compared range',
  'result.bands.kind.gain': 'gain',
  'result.bands.kind.loss': 'loss',
  'result.bands.kind.unproven': 'not proven',
  'result.bands.band': '{low}–{high} rpm',
  'result.bands.mean': '{delta} {unit} on average',
  'result.bands.lossWarning':
    'The tune loses power somewhere in the range. The peak figure hides this — check whether it is where the car is actually driven.',

  // --- result: requested vs delivered -------------------------------------
  'result.tracking.title': 'Requested vs delivered',
  'result.tracking.lead':
    'What the ECU asked for against what the engine delivered. A value is neither good nor bad on its own; a value short of its request says exactly where the tune and the hardware disagree.',
  'result.tracking.none':
    'Neither log carried a target channel (boost target, λ target, rail pressure target, or knock retard with timing), so there is nothing to compare. See "What to log next time".',
  'result.tracking.requested': 'Requested (dashed)',
  'result.tracking.delivered': 'Delivered',
  'result.tracking.band': 'Spread across pulls',
  'result.tracking.quantity.boost': 'Boost pressure',
  'result.tracking.quantity.lambda': 'Lambda',
  'result.tracking.quantity.fuelRail': 'Fuel rail pressure',
  'result.tracking.quantity.timing': 'Ignition advance',
  'result.tracking.hint.boost': 'Short of the request once spooled means the turbocharger cannot reach the target.',
  'result.tracking.hint.lambda': 'Above the request means leaner than the map asked for.',
  'result.tracking.hint.fuelRail': 'Short of the request means the pump cannot hold the pressure asked for.',
  'result.tracking.hint.timing': 'Short of the request means the knock controller took timing away.',
  'result.tracking.reconstructed':
    'The request is reconstructed as logged advance plus knock retard: no OBD-2 source logs the pre-retard advance directly.',
  'result.tracking.status.onTarget': 'on target',
  'result.tracking.status.short': 'short of request',
  'result.tracking.status.over': 'above request',
  'result.tracking.status.spooling': 'spooling',
  'result.tracking.status.insufficient': 'too few pulls',
  'result.tracking.description':
    '{quantity} in the {session} session: the requested value as a dashed line and the delivered value as a solid line, against engine speed.',

  // --- result: correction table -------------------------------------------
  'result.corrections.title': 'Suggested map changes',
  'result.corrections.lead':
    'Each change is sized from what this log showed in that cell of the map. Every one moves toward safety — less timing, more fuel, less boost — and none toward power: a log can prove a cell did harm, not that it has headroom.',
  'result.corrections.caveat':
    'Starting points for the next session, not final values. Make one change at a time, log again, and compare the two sessions here.',
  'result.corrections.none': 'Nothing in this log calls for a map change.',
  'result.corrections.table': 'Table',
  'result.corrections.rpm': 'rpm',
  'result.corrections.load': 'Manifold pressure',
  'result.corrections.change': 'Change',
  'result.corrections.why': 'Because',
  'result.corrections.evidence': 'Evidence',
  'result.corrections.confidence': 'Confidence',
  'result.corrections.anyLoad': 'any',
  'result.corrections.evidenceText': '{points} points · pulls {pulls}',
  'result.corrections.hardwareChange': 'hardware',
  'result.corrections.parameter.ignition': 'Ignition advance',
  'result.corrections.parameter.fuel': 'Fuel',
  'result.corrections.parameter.boost': 'Boost target',
  'result.corrections.parameter.hardware': 'Fuel system',
  'result.corrections.cause.knock': 'knock retard up to {observed}°',
  'result.corrections.cause.lean': 'λ reached {observed}; aiming for {reference}',
  'result.corrections.cause.boostOvershoot': 'boost up to {observed}% over target',
  'result.corrections.cause.boostShortfall': '{observed} kPa short of a {reference} kPa target once spooled',
  'result.corrections.cause.fuelRailDroop':
    'rail pressure up to {observed}% below reference — check pump, filter and injector capacity',

  // --- result: margins -----------------------------------------------------
  'result.margins.title': 'Distance to each limit',
  'result.margins.lead':
    'How close each zone of the after session came to each detector threshold. "No finding" and "no margin" are different statements, and the second is the one to act on before it becomes the first.',
  'result.margins.explain':
    'Distance to the threshold as a percentage of the threshold, for the worst pull. Negative means it was crossed.',
  'result.margins.limit.knock': 'Knock',
  'result.margins.limit.lean': 'Lean mixture',
  'result.margins.limit.boostOvershoot': 'Boost overshoot',
  'result.margins.limit.fuelRailDroop': 'Rail pressure droop',
  'result.margins.limit.egt': 'Exhaust temperature',
  'result.margins.status.ok': 'ok',
  'result.margins.status.tight': 'tight',
  'result.margins.status.exceeded': 'crossed',
  'result.margins.status.unavailable': 'not logged',
  'result.margins.cell': '{limit}, {zone}: worst pull {worst}%, mean {mean}%, {status}',

  // --- result: logging advice ---------------------------------------------
  'result.logging.title': 'What to log next time',
  'result.logging.lead':
    'Each missing channel removed a class of findings from this analysis. The absence of a finding is not the absence of a problem.',
  'result.logging.none': 'Both logs carried everything this analysis uses.',
  'result.logging.both': 'Both sessions',
  'logging.knockRetard':
    'Log knock retard. Without it knock cannot be assessed at all — the most important safety finding is simply unavailable.',
  'logging.lambda': 'Log a wideband λ or AFR channel. Without it a lean mixture under load cannot be detected.',
  'logging.iat':
    'Log intake air temperature. Without it the atmospheric correction assumes 20 °C and heat-soak cannot be seen.',
  'logging.baro':
    'Log barometric pressure. Sea level was assumed, which moves the correction by roughly 1% per 100 m of altitude.',
  'logging.boostTarget':
    'Log the boost target. Overshoot was measured against the settled plateau instead, and requested-vs-delivered boost is unavailable.',
  'logging.boost': 'Log boost or manifold pressure. Boost behaviour could not be assessed.',
  'logging.lambdaTarget':
    'Log the λ target. Without it fuel suggestions aim for a generic λ 0.85 rather than what the map asks for.',
  'logging.fuelRail':
    'Log fuel rail pressure. A fuel system running out of capacity at the top end cannot be seen without it.',
  'logging.fuelRailTarget': 'Log the rail pressure target. Droop was measured against the start of each pull instead.',
  'logging.timing': 'Log ignition advance. The timing request cannot be reconstructed without it.',
  'logging.coolant': 'Log coolant temperature, so the check that the engine was at operating temperature can run.',
  'logging.gear':
    'Log the gear if your app offers it. Gears were recovered from rpm against speed, which gives only a relative label.',
  'logging.sampleRate':
    'Log faster: {rate} Hz was recorded, {target} Hz is the target. Most apps log faster when fewer channels are selected at once.',

  // --- AI explanation ----------------------------------------------------
  'ai.title': 'Ask about this result',
  'ai.badge': 'AI',
  'ai.lead':
    'An AI model can explain this result in plain language and answer questions about it. It sees only the finished summary, never your log files, and it cannot change any number, finding or the verdict.',
  'ai.notVerdict': 'AI explanation — not part of the verdict. The calibrated analysis above is the result.',
  'ai.privacy':
    'Asking sends the analysis summary — numbers, findings, suggested changes, not the CSV files — to the AI service.',

  'ai.summary.title': 'Key messages',
  'ai.summary.privacy':
    'Written by an external AI service from the analysis summary — numbers and findings, not the CSV files.',
  'ai.summary.writing': 'Writing the summary…',
  'ai.summary.write': 'Write summary',
  'ai.summary.rewrite': 'Write again',
  'ai.summary.otherLanguage': 'Written in the other language — write again to switch.',
  'ai.question': 'Your question',
  'ai.placeholder': 'e.g. Which change should I make first, and why?',
  'ai.suggest.explain': 'Explain this result simply',
  'ai.suggest.first': 'Which change should I make first?',
  'ai.suggest.confidence': 'Why is the confidence not higher?',
  'ai.ask': 'Ask',
  'ai.asking': 'Answering…',
  'ai.stop': 'Stop',
  'ai.clear': 'Clear conversation',
  'ai.you': 'You',
  'ai.model': 'AI',
  'ai.error.rate': 'Rate limit reached — wait a moment and try again.',
  'ai.error.network': 'Could not reach the AI service. Check the connection.',
  'ai.error.refused': 'The model declined to answer this question.',
  'ai.error.generic': 'The request failed. Try again in a moment.',
  'ai.error.unavailable': 'The AI assistant is not available right now.',

  // --- dashboard ---------------------------------------------------------
  'result.unit': 'Power unit',
  'chart.title': 'Torque and power',
  'chart.torque': 'Torque',
  'chart.power': 'Power',
  'chart.bands': '95% intervals',
  'chart.gain': 'Gain',
  'chart.hint': 'hover or use the arrow keys to read any rpm',
  'chart.description':
    'Torque and power against engine speed. Torque on the left axis in Nm, power on the right axis in {unit}. Before the tune as dashed lines; after as solid lines with a shaded 95% interval. Peak torque {torqueBefore} to {torqueAfter} Nm, peak power {powerBefore} to {powerAfter} {unit}.',
  'headline.average': 'average {value} {unit} across the range',
  'headline.clean': 'No findings',
  'headline.risks': 'Risks: {count}',
  'headline.cautions': 'Cautions: {count}',
  'headline.changes': 'Map changes: {count}',
  'headline.warnings': 'Warnings: {count}',
  'keypoints.title': 'Key points',
  'keypoints.clean':
    'Clean result: no safety findings, nothing to change in the map, the engine delivers what the ECU asks for, and the measurement followed the protocol.',
  'keypoints.more': '+{count} more',
  'keypoints.open': 'Open',
  'keypoints.measurement': 'Measurement',
  'keypoints.protocol': 'The comparison may not be valid: {count} protocol problems',
  'keypoints.warnings': 'Protocol warnings: {count}',
  'keypoints.safety': 'Safety',
  'keypoints.changes': 'Change in the map',
  'keypoints.tracking': 'Not delivered',
  'keypoints.short': '{quantity} short of request at {low}–{high} rpm ({error})',
  'keypoints.over': '{quantity} above request at {low}–{high} rpm ({error})',
  'keypoints.band': 'Power band',
  'keypoints.loss': 'Loses {delta} {unit} at {low}–{high} rpm',
  'keypoints.tight': 'Zones within 5% of a limit: {count}',
  'tabs.label': 'Details',
  'tabs.changes': 'Map changes',
  'tabs.findings': 'Findings',
  'tabs.tracking': 'Requested vs delivered',
  'tabs.limits': 'Limits',
  'tabs.band': 'Across the rpm range',
  'tabs.uncertainty': 'Validity & uncertainty',
  'tabs.sessions': 'Sessions & pulls',
  'tabs.protocol': 'Protocol & logging',
  'tabs.ask': 'Ask AI',
  'import.vehicle.advanced': 'Advanced vehicle parameters',
  'import.vehicle.massShortHint': 'Weigh the car: mass is the largest source of uncertainty.',
  'import.schema.summary': 'Channels: {recognised} recognised · {missing} worth adding · {unrecognised} not recognised',

  // --- Autotuner / ECU logs ----------------------------------------------
  'channel.ecuTorque': 'ECU-reported torque',
  'import.assumed.absoluteBoost':
    'The boost column holds absolute pressure (it reads near ambient at part load), as Bosch-based loggers such as Autotuner record it. It was read as manifold pressure and converted to boost by subtracting barometric pressure.',
  'segment.rejected.otherGear': 'a different gear from the one both sessions share',
  'protocol.assumedScatter':
    '{session}: {found} usable pull(s), where {needed} are needed to measure pull-to-pull scatter. The interval and the significance test assume a {cv}% scatter instead. Log more pulls in the same gear for a measured answer.',
  'protocol.lambdaLooksDiesel':
    'Under full load λ sits around {lambda}, which is a diesel, not a petrol engine. Check the fuel setting: it decides how AFR is converted and whether the lean-mixture check runs.',
  'chart.source.label': 'Torque source',
  'chart.source.measured': 'From acceleration',
  'chart.source.ecu': 'ECU log',
  'chart.ecuNote':
    'ECU log: the engine controller’s own full-load torque, from every settled full-load sample in every gear of the log. Power is torque × rpm, at the crank — the figure a map-pack viewer and the manufacturer quote.',
  'chart.measuredNote':
    'From acceleration: power worked out from how fast the car gained speed, using the mass and drag you entered. Only the one gear both logs share can be compared this way, and a slope or a wrong mass shifts it.',
  'keypoints.ecu': 'Cross-check from acceleration',
  'keypoints.ecuModelOff':
    'On the stock log, power from acceleration reads {offset}% against the ECU. The mass, drag or road slope does not fit this log, so the acceleration figures are a cross-check only.',
  'keypoints.ecuNotDelivered':
    'The ECU reports {reported} Nm more, but the car’s acceleration in the log did not change accordingly ({measured} Nm). Check that the “after” log is a real drive and not the “before” log with edited values.',
  'headline.ecuVerdict': 'Gain · from the ECU log',
  'headline.ecuBasis': 'ECU full-load torque, all gears · {count} rpm points',
  'headline.ecuAverage': 'average {value} Nm across the range',
  'headline.measuredCrossCheck': 'from acceleration (stock): {value} {unit}',
  'headline.crossCheck.confirmed': 'Acceleration confirms it: {measured} Nm',
  'headline.crossCheck.notDelivered': 'Acceleration did not change: {measured} Nm',
  'headline.crossCheck.exceeds': 'Acceleration shows more: {measured} Nm',
  'headline.crossCheck.undetermined': 'No acceleration cross-check in the shared rpm',
  'keypoints.ecuExceeds':
    'The car delivered {measured} Nm, more than the {reported} Nm the ECU reports: the torque model was not updated with the tune.',
  'keypoints.ecuConfirmed': 'The ECU-reported change ({reported} Nm) matches what the car delivered ({measured} Nm).',
  'report.section.ecu': 'ECU-reported vs measured torque',
  'report.ecu.reported': 'Change reported by the ECU',
  'report.ecu.measured': 'Change the car delivered (measured)',

  // --- export ------------------------------------------------------------
  'result.export': 'Export report (PDF)',
  'result.exporting': 'Preparing…',
  'result.exportPrint': 'Print',
  'report.title': 'TuneVerdict report',
  'report.generated': 'Generated {when}',
  'report.section.verdict': 'Verdict',
  'report.section.gain': 'Gain',
  'report.section.validity': 'Validity',
  'report.section.findings': 'Findings',
  'report.section.sessions': 'Sessions',
  'report.section.uncertainty': 'Uncertainty',
  'report.section.protocol': 'Protocol',
  'report.section.bands': 'Across the rpm range',
  'report.section.tracking': 'Requested vs delivered',
  'report.section.corrections': 'Suggested map changes',
  'report.section.margins': 'Distance to each limit',
  'report.section.logging': 'What to log next time',
  'report.section.aiSummary': 'Key messages (AI — not part of the verdict)',
  'report.footer':
    'Computed in the browser from two OBD-2 logs. No sample data, no server, no language model in the pipeline.',

  // --- units -------------------------------------------------------------
  'unit.hp': 'hp',
  'unit.rpm': 'rpm',
  'unit.celsius': '°C',
  'unit.kpa': 'kPa',
  'unit.bar': 'bar',
  'unit.degrees': '°',
  'unit.percent': '%',
  'unit.hz': 'Hz',
  'unit.kg': 'kg',
  'unit.lambda': 'λ',
  'unit.seconds': 's',
  'unit.sd': 'σ',
  'health.title': 'Car health check',
  'health.lead': 'What the logs say about the condition of the car, system by system. Each status comes from fixed rules on the measured values; the AI mechanic explains them.',
  'health.score': 'Health score',
  'health.scoreStock': 'stock log: {score}',
  'health.label.healthy': 'Healthy',
  'health.label.watch': 'Keep an eye on it',
  'health.label.attention': 'Needs attention',
  'health.label.unknown': 'Not enough data',
  'health.status.good': 'Good',
  'health.status.watch': 'Watch',
  'health.status.concern': 'Concern',
  'health.status.unknown': 'Not logged',
  'health.stock': 'Stock: {status}',
  'health.limit': 'limit {value}',
  'health.notLogged': 'This log does not carry what this system is judged on.',
  'health.system.turbo': 'Turbo & boost',
  'health.system.fuel': 'Fuel system',
  'health.system.combustion': 'Combustion',
  'health.system.thermal': 'Temperatures',
  'health.system.delivery': 'Torque delivery',
  'health.metric.boostPeak': 'Peak boost',
  'health.metric.boostTracking': 'Boost vs target, worst zone',
  'health.metric.railPeak': 'Peak rail pressure',
  'health.metric.railTracking': 'Rail vs target, worst zone',
  'health.metric.injectorDuty': 'Injector duty, max',
  'health.metric.lambdaMin': 'Lowest λ under load',
  'health.metric.lambdaTracking': 'λ vs target, worst zone',
  'health.metric.knockMax': 'Knock retard, max',
  'health.metric.coolantMax': 'Coolant, max',
  'health.metric.oilMax': 'Oil, max',
  'health.metric.egtMax': 'Exhaust gas, max',
  'health.metric.iatRise': 'Intake air rise over the session',
  'health.metric.consistency': 'Pull-to-pull variation',
  'health.metric.ecuDelivered': 'Delivered minus ECU-reported torque change',
  'health.ai.title': 'AI mechanic',
  'health.ai.checks': 'What to check in the workshop',
  'health.ai.reading': 'The AI mechanic is reading the logs…',
  'health.ai.ask': 'Ask the AI mechanic',
  'health.ai.again': 'Ask again',
  'health.ai.unreadable': 'The AI answer could not be read. Ask again.',
  'health.ai.note': 'AI notes explain the statuses; they do not set them.',
  'logging.egt':
    'Log exhaust gas temperature. On a diesel it is the limit a tune reaches first, and without it the thermal margin cannot be judged.',
  'logging.lambdaTargetDiesel':
    'Log a λ or AFR channel. On a diesel it is what shows how close the injected quantity runs to the smoke limit.',
} as const;

export type TranslationKey = keyof typeof en;
