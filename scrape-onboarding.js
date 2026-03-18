// scrape-onboarding.js
// Opens each onboarding URL in a real Chromium browser (headed).
// If a page requires login, it pauses and waits for you to log in manually.
// Extracts page text content and saves to output/ folder.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const OUTPUT_DIR = path.join(__dirname, 'output', 'onboarding-content');

function askUser(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

const URLS = [
  {
    name: '01-main-onboarding-doc',
    url: 'https://docs.google.com/document/d/1yOj0K7cbgGXVp7ppfmhT7Mel2QPTXRgfGlQvy9jy4ew/edit?pli=1&tab=t.0',
    type: 'google-doc'
  },
  {
    name: '02-design-doc-template',
    url: 'https://docs.google.com/document/d/19XfMtEVeuVDQ1aRLS88SpBYKTyRBWRQS628KL4lOpno/edit?usp=sharing',
    type: 'google-doc'
  },
  {
    name: '03-miro-newum-board',
    url: 'https://miro.com/app/board/uXjVGVycF3Y=/',
    type: 'miro'
  },
  {
    name: '04-miro-rachel-board',
    url: 'https://miro.com/app/board/uXjVJUOanb0=/?moveToWidget=3458764651332971013&cot=14',
    type: 'miro'
  },
  {
    name: '05-azure-devops-newum',
    url: 'https://dev.azure.com/oncologyanalytics/newUM',
    type: 'azure'
  },
  {
    name: '06-atlassian-sprint-planning',
    url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM',
    type: 'atlassian'
  },
  {
    name: '07-sharepoint-raid',
    url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ',
    type: 'sharepoint'
  },
  {
    name: '08-sharepoint-change-request',
    url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB',
    type: 'sharepoint'
  },
  {
    name: '09-databricks-dev',
    url: 'https://adb-2393860672770324.4.azuredatabricks.net/',
    type: 'databricks'
  }
];

async function waitForLogin(page, name) {
  // Check if we hit a login page
  const url = page.url();
  const loginIndicators = ['login', 'signin', 'ServiceLogin', 'oauth', 'authorize', 'accounts.google'];
  const isLogin = loginIndicators.some(s => url.toLowerCase().includes(s.toLowerCase()));

  if (isLogin) {
    console.log(`\n⚠️  [${name}] Login required at: ${url}`);
    console.log(`    Please log in manually in the browser window.`);
    console.log(`    Complete the 2FA/Okta verification on your phone.`);
    console.log(`    Take your time — no rush.\n`);

    // Wait for user to press Enter in the terminal after completing login
    await askUser(`    >>> Press ENTER here when you have finished logging in for [${name}]... `);

    // Give the page a moment to load after login completes
    await page.waitForTimeout(5000);
    console.log(`✅  [${name}] Continuing after login...`);
  }
}

async function extractContent(page) {
  // Try to get readable text content
  const text = await page.evaluate(() => {
    // Remove scripts, styles, nav elements
    const remove = document.querySelectorAll('script, style, nav, header, footer, iframe');
    remove.forEach(el => el.remove());

    // For Google Docs, try the document content
    const docContent = document.querySelector('.kix-appview-editor');
    if (docContent) return docContent.innerText;

    // For Confluence/Atlassian
    const confContent = document.querySelector('#main-content, .wiki-content, [data-testid="renderer-container"]');
    if (confContent) return confContent.innerText;

    // For SharePoint
    const spContent = document.querySelector('[data-automation-id="pageContent"], .od-ItemContent, #WACViewPanel');
    if (spContent) return spContent.innerText;

    // Fallback: body text
    return document.body.innerText;
  });

  return text || '(no content extracted)';
}

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('🚀 Starting onboarding content scraper');
  console.log(`   Output: ${OUTPUT_DIR}`);
  console.log(`   URLs to fetch: ${URLS.length}\n`);

  // Use a persistent context so login sessions carry across pages
  const userDataDir = path.join(__dirname, 'output', '.browser-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    locale: 'en-US'
  });

  const results = [];

  for (const entry of URLS) {
    console.log(`\n📄 [${entry.name}] Opening: ${entry.url}`);

    const page = await context.newPage();

    try {
      await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // Check for login
      await waitForLogin(page, entry.name);

      // Wait for content to settle (SPAs need extra time)
      await page.waitForTimeout(5000);

      // Take screenshot
      const screenshotPath = path.join(OUTPUT_DIR, `${entry.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.log(`📸 [${entry.name}] Screenshot saved`);

      // Extract text content
      const content = await extractContent(page);
      const textPath = path.join(OUTPUT_DIR, `${entry.name}.txt`);
      fs.writeFileSync(textPath, `URL: ${entry.url}\nDate: ${new Date().toISOString()}\nType: ${entry.type}\n\n---\n\n${content}`);
      console.log(`📝 [${entry.name}] Content saved (${content.length} chars)`);

      results.push({ name: entry.name, url: entry.url, chars: content.length, status: 'ok' });
    } catch (err) {
      console.log(`❌ [${entry.name}] Error: ${err.message}`);
      results.push({ name: entry.name, url: entry.url, chars: 0, status: 'error', error: err.message });
    }

    await page.close();
  }

  // Summary
  console.log('\n\n═══════════════════════════════════════');
  console.log('  SCRAPE SUMMARY');
  console.log('═══════════════════════════════════════');
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}: ${r.chars} chars`);
  }

  // Save summary JSON
  fs.writeFileSync(
    path.join(OUTPUT_DIR, '_summary.json'),
    JSON.stringify(results, null, 2)
  );

  console.log(`\nAll files saved to: ${OUTPUT_DIR}`);
  console.log('Press Ctrl+C to close the browser or it will close in 10s...');

  await new Promise(r => setTimeout(r, 10000));
  await context.close();
})();
