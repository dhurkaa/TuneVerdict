/**
 * Screenshots for the thesis (punim diplome).
 *
 * Drives the running dev server in a real Chrome at 2× pixel density and saves
 * numbered PNGs for two experiments: a clean Stage 1 pair where the gain is
 * proven, and a stock log against an edited one, where the ECU claims a gain the
 * car never delivered. The light theme is used because it prints; a few hero
 * figures are repeated in the dark theme for the design chapter.
 *
 * Run with the dev server up:  node scripts/figures.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const URL = process.env.FIGURES_URL ?? 'http://localhost:5173';
const OUT = process.env.FIGURES_OUT ?? 'C:/Users/dhuri/Downloads/tuneverdict-figures';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DOWNLOADS = 'C:/Users/dhuri/Downloads';

const EXPERIMENTS = {
  A: {
    id: 'A',
    title: 'Stage 1 në naftë — fitimi i provuar',
    before: join(DOWNLOADS, 'SIMULATED_TEST_Mercedes_C220d_W205FL_stock_194PS_400Nm.csv'),
    after: join(DOWNLOADS, 'SIMULATED_TEST_Mercedes_C220d_W205FL_stage1_220hp_460Nm.csv'),
    massKg: '1650',
  },
  B: {
    id: 'B',
    title: 'ECU pohon një fitim që makina nuk e dha',
    before: join(DOWNLOADS, '202609211609_Mercedes_220d_(2.0)_C_2018_- W205-FL_194hp_datalog.csv'),
    after: join(DOWNLOADS, 'SIMULATED_Mercedes_220d_W205-FL_220hp_460nm_target.csv'),
    massKg: '1650',
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const captions = [];

async function shoot(target, name, caption, options = {}) {
  await target.screenshot({ path: join(OUT, `${name}.png`), ...options });
  captions.push({ name, caption });
  console.log('  ' + name);
}

async function shootPanel(page, selector, name, caption) {
  const handle = await page.$(selector);
  if (!handle) {
    console.log('  (missing) ' + name);
    return;
  }
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shoot(handle, name, caption);
}

/** Language, theme and unit are stored settings, so they are set before the app boots. */
async function open(page, language, theme) {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    (lang, th) => {
      localStorage.setItem('tuneverdict.language', lang);
      localStorage.setItem('tuneverdict.theme', th);
      localStorage.setItem('tuneverdict.powerUnit', 'PS');
    },
    language,
    theme,
  );
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await sleep(700);
  // The app writes its own language back to storage once it mounts, so the
  // setting is confirmed through the control the user would use.
  await page.evaluate((lang) => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'sq') && [...s.options].some((o) => o.value === 'en'),
    );
    if (select && select.value !== lang) {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(select, lang);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, language);
  await sleep(700);
  const shown = await page.evaluate(() => document.documentElement.lang);
  if (shown !== language) throw new Error(`language is ${shown}, expected ${language}`);

  // The theme is likewise confirmed through the control, because the app writes
  // its own theme back to storage as it mounts.
  await page.evaluate((want) => {
    if (document.documentElement.dataset.theme !== want) {
      const button = [...document.querySelectorAll('button')].find((b) => /^[☀☾]$/.test(b.textContent.trim()));
      button?.click();
    }
  }, theme);
  await sleep(600);
  const themeShown = await page.evaluate(() => document.documentElement.dataset.theme);
  if (themeShown !== theme) throw new Error(`theme is ${themeShown}, expected ${theme}`);
}

async function analyse(page, experiment) {
  const inputs = await page.$$('input[type=file]');
  await inputs[0].uploadFile(experiment.before);
  await sleep(800);
  await inputs[1].uploadFile(experiment.after);
  await sleep(1400);
  await page.evaluate((mass) => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'diesel'),
    );
    const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    selectValue.call(select, 'diesel');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector('input[type=number]');
    const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputValue.call(input, mass);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, experiment.massKg);
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Analy|Analizo/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.headline-strip', { timeout: 60000 });
  await sleep(1800);
}

async function waitForAi(page) {
  try {
    await page.waitForSelector('.health-overall', { timeout: 150000 });
    await sleep(1000);
    return true;
  } catch {
    console.log('  (no AI report)');
    return false;
  }
}

/** The tab strip of the detail section, by its accessible role. */
async function shootTabs(page, tag, startNumber) {
  const tabs = await page.evaluate(() =>
    [...document.querySelectorAll('#details [role=tab]')].map((b, i) => ({
      i,
      text: b.textContent.trim().split('\n')[0],
    })),
  );
  let n = startNumber;
  for (const tab of tabs) {
    await page.evaluate((index) => {
      [...document.querySelectorAll('#details [role=tab]')][index]?.click();
    }, tab.i);
    await sleep(800);
    const slug = tab.text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 26);
    await shootPanel(page, '#details', `${tag}-${String(n).padStart(2, '0')}-tab-${slug}`, `Skeda “${tab.text}”`);
    n += 1;
  }
  return n;
}

async function experimentFigures(page, experiment, language) {
  const tag = experiment.id + (language === 'sq' ? '' : '-en');
  console.log(`\n${experiment.id} (${language}): ${experiment.title}`);
  await open(page, language, 'light');

  if (experiment.id === 'A' && language === 'sq') {
    await shoot(page, '01-ekrani-i-importit', 'Ekrani i importit: dy skedarë CSV, pa të dhëna shembull.', {
      fullPage: true,
    });
  }

  await page.$$('input[type=file]').then(async (inputs) => {
    await inputs[0].uploadFile(experiment.before);
    await sleep(900);
    await inputs[1].uploadFile(experiment.after);
    await sleep(1500);
  });

  if (language === 'sq') {
    await shoot(
      page,
      `${tag}-02-njohja-e-kanaleve`,
      `Eksperimenti ${experiment.id}: njohja e skemës — kanalet e njohura, të nxjerra dhe të panjohura.`,
      { fullPage: true },
    );
  }

  await page.evaluate((mass) => {
    const select = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => o.value === 'diesel'),
    );
    const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    selectValue.call(select, 'diesel');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const input = document.querySelector('input[type=number]');
    const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    inputValue.call(input, mass);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, experiment.massKg);
  await sleep(600);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /Analy|Analizo/i.test(b.textContent))?.click();
  });
  await page.waitForSelector('.headline-strip', { timeout: 60000 });
  await sleep(1800);

  await shootPanel(page, '.headline-strip', `${tag}-03-verdikti`, `Eksperimenti ${experiment.id}: shifrat kryesore dhe verdikti.`);
  await shootPanel(page, '#chart', `${tag}-04-grafiku-ecu`, `Eksperimenti ${experiment.id}: momenti dhe fuqia nga regjistrimi i ECU-së, para kundrejt pas.`);

  const switched = await page.evaluate(() => {
    const button = [...document.querySelectorAll('.chart-toggles .segmented button')].find((b) =>
      /accelerat|përshpejt/i.test(b.textContent),
    );
    button?.click();
    return Boolean(button);
  });
  if (switched) {
    await sleep(700);
    await shootPanel(page, '#chart', `${tag}-05-grafiku-nga-pershpejtimi`, `Eksperimenti ${experiment.id}: i njëjti krahasim i matur nga përshpejtimi, me brezin e pasigurisë 95%.`);
    await page.evaluate(() => {
      [...document.querySelectorAll('.chart-toggles .segmented button')].find((b) => /ECU/i.test(b.textContent))?.click();
    });
    await sleep(500);
  }

  await waitForAi(page);
  await shootPanel(page, '.dashboard-side', `${tag}-06-pikat-kyce`, `Eksperimenti ${experiment.id}: pikat kyçe dhe mesazhet kryesore të AI-së.`);
  await shootPanel(page, '#health', `${tag}-07-gjendja-e-makines`, `Eksperimenti ${experiment.id}: kontrolli i gjendjes së makinës me shënimet e mekanikut AI.`);

  const next = await shootTabs(page, tag, 8);

  // A real question to the assistant, answered from this result.
  const asked = await page.evaluate(() => {
    const tab = [...document.querySelectorAll('#details [role=tab]')].find((b) => /Ask AI|Pyet AI/i.test(b.textContent));
    if (!tab) return false;
    tab.click();
    return true;
  });
  if (asked) {
    await sleep(800);
    const box = await page.$('#details textarea, #details input[type=text]');
    if (box) {
      await box.click();
      await box.type(
        language === 'sq'
          ? 'A është i sigurt ky riprogramim për përdorim të përditshëm, dhe çfarë duhet të kontrolloj së pari?'
          : 'Is this tune safe for daily driving, and what should I check first?',
      );
      await page.evaluate(() => {
        const form = document.querySelector('#details form');
        if (form) form.requestSubmit();
        else [...document.querySelectorAll('#details button')].find((b) => /Send|Dërgo|Pyet/i.test(b.textContent))?.click();
      });
      await sleep(25000);
      await shootPanel(page, '#details', `${tag}-${String(next).padStart(2, '0')}-pyet-ai`, `Eksperimenti ${experiment.id}: pyetje pasuese drejtuar asistentit, e përgjigjur vetëm nga ky rezultat.`);
    }
  }

  await shoot(page, `${tag}-${String(next + 1).padStart(2, '0')}-faqja-e-plote`, `Eksperimenti ${experiment.id}: ekrani i plotë i rezultatit.`, {
    fullPage: true,
  });
}

/** The same result in the dark theme, for the chapter on the design language. */
async function darkFigures(page, experiment) {
  console.log('\nDark theme');
  await open(page, 'sq', 'dark');
  await analyse(page, experiment);
  await waitForAi(page);
  await shootPanel(page, '.headline-strip', 'D-01-verdikti-tema-e-erret', 'Tema e errët: shifrat kryesore.');
  await shootPanel(page, '#chart', 'D-02-grafiku-tema-e-erret', 'Tema e errët: grafiku i momentit dhe fuqisë.');
  await shootPanel(page, '#health', 'D-03-gjendja-tema-e-erret', 'Tema e errët: kontrolli i gjendjes së makinës.');
  await shoot(page, 'D-04-faqja-e-plote-tema-e-erret', 'Tema e errët: ekrani i plotë i rezultatit.', { fullPage: true });
}

/** The exported PDF itself, saved beside the figures as an appendix. */
async function exportPdf(page, experiment) {
  console.log('\nPDF report');
  await open(page, 'sq', 'light');
  await analyse(page, experiment);
  await waitForAi(page);
  // The PDF is built in the browser and handed to a blob URL; capturing the blob
  // is more reliable in a headless browser than a download.
  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    window.__pdf = null;
    URL.createObjectURL = (blob) => {
      if (blob instanceof Blob && blob.type.includes('pdf')) {
        window.__pdf = new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }
      return original(blob);
    };
  });
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /PDF/i.test(b.textContent))?.click();
  });
  await sleep(8000);
  const base64 = await page.evaluate(async () => (window.__pdf ? await window.__pdf : null));
  if (base64) {
    writeFileSync(join(OUT, 'raporti-eksperimenti-A.pdf'), Buffer.from(base64, 'base64'));
    console.log('  raporti-eksperimenti-A.pdf');
  } else {
    console.log('  (PDF not captured)');
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    defaultViewport: { width: 1440, height: 1000, deviceScaleFactor: 2 },
    args: ['--force-device-scale-factor=2', '--hide-scrollbars'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  page error:', e.message));

  await experimentFigures(page, EXPERIMENTS.A, 'sq');
  await experimentFigures(page, EXPERIMENTS.B, 'sq');
  await experimentFigures(page, EXPERIMENTS.A, 'en');
  await darkFigures(page, EXPERIMENTS.A);
  await exportPdf(page, EXPERIMENTS.A);

  const lines = [
    '# Figurat — TuneVerdict',
    '',
    `Gjeneruar nga \`scripts/figures.mjs\`, Chrome 1440×1000 @2×, tema e ndritshme (përveç serisë D).`,
    '',
    `Eksperimenti A: ${EXPERIMENTS.A.title}. Eksperimenti B: ${EXPERIMENTS.B.title}.`,
    '',
    '| Skedari | Titulli i propozuar |',
    '| --- | --- |',
    ...captions.map((c) => `| \`${c.name}.png\` | ${c.caption} |`),
  ];
  writeFileSync(join(OUT, 'figurat.md'), lines.join('\n'), 'utf-8');
  await browser.close();
  console.log('\nSaved to ' + OUT);
}

await main();
