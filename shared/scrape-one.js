// scrape-one.js — Opens a single URL, waits for login, extracts content.
// Usage: node scrape-one.js <index>   (0-8, matches URLS array)

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const PROFILE_DIR = path.join(__dirname, 'output', '.browser-profile');

const URLS = [
  { name: '01-main-onboarding-doc', url: 'https://docs.google.com/document/d/1yOj0K7cbgGXVp7ppfmhT7Mel2QPTXRgfGlQvy9jy4ew/edit?pli=1&tab=t.0', type: 'google-doc' },
  { name: '02-design-doc-template', url: 'https://docs.google.com/document/d/19XfMtEVeuVDQ1aRLS88SpBYKTyRBWRQS628KL4lOpno/edit?usp=sharing', type: 'google-doc' },
  { name: '03-miro-newum-board', url: 'https://miro.com/app/board/uXjVGVycF3Y=/', type: 'miro' },
  { name: '04-miro-rachel-board', url: 'https://miro.com/app/board/uXjVJUOanb0=/?moveToWidget=3458764651332971013&cot=14', type: 'miro' },
  { name: '05-azure-devops-newum', url: 'https://dev.azure.com/oncologyanalytics/newUM', type: 'azure' },
  { name: '06-atlassian-sprint-planning', url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM', type: 'atlassian' },
  { name: '07-sharepoint-raid', url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ', type: 'sharepoint' },
  { name: '08-sharepoint-change-request', url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB', type: 'sharepoint' },
  { name: '09-databricks-dev', url: 'https://adb-2393860672770324.4.azuredatabricks.net/', type: 'databricks' }
];

(async () => {
  const idx = parseInt(process.argv[2], 10);
  if (isNaN(idx) || idx < 0 || idx >= URLS.length) {
    console.log('Usage: node scrape-one.js <index>');
    URLS.forEach((u, i) => console.log(`  ${i} = ${u.name}`));
    process.exit(1);
  }

  const entry = URLS[idx];
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`\nOpening [${entry.name}]`);
  console.log(`URL: ${entry.url}`);
  console.log(`\nBrowser will open. Log in with 2FA if needed.`);
  console.log(`When the page is FULLY LOADED, come back here and press Ctrl+C.\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US'
  });

  const page = await context.newPage();
  await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Keep checking and saving every 10 seconds until user kills it
  let saveCount = 0;
  const interval = setInterval(async () => {
    try {
      saveCount++;
      // Screenshot
      const screenshotPath = path.join(OUTPUT_DIR, `${entry.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Text extraction
      const text = await page.evaluate(() => {
        const remove = document.querySelectorAll('script, style, nav, iframe');
        remove.forEach(el => el.remove());
        const doc = document.querySelector('.kix-appview-editor');
        if (doc) return doc.innerText;
        const conf = document.querySelector('#main-content, .wiki-content, [data-testid="renderer-container"]');
        if (conf) return conf.innerText;
        const sp = document.querySelector('[data-automation-id="pageContent"], .od-ItemContent, #WACViewPanel');
        if (sp) return sp.innerText;
        return document.body.innerText;
      });

      const textPath = path.join(OUTPUT_DIR, `${entry.name}.txt`);
      fs.writeFileSync(textPath, `URL: ${entry.url}\nDate: ${new Date().toISOString()}\nType: ${entry.type}\n\n---\n\n${text}`);
      console.log(`  [save #${saveCount}] ${text.length} chars captured`);
    } catch (e) {
      console.log(`  [save #${saveCount}] error: ${e.message}`);
    }
  }, 10000);

  // On Ctrl+C, do final save and exit
  process.on('SIGINT', async () => {
    clearInterval(interval);
    console.log('\n\nFinal save...');
    try {
      const screenshotPath = path.join(OUTPUT_DIR, `${entry.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      const text = await page.evaluate(() => document.body.innerText);
      const textPath = path.join(OUTPUT_DIR, `${entry.name}.txt`);
      fs.writeFileSync(textPath, `URL: ${entry.url}\nDate: ${new Date().toISOString()}\nType: ${entry.type}\n\n---\n\n${text}`);
      console.log(`Final: ${text.length} chars saved to ${entry.name}.txt`);
    } catch (e) { /* ignore */ }
    await context.close();
    process.exit(0);
  });
})();
