/**
 * ADO Wiki diagnostic — uses storageState instead of persistent context
 * (CrowdStrike blocks persistent context via esentutl.exe)
 * 
 * Run with: node shared/_test-ado-wiki-ss.js
 * First run: will open browser for manual login, saves state
 * Subsequent runs: reuses saved state
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(ROOT, '.ado-auth-state.json');

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

async function autoLogin(page) {
  const maxWaitMs = 120000;
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(3000);
    const url = page.url();
    const elapsed = Math.round((Date.now() - start) / 1000);

    // Already at ADO
    if (url.includes('dev.azure.com') && !url.includes('login') && !url.includes('_signin')) {
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
        if (yesBtn) { console.log(`  [${elapsed}s] → Stay signed in: Yes`); await yesBtn.click(); await page.waitForTimeout(3000); continue; }
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
          if (!val) { console.log(`  [${elapsed}s] → Filling Okta username`); await userField.fill(OKTA_USER); await page.waitForTimeout(500); }
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
      try {
        const pushBtn = await page.$('input[value="Send Push"], a.send-push');
        if (pushBtn) { console.log(`  [${elapsed}s] → Sending Okta push — APPROVE ON PHONE!`); await pushBtn.click(); await page.waitForTimeout(15000); continue; }
      } catch (e) { /* ignore */ }
    }

    console.log(`  [${elapsed}s] Waiting... (${url.substring(0, 80)})`);
  }
  return false;
}

(async () => {
  console.log('=== ADO Wiki Diagnostic (storageState) ===\n');

  const hasState = fs.existsSync(STATE_FILE);
  console.log('Auth state exists:', hasState);

  const browser = await chromium.launch({
    headless: false,
    channel: 'msedge'
  });

  let context;
  if (hasState) {
    console.log('Reusing saved auth state...');
    context = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1280, height: 720 } });
  } else {
    console.log('Fresh context — will need manual login');
    context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  }

  const page = await context.newPage();

  console.log('\n1. Navigating to ADO...');
  await page.goto('https://dev.azure.com/oncologyanalytics/newUM', { waitUntil: 'networkidle', timeout: 60000 });

  const url = page.url();
  console.log('Current URL:', url);

  if (!url.includes('dev.azure.com') || url.includes('login') || url.includes('_signin')) {
    console.log('\nNeed to authenticate...');
    const ok = await autoLogin(page);
    if (!ok) {
      console.log('Auth failed or timed out');
      await browser.close();
      process.exit(1);
    }
    // Save state for next time
    console.log('Saving auth state...');
    await context.storageState({ path: STATE_FILE });
    console.log('Auth state saved to', STATE_FILE);
  }

  await page.waitForTimeout(2000);

  // Test endpoints
  const endpoints = [
    { label: 'Wiki list (project-level)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/wiki/wikis?api-version=7.0' },
    { label: 'Wiki list (org-level)', url: 'https://dev.azure.com/oncologyanalytics/_apis/wiki/wikis?api-version=7.0' },
    { label: 'Wiki list (preview API)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/wiki/wikis?api-version=7.1-preview.2' },
    { label: 'Git repos (project)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/git/repositories?api-version=7.0' },
    { label: 'Git repos (org-wide)', url: 'https://dev.azure.com/oncologyanalytics/_apis/git/repositories?api-version=7.0' },
    { label: 'Projects list', url: 'https://dev.azure.com/oncologyanalytics/_apis/projects?api-version=7.0' },
    { label: 'TFVC items (project)', url: 'https://dev.azure.com/oncologyanalytics/newUM/_apis/tfvc/items?api-version=7.0' },
    { label: 'Security namespaces', url: 'https://dev.azure.com/oncologyanalytics/_apis/securitynamespaces?api-version=7.0' },
  ];

  console.log('\n2. Testing endpoints...\n');
  const results = [];
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
          items: parsed?.value?.slice(0, 10)?.map(v => ({ name: v.name, id: v.id, type: v.type, projectVisibility: v.projectVisibility, url: v.url })) ?? [],
          errorMessage: parsed?.message || null,
          body: text.substring(0, 500)
        };
      } catch (e) { return { error: e.message }; }
    }, ep.url);

    console.log(`─── ${ep.label} ───`);
    console.log(`  Status: ${result.status} ${result.statusText}`);
    if (result.count !== null) console.log(`  Count: ${result.count}`);
    if (result.errorMessage) console.log(`  Error: ${result.errorMessage}`);
    if (result.items?.length > 0) {
      for (const v of result.items) {
        console.log(`    • ${v.name || v.id} ${v.type ? '(' + v.type + ')' : ''}`);
      }
    }
    if (result.status !== 200 && !result.errorMessage) {
      console.log(`  Body: ${result.body?.substring(0, 200)}`);
    }
    console.log();
    results.push({ ...ep, ...result });
  }

  // Save state again (refreshed tokens)
  await context.storageState({ path: STATE_FILE });

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
