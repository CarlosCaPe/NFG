/**
 * Okta SSO Auto-Login for OncoHealth
 * 
 * Login flow:
 * 1. Navigate to target URL
 * 2. Redirects to login.microsoftonline.com
 * 3. Enter email → redirects to sso.oncologyanalytics.com (Okta)
 * 4. Okta shows username + password fields
 * 5. Fill username (ccarrillo) + password → submit
 * 6. Okta Verify MFA push → approve on phone
 * 7. Redirects back to target
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const SESSION_DIR = path.join(__dirname, '.playwright-session-okta');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const MS_EMAIL = process.env.MS_USERNAME;     // ccarrillo@oncologyanalytics.com
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = MS_EMAIL.split('@')[0];     // ccarrillo

const SERVICES = [
  { idx: 5, name: '05-azure-devops-newum', url: 'https://dev.azure.com/oncologyanalytics/newUM', desc: 'Azure DevOps' },
  { idx: 6, name: '06-atlassian-sprint-planning', url: 'https://oncologyanalytics.atlassian.net/wiki/spaces/NewUM/pages/5140905985/2+Sprint+Planning+-+NewUM', desc: 'Atlassian Confluence' },
  { idx: 7, name: '07-sharepoint-raid', url: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ', desc: 'SharePoint RAID' },
  { idx: 8, name: '08-sharepoint-change-request', url: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB', desc: 'SharePoint CR' },
  { idx: 9, name: '09-databricks-dev', url: 'https://adb-2393860672770324.4.azuredatabricks.net/', desc: 'Databricks Dev' },
];

const startIdx = parseInt(process.argv[2] || '5', 10);

async function handleAuth(page) {
  for (let round = 0; round < 10; round++) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');

    console.log(`  [Auth round ${round}] URL: ${url.substring(0, 60)}...`);

    // ---- Microsoft login: enter email ----
    if (url.includes('login.microsoftonline.com')) {
      try {
        const emailField = await page.$('input[type="email"], input[name="loginfmt"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val) {
            console.log(`  → Filling Microsoft email: ${MS_EMAIL}`);
            await emailField.fill(MS_EMAIL);
            await page.waitForTimeout(500);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(4000);
            continue;
          }
        }
      } catch (e) { /* ignore */ }

      // "Stay signed in?" 
      try {
        const yesBtn = await page.$('input[value="Yes"]');
        if (yesBtn) {
          console.log('  → Clicking "Stay signed in? Yes"');
          await yesBtn.click();
          await page.waitForTimeout(3000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // Password on Microsoft (sometimes no Okta redirect)
      try {
        const passField = await page.$('input[type="password"][name="passwd"]');
        if (passField) {
          console.log('  → Filling Microsoft password');
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          await page.click('input[type="submit"]');
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // ---- Okta SSO (sso.oncologyanalytics.com) ----
    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      // Username field
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) {
          const val = await userField.inputValue();
          if (!val) {
            console.log(`  → Filling Okta username: ${OKTA_USER}`);
            await userField.fill(OKTA_USER);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      // Password field
      try {
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) {
          const val = await passField.inputValue();
          if (!val) {
            console.log('  → Filling Okta password');
            await passField.fill(MS_PASS);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      // Submit button
      try {
        const submitBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
        if (submitBtn) {
          console.log('  → Clicking Sign In');
          await submitBtn.click();
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // MFA / Okta Verify
      if (body.includes('Okta Verify') || body.includes('Send push') || body.includes('Push notification')) {
        // Try clicking "Send push" button
        try {
          const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")');
          if (pushBtn) {
            console.log('  → Clicking "Send Push"');
            await pushBtn.click();
          }
        } catch (e) { /* ignore */ }

        console.log('  📱 MFA: Approve Okta Verify push on your phone!');
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(5000);
          const currentUrl = page.url();
          if (!currentUrl.includes('okta.com') && !currentUrl.includes('sso.oncologyanalytics.com')) {
            console.log('  ✅ MFA approved! Redirecting...');
            await page.waitForTimeout(3000);
            return true;
          }
          console.log(`  [${(i + 1) * 5}s] Waiting for MFA approval...`);
        }
        console.log('  ❌ MFA timeout');
        return false;
      }
    }

    // ---- Atlassian login ----
    if (url.includes('id.atlassian.com') || url.includes('atlassian.com/login')) {
      try {
        const emailField = await page.$('#username, input[name="username"], input[name="email"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val) {
            console.log(`  → Filling Atlassian email: ${MS_EMAIL}`);
            await emailField.fill(MS_EMAIL);
            await page.waitForTimeout(500);
          }
          // Atlassian uses button#login-submit with type="button" (not submit!)
          const submitBtn = await page.$('#login-submit, button:has-text("Continue"), button:has-text("Log in"), button[type="submit"]');
          if (submitBtn) {
            console.log('  → Clicking Continue/Log in');
            await submitBtn.click();
            await page.waitForTimeout(5000);
            continue;
          } else {
            // Try pressing Enter as fallback
            console.log('  → No submit button found, pressing Enter');
            await emailField.press('Enter');
            await page.waitForTimeout(5000);
            continue;
          }
        }
      } catch (e) { console.log(`  Atlassian auth error: ${e.message.substring(0, 80)}`); }

      // Atlassian password page (after email, before SSO redirect)
      try {
        const passField = await page.$('#password, input[name="password"], input[type="password"]');
        if (passField) {
          console.log('  → Filling Atlassian password');
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          const submitBtn = await page.$('#login-submit, button:has-text("Log in"), button[type="submit"]');
          if (submitBtn) await submitBtn.click();
          else await passField.press('Enter');
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // ---- Databricks login ----
    if (url.includes('databricks.net/login')) {
      // Databricks usually has a "Sign in with SSO" or auto-redirects
      await page.waitForTimeout(5000);
      continue;
    }

    // ---- Check if we're actually loaded (no more auth) ----
    const noAuth = !url.includes('login') && !url.includes('okta') && !url.includes('sso.') &&
                   !url.includes('id.atlassian.com') && body.length > 200;
    if (noAuth) {
      console.log('  ✅ Authenticated and loaded!');
      return true;
    }
  }
  return false;
}

async function capture(page, service) {
  await page.screenshot({ path: path.join(OUT_DIR, `${service.name}.png`), fullPage: false });

  const allText = await page.evaluate(() => {
    const texts = [];
    const body = document.body?.innerText || '';
    if (body.length > 10) texts.push(body);
    try {
      document.querySelectorAll('iframe').forEach((iframe, i) => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc?.body?.innerText?.length > 50) texts.push(`\n=== IFRAME ${i} ===\n${doc.body.innerText}`);
        } catch (e) {}
      });
    } catch (e) {}
    const meta = Array.from(document.querySelectorAll('meta[name], meta[property]'))
      .map(m => `${m.getAttribute('name') || m.getAttribute('property')}: ${m.getAttribute('content')}`).filter(Boolean);
    if (meta.length) texts.push(`\n=== META ===\nTitle: ${document.title}\n${meta.join('\n')}`);
    return texts.join('\n\n');
  });

  fs.writeFileSync(path.join(OUT_DIR, `${service.name}.txt`), allText, 'utf-8');
  console.log(`  📸 ${service.name}.png | 📝 ${allText.length} chars`);
  return allText.length;
}

(async () => {
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  const toProcess = SERVICES.filter(s => s.idx >= startIdx);
  console.log(`\n🚀 Okta Auto-Login Scraper\n`);
  console.log(`Target services: ${toProcess.map(s => `#${s.idx}`).join(', ')}`);
  console.log(`Auth: ${MS_EMAIL} → Okta SSO → ${OKTA_USER}\n`);

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const results = [];

  for (const service of toProcess) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`#${service.idx}: ${service.desc}`);
    console.log(`URL: ${service.url.substring(0, 80)}`);
    console.log('─'.repeat(50));

    const page = context.pages()[0] || await context.newPage();

    try {
      await page.goto(service.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      console.log(`  Nav warning: ${e.message.substring(0, 60)}`);
    }

    await page.waitForTimeout(3000);
    const authed = await handleAuth(page);
    
    // Extra wait for SPAs (Azure DevOps, SharePoint, etc.)
    console.log('  ⏳ Waiting for SPA content to load...');
    await page.waitForTimeout(8000);
    
    // For Azure DevOps: try to expand/navigate to meaningful content
    if (service.url.includes('dev.azure.com')) {
      try {
        // Try clicking on Wiki or Summary link if visible
        const wikiLink = await page.$('a[href*="wiki"], a[href*="Wiki"]');
        if (wikiLink) {
          console.log('  → Clicking Wiki link...');
          await wikiLink.click();
          await page.waitForTimeout(5000);
        }
      } catch (e) { /* ignore */ }
    }

    const chars = await capture(page, service);
    results.push({ idx: service.idx, name: service.name, desc: service.desc, authed, chars });

    if (service !== toProcess[toProcess.length - 1]) {
      await page.waitForTimeout(2000);
    }
  }

  console.log(`\n\n${'═'.repeat(50)}`);
  console.log('RESULTS');
  console.log('═'.repeat(50));
  for (const r of results) {
    const icon = r.authed ? '✅' : '❌';
    console.log(`${icon} #${r.idx} ${r.desc}: ${r.chars} chars`);
  }

  fs.writeFileSync(path.join(OUT_DIR, '_ms-auto-results.json'), JSON.stringify(results, null, 2));
  console.log('\nClosing in 10s...');
  await context.pages()[0]?.waitForTimeout(10000);
  await context.close();
})();
