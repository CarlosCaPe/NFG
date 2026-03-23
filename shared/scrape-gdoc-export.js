// scrape-gdoc-export.js — Export Google Docs as plain text via the /export URL
// Uses Edge browser with persistent session for auth
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const CLIENT_DIR = path.join(ROOT_DIR, 'clients', CLIENT);
const OUTPUT_DIR = path.join(CLIENT_DIR, 'output', 'onboarding-content');
const PROFILE_DIR = path.join(ROOT_DIR, '.playwright-session-gdoc');

const DOCS = [
  {
    name: '01-main-onboarding-doc',
    docId: '1yOj0K7cbgGXVp7ppfmhT7Mel2QPTXRgfGlQvy9jy4ew'
  },
  {
    name: '02-design-doc-template',
    docId: '19XfMtEVeuVDQ1aRLS88SpBYKTyRBWRQS628KL4lOpno'
  }
];

(async () => {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
    locale: 'en-US'
  });

  // Check if we need to login to Google first
  const testPage = await context.newPage();
  await testPage.goto('https://docs.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await testPage.waitForTimeout(3000);
  const isLoggedIn = await testPage.evaluate(() => {
    return !document.body.innerText.includes('Sign in') || document.querySelector('[aria-label="Google Account"]') !== null;
  });
  await testPage.close();

  if (!isLoggedIn) {
    console.log('⚠️  Not logged into Google. Opening login page — please sign in manually...');
    const loginPage = await context.newPage();
    await loginPage.goto('https://accounts.google.com/signin', { waitUntil: 'domcontentloaded' });
    console.log('📱 Waiting 60s for manual Google login...');
    for (let i = 0; i < 12; i++) {
      await loginPage.waitForTimeout(5000);
      const url = loginPage.url();
      if (url.includes('myaccount.google.com') || url.includes('drive.google.com') || url.includes('docs.google.com')) {
        console.log('✅ Google login detected!');
        break;
      }
      console.log(`  [${(i+1)*5}s] Waiting for login...`);
    }
    await loginPage.close();
  } else {
    console.log('✅ Already logged into Google');
  }

  for (const doc of DOCS) {
    // Google Docs export as plain text
    const exportUrl = `https://docs.google.com/document/d/${doc.docId}/export?format=txt`;
    console.log(`\n[${doc.name}] Exporting from: ${exportUrl}`);

    const page = await context.newPage();

    try {
      // Set up download handler before navigation
      const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
      await page.goto(exportUrl, { timeout: 30000 }).catch(() => {}); // goto may throw on download
      const download = await downloadPromise;

      const downloadPath = path.join(OUTPUT_DIR, `${doc.name}.txt`);
      await download.saveAs(downloadPath);
      const content = fs.readFileSync(downloadPath, 'utf-8');
      console.log(`[${doc.name}] OK — ${content.length} chars saved`);
    } catch (e) {
      console.log(`[${doc.name}] Download failed, trying direct page content...`);

      try {
        // If not a download, maybe it rendered as text in the page
        await page.goto(exportUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(5000);
        const text = await page.evaluate(() => document.body.innerText || document.body.textContent);
        if (text && text.length > 100) {
          fs.writeFileSync(path.join(OUTPUT_DIR, `${doc.name}.txt`), text);
          console.log(`[${doc.name}] OK (page text) — ${text.length} chars saved`);
        } else {
          console.log(`[${doc.name}] NO — content too short (${(text||'').length} chars)`);
        }
      } catch (e2) {
        console.log(`[${doc.name}] ERROR — ${e2.message}`);
      }
    }

    await page.close();
  }

  await context.close();
  console.log('\nDone.');
})();
