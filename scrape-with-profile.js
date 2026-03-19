const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// ============================================
// PROFILE MAPPING
// ============================================
// Google services (Miro, Google Docs) → Profile 1 (newfireglobal.com)
// Microsoft services (Azure DevOps, SharePoint, Atlassian, Databricks) → Profile 2 or Default
// ============================================

const CHROME_USER_DATA = path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
const PROFILES = {
  google: 'Profile 1',   // carlos.carrillo@newfireglobal.com
  microsoft: 'Default',  // Will update if OncoHealth profile found
};

const ALL_URLS = [
  { idx: 3, name: '03-miro-newum-board', url: 'https://miro.com/app/board/uXjVGVycF3Y=/', provider: 'google' },
  { idx: 4, name: '04-miro-rachel-board', url: 'https://miro.com/app/board/uXjVJUOanb0=/?moveToWidget=3458764651332971013&cot=14', provider: 'google' },
  { idx: 5, name: '05-azure-devops-newum', url: 'https://dev.azure.com/oncologyanalytics/newUM', provider: 'microsoft' },
  { idx: 6, name: '06-atlassian-sprint-planning', url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM', provider: 'microsoft' },
  { idx: 7, name: '07-sharepoint-raid', url: 'https://oncologyanalytics.sharepoint.com/:x:/r/sites/newUM/_layouts/15/Doc.aspx?sourcedoc=%7B98E07A60-FA16-4C2A-8B1E-03E3F430BA37%7D', provider: 'microsoft' },
  { idx: 8, name: '08-sharepoint-change-request', url: 'https://oncologyanalytics.sharepoint.com/:x:/r/sites/newUM/_layouts/15/Doc.aspx?sourcedoc=%7BE65F2BC2-7AB6-4F1C-A313-16C6FEFDF3CF%7D', provider: 'microsoft' },
  { idx: 9, name: '09-databricks-dev', url: 'https://adb-2393860672770324.4.azuredatabricks.net/', provider: 'microsoft' },
];

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const targetIdx = parseInt(process.argv[2] || '3', 10);

(async () => {
  const entry = ALL_URLS.find(u => u.idx === targetIdx);
  if (!entry) {
    console.log(`Invalid index ${targetIdx}. Valid: ${ALL_URLS.map(u => u.idx).join(', ')}`);
    return;
  }

  const profileDir = PROFILES[entry.provider];
  const channelPath = path.join(CHROME_USER_DATA, '..', '..', '..', '..'); // not needed, using user-data-dir

  console.log(`\n========================================`);
  console.log(`  Target: ${entry.name}`);
  console.log(`  URL: ${entry.url}`);
  console.log(`  Provider: ${entry.provider}`);
  console.log(`  Chrome Profile: ${profileDir}`);
  console.log(`========================================`);
  console.log(`\n⚠️  IMPORTANT: Close Chrome completely before running this!`);
  console.log(`   Playwright needs exclusive access to the profile.\n`);

  let browser;
  try {
    // Launch Chrome with the user's actual profile (has cookies/sessions)
    browser = await chromium.launchPersistentContext(
      path.join(CHROME_USER_DATA, profileDir),
      {
        headless: false,
        channel: 'chrome',  // Use installed Chrome, not Playwright's Chromium
        viewport: { width: 1400, height: 900 },
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-first-run',
        ],
        timeout: 30000,
      }
    );
  } catch (err) {
    if (err.message.includes('already in use') || err.message.includes('lock')) {
      console.log(`\n❌ ERROR: Chrome is still running with this profile.`);
      console.log(`   Please close ALL Chrome windows and try again.\n`);
      return;
    }
    throw err;
  }

  const page = browser.pages()[0] || await browser.newPage();

  console.log(`>>> Navigating to ${entry.url}...`);
  console.log(`>>> You have 2 MINUTES. Script checks every 10 seconds.\n`);

  try {
    await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.log(`Navigation warning: ${e.message.substring(0, 100)}`);
  }

  let captured = false;
  for (let attempt = 1; attempt <= 12; attempt++) {
    await page.waitForTimeout(10000);

    const currentUrl = page.url();
    const title = await page.title();
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const chars = bodyText.length;

    console.log(`[Check ${attempt}/12] ${chars} chars | Title: ${title}`);
    console.log(`  URL: ${currentUrl.substring(0, 100)}`);

    // Detect login walls
    const loginPatterns = ['Sign up', 'Sign in', 'Log in', 'This is a private board',
      'Enter your work email', 'Pick an account', 'Enter password',
      'Okta Verify', 'Send push', 'Sign in to your account'];
    const foundLogin = loginPatterns.filter(p => bodyText.includes(p));
    if (foundLogin.length > 0) {
      console.log(`  ⚠️  Login/Auth detected: ${foundLogin.join(', ')}`);
      console.log(`  >>> Authenticate in the browser window...`);
      continue;
    }

    // --- MIRO detection ---
    if (entry.url.includes('miro.com')) {
      const miroInfo = await page.evaluate(() => {
        const canvases = document.querySelectorAll('canvas');
        return { canvasCount: canvases.length, hasApp: !!document.querySelector('#miro-app') };
      });
      if (miroInfo.canvasCount > 0 || miroInfo.hasApp) {
        console.log(`\n✅ Miro board loaded! (${miroInfo.canvasCount} canvases)`);
        captured = true;
        break;
      }
    }

    // --- Azure DevOps detection ---
    if (entry.url.includes('dev.azure.com')) {
      if (chars > 500 && !foundLogin.length) {
        console.log(`\n✅ Azure DevOps loaded! (${chars} chars)`);
        captured = true;
        break;
      }
    }

    // --- Atlassian / Confluence detection ---
    if (entry.url.includes('atlassian.net')) {
      if (chars > 300 && !foundLogin.length) {
        console.log(`\n✅ Atlassian page loaded! (${chars} chars)`);
        captured = true;
        break;
      }
    }

    // --- SharePoint detection ---
    if (entry.url.includes('sharepoint.com')) {
      if (chars > 200 && !foundLogin.length) {
        console.log(`\n✅ SharePoint loaded! (${chars} chars)`);
        captured = true;
        break;
      }
    }

    // --- Databricks detection ---
    if (entry.url.includes('databricks.net')) {
      if (chars > 200 && !foundLogin.length) {
        console.log(`\n✅ Databricks loaded! (${chars} chars)`);
        captured = true;
        break;
      }
    }

    // Generic: lots of content = probably loaded
    if (chars > 1000 && !foundLogin.length) {
      console.log(`\n✅ Page loaded with ${chars} chars of content!`);
      captured = true;
      break;
    }
  }

  // ---- CAPTURE ----
  // Screenshot
  const screenshotPath = path.join(OUT_DIR, `${entry.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`📸 Screenshot: ${screenshotPath}`);

  // Text content
  const allText = await page.evaluate(() => {
    const texts = [];
    const body = document.body?.innerText || '';
    if (body.length > 10) texts.push(body);

    // Aria labels
    const ariaEls = document.querySelectorAll('[aria-label]');
    const ariaLabels = Array.from(ariaEls).map(el => el.getAttribute('aria-label')).filter(Boolean);
    if (ariaLabels.length > 5) texts.push('\n=== ARIA LABELS ===\n' + ariaLabels.join('\n'));

    // Meta
    const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
      .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`)
      .filter(Boolean);
    if (meta.length > 0) texts.push('\n=== META ===\n' + `Title: ${document.title}\n` + meta.join('\n'));

    return texts.join('\n\n');
  });

  const txtPath = path.join(OUT_DIR, `${entry.name}.txt`);
  fs.writeFileSync(txtPath, allText, 'utf-8');
  console.log(`📝 Text: ${txtPath} (${allText.length} chars)`);

  if (captured) {
    console.log(`\n✅ Successfully captured ${entry.name}`);
  } else {
    console.log(`\n❌ Could not fully load ${entry.name} after 2 minutes`);
  }

  console.log(`\n>>> Browser stays open 15 more seconds...`);
  await page.waitForTimeout(15000);
  await browser.close();
})();
