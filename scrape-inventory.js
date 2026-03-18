// scrape-inventory.js — Fast inventory: check access to each URL, extract what's possible, skip what's not.
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

const LOGIN_PATTERNS = [
  'login', 'signin', 'servicelogin', 'oauth', 'authorize',
  'accounts.google', 'microsoftonline.com', 'id.atlassian.com',
  'okta', 'sso.', 'login.html'
];

const ACCESS_DENIED_PATTERNS = [
  'you need access', 'request access', 'access denied', 'forbidden',
  'private board', 'sign up for free in order to access',
  'request sent', 'permission', '403', 'not authorized'
];

function detectStatus(url, bodyText) {
  const urlLower = url.toLowerCase();
  const textLower = (bodyText || '').toLowerCase();

  // Check login wall
  if (LOGIN_PATTERNS.some(p => urlLower.includes(p))) return 'NO_ACCESS_LOGIN_WALL';

  // Check access denied in page text
  if (ACCESS_DENIED_PATTERNS.some(p => textLower.includes(p))) return 'NO_ACCESS_DENIED';

  // If very little content, probably not loaded
  if (bodyText && bodyText.trim().length < 50) return 'NO_CONTENT';

  return 'OK';
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('=== ONBOARDING LINK INVENTORY ===');
  console.log(`Checking ${URLS.length} URLs...\n`);

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US'
  });

  const results = [];

  for (const entry of URLS) {
    process.stdout.write(`[${entry.name}] ... `);

    const page = await context.newPage();
    let status = 'ERROR';
    let chars = 0;
    let bodyText = '';

    try {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(5000); // 5s for page to settle

      const finalUrl = page.url();
      bodyText = await page.evaluate(() => document.body.innerText).catch(() => '');
      chars = bodyText.length;
      status = detectStatus(finalUrl, bodyText);

      // Screenshot regardless
      await page.screenshot({ path: path.join(OUTPUT_DIR, `${entry.name}.png`), fullPage: true }).catch(() => {});

      // Save text if we got real content
      if (status === 'OK' && chars > 50) {
        fs.writeFileSync(
          path.join(OUTPUT_DIR, `${entry.name}.txt`),
          `URL: ${entry.url}\nFinal URL: ${finalUrl}\nDate: ${new Date().toISOString()}\nStatus: ${status}\n\n---\n\n${bodyText}`
        );
      }
    } catch (err) {
      status = 'ERROR';
      bodyText = err.message;
    }

    try { await page.close(); } catch (_) {}

    const icon = status === 'OK' ? 'YES' : 'NO';
    const reason = status === 'OK' ? `${chars} chars` : status;
    console.log(`${icon} — ${reason}`);

    results.push({ name: entry.name, url: entry.url, type: entry.type, access: icon, status, chars });
  }

  // Summary
  console.log('\n\n========================================');
  console.log('  ACCESS INVENTORY SUMMARY');
  console.log('========================================');
  const yes = results.filter(r => r.access === 'YES');
  const no = results.filter(r => r.access === 'NO');
  console.log(`  ACCESS: ${yes.length}/${results.length}`);
  console.log(`  BLOCKED: ${no.length}/${results.length}\n`);

  for (const r of results) {
    const icon = r.access === 'YES' ? '[OK]' : '[--]';
    console.log(`  ${icon} ${r.name}: ${r.status}`);
  }

  // Save inventory JSON
  const inventoryPath = path.join(OUTPUT_DIR, '_inventory.json');
  fs.writeFileSync(inventoryPath, JSON.stringify(results, null, 2));
  console.log(`\nInventory saved: ${inventoryPath}`);

  await context.close();
})();
