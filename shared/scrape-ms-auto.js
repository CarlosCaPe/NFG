/**
 * Microsoft SSO Auto-Login Scraper
 * Reads credentials from .env, auto-fills Microsoft login, handles Okta MFA.
 * After auth, scrapes all Microsoft-authenticated services sequentially.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const SESSION_DIR = path.join(__dirname, '.playwright-session-ms-auto');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const MS_USER = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
if (!MS_USER || !MS_PASS) {
  console.error('MS_USERNAME and MS_PASSWORD must be set in .env');
  process.exit(1);
}

const SERVICES = [
  { idx: 5, name: '05-azure-devops-newum', url: 'https://dev.azure.com/oncologyanalytics/newUM', desc: 'Azure DevOps' },
  { idx: 6, name: '06-atlassian-sprint-planning', url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM', desc: 'Atlassian Confluence' },
  { idx: 7, name: '07-sharepoint-raid', url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ', desc: 'SharePoint RAID' },
  { idx: 8, name: '08-sharepoint-change-request', url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB', desc: 'SharePoint Change Request' },
  { idx: 9, name: '09-databricks-dev', url: 'https://adb-2393860672770324.4.azuredatabricks.net/', desc: 'Databricks Dev' },
];

const startIdx = parseInt(process.argv[2] || '5', 10);

async function autoLogin(page) {
  console.log('\n🔐 Auto-login: Microsoft SSO');

  // Wait for email input
  try {
    await page.waitForSelector('input[type="email"], input[name="loginfmt"]', { timeout: 10000 });
    console.log('  Entering username...');
    await page.fill('input[type="email"], input[name="loginfmt"]', MS_USER);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('  Email field not found or already past it');
  }

  // Check for Okta redirect
  const url = page.url();
  if (url.includes('okta.com') || url.includes('oktapreview.com')) {
    console.log('  Redirected to Okta...');
    await handleOkta(page);
    return;
  }

  // Wait for password input (Microsoft)
  try {
    await page.waitForSelector('input[type="password"], input[name="passwd"]', { timeout: 10000 });
    console.log('  Entering password...');
    await page.fill('input[type="password"], input[name="passwd"]', MS_PASS);
    await page.click('input[type="submit"], button[type="submit"]');
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('  Password field not found — might be Okta or already authenticated');
  }

  // Check again for Okta
  const url2 = page.url();
  if (url2.includes('okta.com') || url2.includes('oktapreview.com')) {
    await handleOkta(page);
    return;
  }

  // Handle "Stay signed in?" prompt
  await handleStaySignedIn(page);
}

async function handleOkta(page) {
  console.log('  🔑 Okta authentication...');

  // Username
  try {
    const userField = await page.$('input[name="identifier"], input[name="username"], #okta-signin-username');
    if (userField) {
      console.log('  Entering Okta username...');
      await userField.fill(MS_USER);
    }
  } catch (e) { /* ignore */ }

  // Submit username
  try {
    const submitBtn = await page.$('input[type="submit"], button[type="submit"], .o-form-button-bar input');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(3000);
  } catch (e) { /* ignore */ }

  // Password
  try {
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    console.log('  Entering Okta password...');
    await page.fill('input[type="password"]', MS_PASS);
    // Submit
    const submitBtn = await page.$('input[type="submit"], button[type="submit"]');
    if (submitBtn) await submitBtn.click();
    await page.waitForTimeout(3000);
  } catch (e) {
    console.log('  Okta password field not found');
  }

  // Check for MFA prompt
  const body = await page.evaluate(() => document.body?.innerText || '');
  if (body.includes('Okta Verify') || body.includes('Send push') || body.includes('Verify')) {
    console.log('  📱 MFA REQUIRED: Approve the Okta Verify push on your phone!');
    console.log('  Waiting up to 60 seconds...');

    // Wait for MFA to complete (URL changes away from Okta)
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      const currentUrl = page.url();
      if (!currentUrl.includes('okta.com') && !currentUrl.includes('oktapreview.com')) {
        console.log('  ✅ MFA approved!');
        break;
      }
      console.log(`  [${(i + 1) * 5}s] Still waiting for MFA...`);
    }
  }

  // Handle "Stay signed in?"
  await handleStaySignedIn(page);
}

async function handleStaySignedIn(page) {
  await page.waitForTimeout(2000);
  try {
    // Microsoft "Stay signed in?"
    const yesBtn = await page.$('input[value="Yes"], button:has-text("Yes")');
    if (yesBtn) {
      console.log('  → Auto-clicking "Stay signed in? Yes"');
      await yesBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) { /* ignore */ }

  // Atlassian "Accept" or consent
  try {
    const acceptBtn = await page.$('button:has-text("Accept"), button:has-text("Continue")');
    if (acceptBtn) {
      console.log('  → Auto-clicking Accept/Continue');
      await acceptBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch (e) { /* ignore */ }
}

async function waitUntilLoaded(page, maxWaitMs = 60000) {
  const loginPatterns = [
    'Sign in', 'Pick an account', 'Enter password',
    'Okta Verify', 'Send push', 'Approve a request',
    'Stay signed in', 'More information required',
  ];

  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(5000);
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');
    const url = page.url();

    // Auto-handle any login prompts that appear
    if (url.includes('login.microsoftonline.com')) {
      await autoLogin(page);
      continue;
    }
    if (url.includes('okta.com') || url.includes('oktapreview.com')) {
      await handleOkta(page);
      continue;
    }

    const foundLogin = loginPatterns.filter(p => body.includes(p));
    if (foundLogin.length === 0 && body.length > 100) {
      return true;
    }

    if (foundLogin.length > 0) {
      console.log(`  Still authenticating: ${foundLogin[0]}...`);
    }
  }
  return false;
}

async function capture(page, service) {
  const screenshotPath = path.join(OUT_DIR, `${service.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const allText = await page.evaluate(() => {
    const texts = [];
    const body = document.body?.innerText || '';
    if (body.length > 10) texts.push(body);
    try {
      document.querySelectorAll('iframe').forEach((iframe, i) => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc?.body?.innerText?.length > 50) texts.push(`\n=== IFRAME ${i} ===\n${doc.body.innerText}`);
        } catch (e) { /* cross-origin */ }
      });
    } catch (e) { /* ignore */ }
    const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
      .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`).filter(Boolean);
    if (meta.length > 0) texts.push(`\n=== META ===\nTitle: ${document.title}\n${meta.join('\n')}`);
    return texts.join('\n\n');
  });

  const txtPath = path.join(OUT_DIR, `${service.name}.txt`);
  fs.writeFileSync(txtPath, allText, 'utf-8');
  console.log(`  📸 Screenshot: ${service.name}.png`);
  console.log(`  📝 Text: ${allText.length} chars`);
  return allText.length;
}

(async () => {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('========================================');
  console.log('  Microsoft Auto-Login Scraper');
  console.log('========================================\n');

  const toProcess = SERVICES.filter(s => s.idx >= startIdx);
  console.log(`Services: ${toProcess.map(s => `#${s.idx} ${s.desc}`).join(', ')}\n`);

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const results = [];

  for (const service of toProcess) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  #${service.idx}: ${service.desc}`);
    console.log('='.repeat(50));

    const page = context.pages()[0] || await context.newPage();

    try {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`  Nav: ${e.message.substring(0, 80)}`);
    }

    await page.waitForTimeout(3000);

    // Check if we need to login
    const url = page.url();
    if (url.includes('login.microsoftonline.com') || url.includes('okta.com') || url.includes('oktapreview.com')) {
      await autoLogin(page);
      await waitUntilLoaded(page, 90000);
    } else if (url.includes('id.atlassian.com')) {
      // Atlassian login — try Microsoft SSO button
      console.log('  Atlassian login detected...');
      try {
        const msBtn = await page.$('button:has-text("Microsoft"), a:has-text("Microsoft"), [data-testid="microsoft"]');
        if (msBtn) {
          console.log('  → Clicking "Sign in with Microsoft"');
          await msBtn.click();
          await page.waitForTimeout(3000);
          await autoLogin(page);
          await waitUntilLoaded(page, 90000);
        } else {
          // Try entering email
          const emailField = await page.$('#username, input[name="username"], input[type="email"]');
          if (emailField) {
            console.log('  → Entering email for Atlassian SSO...');
            await emailField.fill(MS_USER);
            const conBtn = await page.$('#login-submit, button[type="submit"]');
            if (conBtn) await conBtn.click();
            await page.waitForTimeout(5000);
            // Should redirect to Microsoft SSO
            if (page.url().includes('login.microsoftonline.com')) {
              await autoLogin(page);
            }
            await waitUntilLoaded(page, 90000);
          }
        }
      } catch (e) {
        console.log(`  Atlassian login error: ${e.message.substring(0, 80)}`);
      }
    } else {
      // Already authenticated or different auth
      await page.waitForTimeout(5000);
    }

    // Final wait for page to fully load
    await page.waitForTimeout(5000);

    const chars = await capture(page, service);
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
    const hasLogin = ['Sign in', 'Enter password', 'Okta Verify'].some(p => body.includes(p));

    results.push({
      idx: service.idx,
      name: service.name,
      desc: service.desc,
      status: hasLogin ? 'AUTH_WALL' : (chars > 200 ? 'OK' : 'PARTIAL'),
      chars,
    });

    console.log(`  Result: ${results[results.length - 1].status}`);

    if (service !== toProcess[toProcess.length - 1]) {
      console.log('\n  → Next service in 3 seconds...');
      await page.waitForTimeout(3000);
    }
  }

  console.log('\n\n' + '='.repeat(50));
  console.log('  RESULTS');
  console.log('='.repeat(50));
  for (const r of results) {
    const icon = r.status === 'OK' ? '✅' : r.status === 'PARTIAL' ? '⚠️' : '❌';
    console.log(`  ${icon} #${r.idx} ${r.desc}: ${r.chars} chars [${r.status}]`);
  }

  fs.writeFileSync(path.join(OUT_DIR, '_microsoft-results.json'), JSON.stringify(results, null, 2));
  console.log('\nBrowser closing in 10s...');
  await context.pages()[0]?.waitForTimeout(10000);
  await context.close();
})();
