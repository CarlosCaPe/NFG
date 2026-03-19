/**
 * Microsoft SSO Scraper — Sequential scraper for all Microsoft-authenticated services.
 * 
 * Strategy: Opens ONE Playwright browser with persistent context (saved cookies).
 * First URL triggers Microsoft SSO login. After you authenticate once,
 * ALL subsequent Microsoft services share the session.
 *
 * Usage:
 *   node scrape-microsoft.js           → Start from Azure DevOps (#05)
 *   node scrape-microsoft.js 6         → Start from Atlassian (#06)
 *   node scrape-microsoft.js 9         → Only Databricks (#09)
 *
 * Auth: ccarrillo@oncologyanalytics.com (Microsoft SSO)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const SESSION_DIR = path.join(__dirname, '.playwright-session-microsoft');

const SERVICES = [
  {
    idx: 5,
    name: '05-azure-devops-newum',
    url: 'https://dev.azure.com/oncologyanalytics/newUM',
    type: 'azure-devops',
    description: 'Azure DevOps — newUM project',
  },
  {
    idx: 6,
    name: '06-atlassian-sprint-planning',
    url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM',
    type: 'atlassian',
    description: 'Atlassian Confluence — Sprint Planning',
  },
  {
    idx: 7,
    name: '07-sharepoint-raid',
    url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ',
    type: 'sharepoint',
    description: 'SharePoint — RAID Log (Excel)',
  },
  {
    idx: 8,
    name: '08-sharepoint-change-request',
    url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB',
    type: 'sharepoint',
    description: 'SharePoint — Change Request (Word)',
  },
  {
    idx: 9,
    name: '09-databricks-dev',
    url: 'https://adb-2393860672770324.4.azuredatabricks.net/',
    type: 'databricks',
    description: 'Databricks Dev Workspace',
  },
];

const startIdx = parseInt(process.argv[2] || '5', 10);

async function waitForAuth(page, maxWaitMs = 180000) {
  const loginPatterns = [
    'Sign in', 'Pick an account', 'Enter password', 'Enter your',
    'Okta Verify', 'Send push', 'Approve a request',
    'More information required', 'Stay signed in',
  ];

  const startTime = Date.now();
  let lastStatus = '';

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(5000);

    const url = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

    // Check for "Stay signed in?" prompt and auto-click Yes
    try {
      const staySignedIn = await page.$('input[value="Yes"]');
      if (staySignedIn) {
        await staySignedIn.click();
        console.log('  → Auto-clicked "Stay signed in? Yes"');
        await page.waitForTimeout(3000);
        continue;
      }
    } catch (e) { /* ignore */ }

    const foundLogin = loginPatterns.filter(p => bodyText.includes(p));
    const status = foundLogin.length > 0
      ? `AUTH: ${foundLogin.join(', ')}`
      : `LOADED (${bodyText.length} chars)`;

    if (status !== lastStatus) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      console.log(`  [${elapsed}s] ${status} | URL: ${url.substring(0, 80)}`);
      lastStatus = status;
    }

    // If no login patterns and we have content, we're in
    if (foundLogin.length === 0 && bodyText.length > 100) {
      return true;
    }
  }
  return false;
}

async function captureContent(page, service) {
  console.log(`\n📸 Capturing: ${service.name}`);

  // Screenshot
  const screenshotPath = path.join(OUT_DIR, `${service.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Screenshot: ${screenshotPath}`);

  // Full text content
  const allText = await page.evaluate(() => {
    const texts = [];

    // Body text
    const body = document.body?.innerText || '';
    if (body.length > 10) texts.push(body);

    // Iframes content (if accessible)
    try {
      const iframes = document.querySelectorAll('iframe');
      iframes.forEach((iframe, i) => {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc?.body) {
            const iText = iframeDoc.body.innerText;
            if (iText && iText.length > 50) {
              texts.push(`\n=== IFRAME ${i} ===\n${iText}`);
            }
          }
        } catch (e) { /* cross-origin */ }
      });
    } catch (e) { /* ignore */ }

    // Meta tags
    const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
      .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`)
      .filter(Boolean);
    if (meta.length > 0) texts.push(`\n=== META ===\nTitle: ${document.title}\n${meta.join('\n')}`);

    return texts.join('\n\n');
  });

  const txtPath = path.join(OUT_DIR, `${service.name}.txt`);
  fs.writeFileSync(txtPath, allText, 'utf-8');
  console.log(`  Text: ${txtPath} (${allText.length} chars)`);

  return allText.length;
}

(async () => {
  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('========================================');
  console.log('  Microsoft SSO Sequential Scraper');
  console.log('  Auth: ccarrillo@oncologyanalytics.com');
  console.log('========================================');
  console.log(`\nSession dir: ${SESSION_DIR}`);
  console.log('Session cookies persist between runs!\n');

  // Filter services starting from the requested index
  const toProcess = SERVICES.filter(s => s.idx >= startIdx);
  console.log(`Services to process: ${toProcess.map(s => `#${s.idx}`).join(', ')}\n`);

  // Launch persistent context (cookies survive across runs)
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const results = [];

  for (const service of toProcess) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  #${service.idx}: ${service.description}`);
    console.log(`  URL: ${service.url}`);
    console.log('='.repeat(50));

    const page = context.pages()[0] || await context.newPage();

    try {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`  Navigation: ${e.message.substring(0, 80)}`);
    }

    // Wait for 3 min for auth on first service, 30s for subsequent (session should persist)
    const isFirst = service === toProcess[0];
    const maxWait = isFirst ? 180000 : 60000;

    console.log(`\n>>> ${isFirst ? 'Please authenticate in the browser (3 min timeout)' : 'Checking if session is active (1 min timeout)'}...`);

    const authenticated = await waitForAuth(page, maxWait);

    if (authenticated) {
      const chars = await captureContent(page, service);
      results.push({ ...service, status: 'OK', chars });
      console.log(`\n✅ #${service.idx} captured successfully (${chars} chars)`);
    } else {
      // Save whatever we have anyway
      const chars = await captureContent(page, service);
      results.push({ ...service, status: 'PARTIAL', chars });
      console.log(`\n⚠️ #${service.idx} may not be fully loaded (${chars} chars)`);
    }

    // Brief pause between services
    if (service !== toProcess[toProcess.length - 1]) {
      console.log('\n>>> Moving to next service in 5 seconds...');
      await page.waitForTimeout(5000);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(50));
  console.log('  RESULTS SUMMARY');
  console.log('='.repeat(50));
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : '⚠️';
    console.log(`  ${icon} #${r.idx} ${r.name}: ${r.chars} chars`);
  }

  // Save results
  const resultsPath = path.join(OUT_DIR, '_microsoft-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nResults saved: ${resultsPath}`);

  console.log('\n>>> Browser closing in 10 seconds...');
  await context.pages()[0]?.waitForTimeout(10000);
  await context.close();
})();
