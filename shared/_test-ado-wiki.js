/**
 * Quick diagnostic: test ADO wiki + git repo endpoints
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SESSION_DIR = path.join(ROOT, '.playwright-session-ado');

// Load .env
const envPath = path.join(ROOT, 'clients', 'oncohealth', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = (MS_EMAIL || '').split('@')[0];

async function waitForAuth(page, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(3000);
    const url = page.url();
    const elapsed = Math.round((Date.now() - start) / 1000);

    if (url.includes('dev.azure.com') && !url.includes('login')) {
      console.log(`  [${elapsed}s] ✓ Authenticated at ADO`);
      return true;
    }

    // Microsoft email
    if (url.includes('login.microsoftonline.com')) {
      try {
        const emailField = await page.$('input[type="email"], input[name="loginfmt"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val && MS_EMAIL) {
            console.log(`  [${elapsed}s] → Filling Microsoft email`);
            await emailField.fill(MS_EMAIL);
            await page.waitForTimeout(500);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(4000);
            continue;
          }
        }
        const yesBtn = await page.$('input[value="Yes"]');
        if (yesBtn) { await yesBtn.click(); await page.waitForTimeout(3000); continue; }
        const passField = await page.$('input[type="password"][name="passwd"]');
        if (passField && MS_PASS) {
          console.log(`  [${elapsed}s] → Filling Microsoft password`);
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          await page.click('input[type="submit"]');
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // Okta
    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) {
          const val = await userField.inputValue();
          if (!val) {
            console.log(`  [${elapsed}s] → Filling Okta username`);
            await userField.fill(OKTA_USER);
            await page.waitForTimeout(500);
          }
        }
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) {
          const val = await passField.inputValue();
          if (!val && MS_PASS) {
            console.log(`  [${elapsed}s] → Filling Okta password`);
            await passField.fill(MS_PASS);
            await page.waitForTimeout(500);
            const signIn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
            if (signIn) await signIn.click();
            await page.waitForTimeout(5000);
          }
        }
      } catch (e) { /* ignore */ }

      // Okta MFA push
      try {
        const pushBtn = await page.$('input[value="Send Push"], a.send-push');
        if (pushBtn) {
          console.log(`  [${elapsed}s] → Sending Okta push (approve on phone!)`);
          await pushBtn.click();
          await page.waitForTimeout(10000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    console.log(`  [${elapsed}s] Waiting... (${url.substring(0, 60)})`);
  }
  return false;
}

(async () => {
  console.log('=== ADO Wiki Diagnostic ===\n');
  console.log('Session dir:', SESSION_DIR);
  console.log('Session exists:', fs.existsSync(SESSION_DIR));

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1280, height: 720 }
  });
  const page = await browser.newPage();

  console.log('\n1. Navigating to ADO...');
  await page.goto('https://dev.azure.com/oncologyanalytics/newUM', { waitUntil: 'networkidle', timeout: 60000 });
  
  const url = page.url();
  if (!url.includes('dev.azure.com') || url.includes('login')) {
    console.log('Need to authenticate...');
    await waitForAuth(page);
  }
  
  console.log('Current URL:', page.url());
  await page.waitForTimeout(2000);

  // Test endpoints
  const endpoints = [
    { label: 'Wiki list (project)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/wiki/wikis?api-version=7.0' },
    { label: 'Wiki list (org)', url: 'https://dev.azure.com/oncologyanalytics/_apis/wiki/wikis?api-version=7.0' },
    { label: 'Wiki list (preview)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/wiki/wikis?api-version=7.1-preview.2' },
    { label: 'Git repos', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/git/repositories?api-version=7.0' },
    { label: 'Git repos (org)', url: 'https://dev.azure.com/oncologyanalytics/_apis/git/repositories?api-version=7.0' },
    { label: 'Projects', url: 'https://dev.azure.com/oncologyanalytics/_apis/projects?api-version=7.0' },
  ];

  console.log('\n2. Testing endpoints...\n');
  for (const ep of endpoints) {
    const result = await page.evaluate(async (fetchUrl) => {
      try {
        const res = await fetch(fetchUrl, { credentials: 'include' });
        const text = await res.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = null; }
        return {
          status: res.status,
          statusText: res.statusText,
          count: parsed?.count ?? parsed?.value?.length ?? null,
          body: text.substring(0, 800)
        };
      } catch (e) { return { error: e.message }; }
    }, ep.url);

    console.log(`─── ${ep.label} ───`);
    console.log(`  Status: ${result.status} ${result.statusText}`);
    console.log(`  Count: ${result.count}`);
    if (result.status !== 200) {
      console.log(`  Body: ${result.body?.substring(0, 300)}`);
    } else {
      // show value names if available
      try {
        const parsed = JSON.parse(result.body);
        if (parsed.value) {
          for (const v of parsed.value.slice(0, 10)) {
            console.log(`    - ${v.name || v.id} (type: ${v.type || v.projectVisibility || '?'})`);
          }
        }
      } catch {}
    }
    console.log();
  }

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
