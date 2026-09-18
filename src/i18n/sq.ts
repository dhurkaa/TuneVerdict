/**
 * Albanian strings — the thesis language.
 *
 * Typed as a complete map over the English keys, so the compiler refuses a build
 * in which a string exists in one language and not the other. A half-translated
 * interface is worse than an untranslated one.
 *
 * Technical terms follow the vocabulary fixed for the thesis: tërheqje (pull),
 * mbipresion (boost overshoot), paraprirje (timing advance), rampa e karburantit
 * (fuel rail), përzierje e varfër (lean mixture), besueshmëria (confidence),
 * pasiguria (uncertainty), qëndrueshmëria (consistency).
 */

import type { TranslationKey } from './en';

export const sq: Record<TranslationKey, string> = {
  // --- shell -------------------------------------------------------------
  'app.title': 'TuneVerdict',
  'app.tagline': 'Vendim, jo grafik.',
  'app.lead':
    'Krahaso dy sesione regjistrimi OBD-2 — para dhe pas riprogramimit — dhe merr një vlerësim të mbrojtshëm: sa u fitua, a u fitua në mënyrë të sigurt, dhe sa e sigurt është secila prej tyre.',
  'app.privacy':
    'Gjithçka ndodh brenda shfletuesit tënd. Regjistrimet nuk dalin kurrë nga kjo pajisje.',
  'app.theme.toDark': 'Kalo në temën e errët',
  'app.theme.toLight': 'Kalo në temën e çelët',
  'app.language': 'Gjuha',
  'app.thesis':
    'Punim diplome bachelor · Fakulteti i Inxhinierisë Mekanike dhe Kompjuterike · Universiteti i Mitrovicës "Isa Boletini"',

  'common.before': 'Para',
  'common.after': 'Pas',
  'common.yes': 'Po',
  'common.no': 'Jo',
  'common.none': 'Asnjë',
  'common.session': 'Sesioni',
  'common.back': 'Kthehu te importimi',
  'common.of': 'nga',
  'common.showDetails': 'Shfaq detajet',
  'common.hideDetails': 'Fshih detajet',

  // --- import screen -----------------------------------------------------
  'import.title': 'Dy sesione',
  'import.lead':
    'Një CSV para riprogramimit, një pas. Të regjistruara në të njëjtën rrugë, në të njëjtin marsh, në të njëjtat kushte.',
  'import.drop.before': 'Para riprogramimit',
  'import.drop.after': 'Pas riprogramimit',
  'import.drop.hint': 'Lësho një CSV këtu, ose zgjidh një skedar',
  'import.drop.browse': 'Zgjidh skedarin',
  'import.drop.replace': 'Zëvendëso',
  'import.drop.remove': 'Hiq',
  'import.drop.reading': 'Po lexohet…',

  'import.file.format': 'Njohur si',
  'import.file.rows': 'Rreshta',
  'import.file.rate': 'Frekuenca e regjistrimit',
  'import.file.duration': 'Kohëzgjatja',
  'import.file.channels': 'Kanale të gjetura',

  'import.schema.title': 'Çfarë u njoh',
  'import.schema.recognised': 'Kanale të njohura',
  'import.schema.unrecognised': 'Të panjohura',
  'import.schema.unrecognisedHint':
    'Këto kolona nuk hynë në analizë. Asgjë nuk u hamendësua prej tyre.',
  'import.schema.derived': 'Të llogaritura nga kanale të tjera',
  'import.schema.assumed': 'Të supozuara',
  'import.schema.missingRecommended': 'Që mungojnë, dhe do të vlenin',
  'import.schema.missingHint':
    'Analiza funksionon edhe pa to, por çdo kanal që mungon heq një kategori gjetjesh.',
  'import.schema.dropped': '{count} mostra u hoqën si jashtë intervalit të mundshëm',
  'import.schema.derivedFrom': 'nga {channels}',
  'import.assumed.baroSeaLevel':
    'Pa kanal barometrik: u supozua presioni në nivel deti. Kjo mbartet si pasiguri, nuk fshihet.',

  'import.vehicle.title': 'Automjeti',
  'import.vehicle.lead':
    'Fuqia nxirret nga sa shpejt përshpejtoi automjeti, prandaj këto përshkruajnë atë që u përshpejtua. Masa është ajo që ka rëndësinë më të madhe.',
  'import.vehicle.mass': 'Masa, përfshirë shoferin dhe karburantin',
  'import.vehicle.massHint':
    'Masa zë 62% të buxhetit të pasigurisë. Për një pohim ±5 hp duhet njohur brenda 1.44% — domethënë ±22 kg në 1500 kg. Peshoje automjetin; mos e hamendëso.',
  'import.vehicle.massWeighed': 'Kjo masë u mat, nuk u vlerësua me hamendje',
  'import.vehicle.dragArea': 'Sipërfaqja aerodinamike (Cd·A)',
  'import.vehicle.rolling': 'Rezistenca e rrotullimit',
  'import.vehicle.efficiency': 'Efikasiteti i transmisionit',
  'import.vehicle.inertia': 'Faktori i inercisë rrotulluese',
  'import.vehicle.fuel': 'Karburanti',
  'import.vehicle.fuelHint':
    'Përcakton se si raporti ajër-karburant i regjistruar shndërrohet në λ. Në E85 i njëjti numër AFR do të thotë diçka krejt tjetër.',
  'import.vehicle.standard': 'Standardi i korrigjimit',
  'import.vehicle.standardHint':
    'SAE J1349 i referohet ajrit të thatë në 990 hPa dhe 25 °C; DIN 70020 i referohet 1013 hPa dhe 20 °C dhe jep numra më të mëdhenj.',
  'import.fuel.gasoline': 'Benzinë',
  'import.fuel.diesel': 'Naftë',
  'import.fuel.e85': 'E85',
  'import.fuel.lpg': 'Gaz (LPG)',

  'import.analyse': 'Analizo',
  'import.analysing': 'Po analizohet…',
  'import.waitingBoth': 'Duhen të dy sesionet para se të krahasohet çfarëdo gjëje.',

  'import.empty.title': 'Ende nuk është ngarkuar asgjë',
  'import.empty.body':
    'Ky aplikacion nuk vjen me të dhëna shembull. Gjithçka që do të shohësh do të llogaritet nga dy skedarët që jep ti, brenda këtij shfletuesi.',
  'import.empty.protocol': 'Si duket një çift regjistrimesh i përdorshëm',
  'protocol.rule.pulls': '5 tërheqje me gaz të plotë për çdo sesion',
  'protocol.rule.gear': 'Marshi i tretë ose i katërt, i njëjti në të dy sesionet',
  'protocol.rule.rpm': '2000 → 5500 rrot./min, një kalim i pandërprerë',
  'protocol.rule.road': 'E njëjta rrugë, në të njëjtin drejtim',
  'protocol.rule.temp': 'Temperatura e ajrit hyrës brenda 3 °C mes sesioneve',
  'protocol.rule.fuel': 'Karburanti mbi gjysmë depozite',
  'protocol.rule.warm': 'Motori në temperaturë pune',
  'protocol.rule.rate': 'I regjistruar në 10 Hz aty ku programi e lejon',

  // --- errors ------------------------------------------------------------
  'import.error.title': 'Ky skedar nuk mund të përdorej',
  'import.error.empty': '{label} nuk përmban rreshta që duken si të dhëna regjistrimi.',
  'import.error.tooFewRows': '{label} ka vetëm {rows} rreshta të dhënash — shumë pak për analizë.',
  'import.error.noTime':
    '{label} nuk ka kolonë të përdorshme kohe. Çdo rresht i duhet një vulë kohore, përndryshe mostrat nuk vendosen dot në një bazë të përbashkët kohe.',
  'import.error.sampleRate':
    '{label} u regjistrua në {rate} Hz. Nën {minimum} Hz kalimtaret që kërkon ky aplikacion nuk rikthehen dot, dhe interpolimi deri në 10 Hz do t’i shpikte ato.',
  'import.error.missingRequired':
    '{label} i mungon një kanal pa të cilin analiza nuk funksionon: {channels}.',
  'import.error.read': 'Skedari nuk mund të lexohej.',
  'analysis.error.tooFewPulls':
    'U gjetën vetëm {found} tërheqje të përdorshme në {session}, ndërsa minimumi është {minimum}. {rejected} tërheqje kandidate u refuzuan. Me më pak se tri tërheqje nuk ka çfarë të rikampionohet dhe qëndrueshmëria nuk përcaktohet — dhe një interval i gjerë prapë lexohet si përgjigje.',

  // --- channels ----------------------------------------------------------
  'channel.time': 'Koha',
  'channel.rpm': 'Rrotullimet e motorit',
  'channel.speed': 'Shpejtësia e automjetit',
  'channel.throttle': 'Pozita e valvulës së gazit',
  'channel.pedal': 'Pedali i gazit',
  'channel.engineLoad': 'Ngarkesa e motorit',
  'channel.map': 'Presioni në kolektor',
  'channel.boost': 'Presioni i mbushjes',
  'channel.boostTarget': 'Presioni i synuar i mbushjes',
  'channel.baro': 'Presioni barometrik',
  'channel.iat': 'Temperatura e ajrit hyrës',
  'channel.coolant': 'Temperatura e lëngut ftohës',
  'channel.ambient': 'Temperatura e ambientit',
  'channel.oilTemp': 'Temperatura e vajit',
  'channel.egt': 'Temperatura e gazrave të shkarkimit',
  'channel.lambda': 'Lambda',
  'channel.lambdaTarget': 'Lambda e synuar',
  'channel.shortTrim': 'Korrigjimi afatshkurtër i karburantit',
  'channel.longTrim': 'Korrigjimi afatgjatë i karburantit',
  'channel.timing': 'Paraprirja e ndezjes',
  'channel.knockRetard': 'Kthimi i paraprirjes nga trokitja',
  'channel.fuelRail': 'Presioni i rampës së karburantit',
  'channel.fuelRailTarget': 'Presioni i synuar i rampës',
  'channel.maf': 'Rrjedha e masës së ajrit',
  'channel.gear': 'Marshi',
  'channel.fuelLevel': 'Niveli i karburantit',
  'channel.battery': 'Tensioni i baterisë',
  'channel.injectorDuty': 'Cikli i punës së injektorit',

  'requirement.required': 'I domosdoshëm',
  'requirement.recommended': 'I rekomanduar',
  'requirement.optional': 'Opsional',
  'provenance.measured': 'I matur',
  'provenance.derived': 'I nxjerrë',
  'provenance.assumed': 'I supozuar',
  'provenance.missing': 'Mungon',

  // --- segmentation ------------------------------------------------------
  'segment.rejected.tooShort': 'shumë e shkurtër',
  'segment.rejected.rpmSpan': 'mbulon shumë pak rrotullime',
  'segment.rejected.rpmFalling': 'rrotullimet ranë gjatë tërheqjes',
  'segment.rejected.noGearRatio': 'marshi nuk u përcaktua dot',
  'segment.rejected.tooFewSamples': 'shumë pak mostra të vlefshme',

  // --- protocol violations ----------------------------------------------
  'protocol.title': 'Protokolli',
  'protocol.none': 'Të dy sesionet e ndjekin protokollin e matjes.',
  'protocol.lead':
    'Një krahasim mes kushtesh të papërputhura është mënyra më e mundshme për të marrë një përgjigje të gabuar me bindje, prandaj kushtet kontrollohen para se të lexohet vendimi.',
  'protocol.tooFewPulls':
    '{session}: {found} tërheqje të përdorshme, duhen {minimum}, protokolli kërkon {expected}. {rejected} kandidate u refuzuan.',
  'protocol.fewerPullsThanProtocol':
    '{session}: {found} tërheqje të përdorshme, ndërsa protokolli kërkon {expected}. Intervali do të dalë më i gjerë se ç’duhet.',
  'protocol.lowSampleRate':
    '{session} u regjistrua në {rate} Hz, nën {target} Hz që duan detektorët e kalimtareve. Vlerësimi i fitimit mbetet i vlefshëm; mbipresioni dhe lëkundja e presionit humbin ndjeshmëri.',
  'protocol.mixedGears':
    '{session} përmban tërheqje në më shumë se një marsh ({gears}). Ato nuk janë pesë matje të krahasueshme.',
  'protocol.engineCold':
    '{session}: temperatura mesatare e lëngut ftohës {coolant} °C, nën {minimum} °C që kërkon protokolli.',
  'protocol.lowFuel':
    '{session}: karburanti në {level}%, nën {minimum}% që kërkon protokolli. Masa e karburantit bëhet variabël i fshehur.',
  'protocol.correctionOutOfBand':
    '{session}: {pulls} nga {total} tërheqje kërkuan korrigjim atmosferik jashtë brezit që SAE J1349 e shpall të vlefshëm. Kushtet ishin shumë të largëta për t’u pajtuar vetëm me korrigjim.',
  'protocol.rpmCoverageHigh':
    '{session} arriti vetëm {reached} rrot./min, nën {expected}. Nuk pohohet asgjë mbi rrotullimet që tërheqjet arritën vërtet.',
  'protocol.rpmCoverageLow':
    '{session} filloi në {started} rrot./min, mbi {expected} që kërkon protokolli.',
  'protocol.gearMismatch':
    'Dy sesionet u vozitën në marshe të ndryshme ({before} dhe {after}). Kjo është mënyra më e mundshme për të marrë një përgjigje të gabuar me bindje, dhe krahasimit nuk duhet t’i besohet.',
  'protocol.iatMismatch':
    'Temperatura e ajrit hyrës ndryshon me {delta} °C mes sesioneve ({before} °C dhe {after} °C), ndërsa protokolli lejon {maximum} °C. Përtej kësaj, korrigjimi bën më shumë punë sesa vetë riprogramimi.',
  'protocol.ratioMismatch':
    'Raporti rrotullime-shpejtësi ndryshon me {delta}% mes sesioneve edhe pse marshi përputhet — goma të ndryshme, ose një transmision tjetër.',

  // --- result: headline --------------------------------------------------
  'result.title': 'Vendimi',
  'result.verdict.good': 'Fitim i provuar, pa gjetje sigurie',
  'result.verdict.mixed': 'Fitim i provuar, me rezerva',
  'result.verdict.bad': 'I pambrojtshëm',
  'result.verdict.inconclusive': 'Pa ndryshim të provuar',
  'result.verdict.goodBody':
    'Ndryshimi mes dy sesioneve është më i madh se zhurma e matjes, tërheqjet përputhen mes tyre, dhe asnjë rregull sigurie nuk u aktivizua.',
  'result.verdict.mixedBody':
    'Ka fitim real, por diçka në të dhënat flet kundër lënies së riprogramimit ashtu siç është. Gjetjet më poshtë thonë çfarë.',
  'result.verdict.badBody':
    'Dëshmitë nuk e mbështesin këtë riprogramim ashtu siç është. Lexo gjetjet para se ta vozitësh.',
  'result.verdict.inconclusiveBody':
    'Ndryshimi mes dy sesioneve nuk dallohet nga shpërndarja mes tërheqjeve. Ky është pohim për dëshmitë, jo për riprogramimin: asgjë këtu nuk provon se ai nuk bëri gjë.',

  'result.gain': 'Fitimi',
  'result.gainPercent': 'Fitimi relativ',
  'result.peakBefore': 'Maksimumi, para',
  'result.peakAfter': 'Maksimumi, pas',
  'result.significant': 'Statistikisht i rëndësishëm',
  'result.notSignificant': 'Jo statistikisht i rëndësishëm',
  'result.pValue': 'p = {value}',
  'result.interval': 'Interval 95%: {lo} deri {hi}',
  'result.plusMinus': '± {sd}',

  // --- result: validity card --------------------------------------------
  'result.validity.title': 'Vlefshmëria',
  'result.validity.formula': 'Fitim × Qëndrueshmëri × Siguri',
  'result.validity.lead':
    'Shumëzim me qëllim. Një mbledhje do ta lejonte një fitim të madh të blinte heshtjen e një rreziku; një prodhim nuk bindet me fjalë.',
  'result.validity.gain': 'Fitimi',
  'result.validity.consistency': 'Qëndrueshmëria',
  'result.validity.safety': 'Siguria',
  'result.validity.index': 'Indeksi',
  'result.validity.gainHint': 'Zero nëse fitimi nuk është më i madh se zhurma.',
  'result.validity.consistencyHint': 'Sa afër janë mes tyre tërheqjet e sesionit të pasëm.',
  'result.validity.safetyHint':
    'Një, minus atë që heq çdo gjetje, e peshuar sipas besueshmërisë së saj.',

  // --- result: chart -----------------------------------------------------
  'result.chart.title': 'Fuqia sipas rrotullimeve të motorit',
  'result.chart.description':
    'Dy kurba fuqie të vizatuara sipas rrotullimeve të motorit. Sesioni i parë është vijë gri me vija-vija, sesioni i dytë vijë e plotë në ngjyrën e sinjalit, secila brenda një brezi që tregon intervalin 95%. Maksimumi para {before} hp, maksimumi pas {after} hp.',
  'result.chart.before': 'Para (me vija-vija)',
  'result.chart.after': 'Pas',
  'result.chart.band': 'Intervali 95%',
  'result.chart.rpm': 'rrot./min',
  'result.chart.power': 'hp',
  'result.chart.deltaTitle': 'Ndryshimi, me intervalin e vet',
  'result.chart.deltaDescription':
    'Ndryshimi mes dy sesioneve përgjatë intervalit të rrotullimeve, me një brez 95%. Aty ku brezi kalon zeron, nuk provohet fitim në ato rrotullime.',
  'result.chart.zero': 'Pa ndryshim',
  'result.chart.coverage': 'Vizatohet vetëm aty ku arritën vërtet tërheqjet e të dy sesioneve.',

  // --- result: findings --------------------------------------------------
  'result.findings.title': 'Gjetjet dhe çfarë duhet bërë',
  'result.findings.none':
    'Asnjë rregull nuk u aktivizua dhe asnjë tërheqje nuk u soll ndryshe nga motrat e saj. Kjo nuk është certifikatë shëndeti — është mungesë dëshmish për dëm në kanalet që përmbante ky regjistrim.',
  'result.findings.zone': '{low}–{high} rrot./min',
  'result.findings.action': 'Çfarë të bësh',
  'result.findings.risk': 'Nëse shpërfillet',
  'result.findings.evidence': 'Dëshmia',
  'result.findings.confidence': 'Besueshmëria',
  'result.findings.pulls': 'E parë në {count} nga {total} tërheqje',
  'result.findings.samples': '{exceeding} nga {total} mostra në këtë zonë e kaluan pragun',
  'result.findings.peak': 'Vlera më e keqe {peak}, pragu {threshold}',
  'result.findings.channel': 'Kanali: {channel} ({provenance})',
  'result.findings.whyConfidence': 'Si u arrit kjo besueshmëri',
  'result.findings.inSession': 'Në sesionin {session}',

  'finding.knock': 'Kthim i paraprirjes nga trokitja',
  'finding.lean': 'Përzierje e varfër nën ngarkesë',
  'finding.boostOvershoot': 'Mbipresion',
  'finding.boostOscillation': 'Lëkundje e presionit të mbushjes',
  'finding.fuelRailDroop': 'Rënie e presionit në rampën e karburantit',
  'finding.iatHeatSoak': 'Ngrohje e tepërt e ajrit hyrës',
  'finding.egt': 'Temperatura e gazrave të shkarkimit',
  'finding.residualOutlier': 'Tërheqje ndryshe nga motrat e saj',

  'advice.knock.action':
    'Ul paraprirjen e ndezjes në këtë zonë, ose rrit oktanin e karburantit. Verifiko se leximi i sensorit të trokitjes është i vërtetë para se të ndryshosh gjë tjetër.',
  'advice.knock.risk':
    'Detonacioni i vazhdueshëm shkatërron pistonat dhe unazat. Kjo është gjetja e vetme që duhet ta ndalë vozitjen e fortë derisa të zgjidhet.',
  'advice.lean.action':
    'Shto karburant në këtë zonë derisa λ të kthehet në 0.78–0.85 që kërkon një motor nën ngarkesë. Kontrollo presionin e karburantit dhe kapacitetin e injektorëve para se të fajësosh hartën.',
  'advice.lean.risk':
    'Përzierja e varfër nën ngarkesë të plotë rrit temperaturën e djegies pikërisht aty ku nuk ka më marzh, dhe çon në detonacion e pistona të shkrirë.',
  'advice.boostOvershoot.action':
    'Ngadalëso përgjigjen e valvulës së shkarkimit apo të kontrolluesit të presionit, ose ul rampën e ciklit të punës, që presioni të arrijë te synimi e jo përtej tij.',
  'advice.boostOvershoot.risk':
    'Mbipresioni i përsëritur ngarkon turbinën dhe guarnicionin e kokës përtej asaj që deklaron riprogramimi, dhe mund ta shtyjë ECU-në në ndërprerje mbrojtëse.',
  'advice.boostOscillation.action':
    'Rregullo kontrolluesin e presionit: ul përforcimin, ose kontrollo për zorrë që rrjedh apo valvul shkarkimi që ngec.',
  'advice.boostOscillation.risk':
    'Presioni që luhatet i bën tabelat e karburantit dhe të ndezjes të ndjekin një objektiv në lëvizje, kështu që asnjëra nuk është e saktë për gjatë.',
  'advice.fuelRailDroop.action':
    'Kontrollo pompën, filtrin dhe ciklin e punës së injektorëve në krye të intervalit të rrotullimeve. Sistemi i karburantit mbaron kapacitetin para motorit.',
  'advice.fuelRailDroop.risk':
    'Rënia e presionit në rampë e varfëron përzierjen pikërisht aty ku ngarkesa është më e lartë — i njëjti dështim si një hartë e varfër, me shkak tjetër.',
  'advice.iatHeatSoak.action':
    'Lëre automjetin të ftohet mes tërheqjeve, ose përmirëso ftohjen e ajrit të mbushjes. Përsërite sesionin me pushim më të gjatë mes tërheqjeve.',
  'advice.iatHeatSoak.risk':
    'Tërheqjet e fundit janë praktikisht një motor tjetër nga ato të parat, kështu që sesioni mesatarizon dy gjendje dhe krahasimi komprometohet.',
  'advice.egt.action':
    'Kontrollo karburantin dhe paraprirjen në këtë zonë, dhe konfirmo se sensori lexon saktë para se të veprosh.',
  'advice.egt.risk':
    'Temperatura e lartë e vazhdueshme e shkarkimit dëmton turbinën dhe valvulat. Ky detektor është jashtë grupit të kalibruar, prandaj trajtoje si nxitje për të parë, jo si matje.',
  'advice.residualOutlier.action':
    'Shikoje këtë tërheqje veç. Diçka ndryshoi — trafiku, pjerrësia, një ndërrim marshi, një ndërprerje sensori — dhe po e hollon mesataren e sesionit.',
  'advice.residualOutlier.risk':
    'Një tërheqje e ndryshme i zgjeron të gjitha intervalet e këtij raporti dhe mund ta zhvendosë shifrën kryesore pa u parë në të.',

  'confidence.base': 'Pikënisja për një detektor që u aktivizua',
  'confidence.agreeingPulls': 'Ndodhi në më shumë se një tërheqje',
  'confidence.margin': 'Vlera është mirë përtej pragut, jo vetëm mbi të',
  'confidence.derivedChannel': 'Kanali u llogarit, nuk u mat',
  'confidence.uncalibratedDetector': 'Ky detektor është jashtë grupit të kalibruar',
  'confidence.lowSampleRate': 'Regjistrimi është më i ngadaltë se 10 Hz',
  'confidence.outOfBandCorrection': 'Korrigjimi atmosferik doli jashtë brezit të vlefshëm',
  'confidence.wilsonCap':
    'E kufizuar: dhjetë përgjigje të sakta nga dhjetë provojnë saktësi mbi 0.72, jo mbi 1.00',

  // --- result: uncertainty ----------------------------------------------
  'result.uncertainty.title': 'Nga vjen pasiguria',
  'result.uncertainty.lead':
    'Fuqia nxirret nga përshpejtimi, prandaj çdo gabim në përshkrimin e automjetit bëhet gabim në përgjigje. Kjo tregon cili gabim, dhe sa.',
  'result.uncertainty.budget': 'Pjesa e variancës',
  'result.uncertainty.cancellationTitle': 'Shuarja e gabimit të përbashkët',
  'result.uncertainty.seedTitle': 'Riprodhueshmëria',
  'result.uncertainty.component.mass': 'Masa',
  'result.uncertainty.component.dragArea': 'Sipërfaqja aerodinamike',
  'result.uncertainty.component.rollingResistance': 'Rezistenca e rrotullimit',
  'result.uncertainty.component.efficiency': 'Efikasiteti i transmisionit',
  'result.uncertainty.component.inertia': 'Inercia rrotulluese',
  'result.uncertainty.massAdvice':
    'Masa kryeson buxhetin. Për një pohim ±5 hp duhet njohur brenda 1.44% — ±22 kg në 1500 kg. Peshoje automjetin; mos e hamendëso masën e tij.',
  'result.uncertainty.cancellation':
    'Ndryshimi është {factor}× më i përcaktuar se secila shifër absolute, sepse të dy sesionet janë i njëjti automjet në të njëjtën rrugë dhe gabimet e përbashkëta shuhen në zbritje.',
  'result.uncertainty.ece':
    'Vlerat e besueshmërisë mbartin një gabim të pritur kalibrimi prej {ece} dhe kufizohen në {cap}. Detektorët ishin të saktë çdo herë në grupin e validimit, por dhjetë nga dhjetë dëshmojnë vetëm saktësi mbi 0.72 — të pohosh më shumë do të ishte mbivlerësim.',
  'result.uncertainty.seed': 'Fara {seed} · llogaritur më {when}',
  'result.uncertainty.reproducible':
    'Burimi i rastësisë mbillet nga vetë hyrja, prandaj i njëjti çift skedarësh jep të njëjtin rezultat çdo herë.',

  // --- result: sessions --------------------------------------------------
  'result.sessions.title': 'Dy sesionet',
  'result.sessions.pullsAccepted': 'Tërheqje të përdorura',
  'result.sessions.pullsRejected': 'Tërheqje të refuzuara',
  'result.sessions.gear': 'Marshi',
  'result.sessions.gearRelative':
    'Etiketë relative. Regjistrimi nuk kishte kanal marshi, prandaj marshet u rikuperuan duke grupuar rrotullimet kundrejt shpejtësisë: kjo thotë se të dy sesionet përdorën të njëjtin marsh, jo cilin.',
  'result.sessions.iat': 'Temperatura mesatare e ajrit hyrës',
  'result.sessions.iatRise': 'Rritja e temperaturës së ajrit hyrës',
  'result.sessions.correction': 'Faktori mesatar i korrigjimit',
  'result.sessions.cv': 'Ndryshueshmëria mes tërheqjeve',
  'result.sessions.rate': 'Frekuenca e burimit',
  'result.sessions.peak': 'Fuqia maksimale',
  'result.pulls.title': 'Tërheqjet',
  'result.pulls.index': '#',
  'result.pulls.window': 'Dritarja',
  'result.pulls.rpm': 'Intervali i rrotullimeve',
  'result.pulls.iat': 'Temp. ajri',
  'result.pulls.correction': 'Korrigjimi',
  'result.pulls.status': 'Gjendja',
  'result.pulls.used': 'e përdorur',
  'result.pulls.rejectedBecause': 'e refuzuar: {reason}',
  'result.pairing.title': 'Çiftimi i tërheqjeve',
  'result.pairing.lead':
    'Çdo tërheqje e sesionit të parë është çiftuar me tërheqjen më të afërt të sesionit të dytë me Dynamic Time Warping, që gjetjet të raportohen përballë një motre konkrete e jo përballë një mesatareje.',
  'result.pairing.pair': 'para #{before} ↔ pas #{after}',
  'result.pairing.distance': 'distanca {distance}',

  // --- export ------------------------------------------------------------
  'result.export': 'Eksporto raportin (PDF)',
  'result.exporting': 'Po përgatitet…',
  'result.exportPrint': 'Printo',
  'report.title': 'Raport TuneVerdict',
  'report.generated': 'Gjeneruar më {when}',
  'report.section.verdict': 'Vendimi',
  'report.section.gain': 'Fitimi',
  'report.section.validity': 'Vlefshmëria',
  'report.section.findings': 'Gjetjet',
  'report.section.sessions': 'Sesionet',
  'report.section.uncertainty': 'Pasiguria',
  'report.section.protocol': 'Protokolli',
  'report.footer':
    'Llogaritur në shfletues nga dy regjistrime OBD-2. Pa të dhëna shembull, pa server, pa model gjuhësor në rrjedhën e përpunimit.',

  // --- units -------------------------------------------------------------
  'unit.hp': 'hp',
  'unit.rpm': 'rrot./min',
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
};
