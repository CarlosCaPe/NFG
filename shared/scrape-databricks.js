/**
 * Databricks Workspace Scraper — Uses REST API via authenticated browser session.
 *
 * Strategy: Playwright opens Databricks, auto-login via Entra ID / Okta SSO,
 * then calls Databricks REST API endpoints using browser session cookies.
 *
 * Captures:
 *   - Workspace file tree (notebooks, folders, libraries)
 *   - Notebook source code export
 *   - Clusters info
 *   - Jobs and runs
 *   - SQL warehouses
 *   - Unity Catalog (catalogs, schemas, tables)
 *   - Secrets scopes (names only, not values)
 *
 * Usage:
 *   node shared/scrape-databricks.js --client oncohealth
 *   node shared/scrape-databricks.js --client oncohealth --url https://adb-xxx.azuredatabricks.net/
 *
 * Output: clients/<client>/output/databricks/
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const OUT_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'databricks');
const SESSION_DIR = path.join(ROOT, '.playwright-session-databricks');

// Load .env
const envPath = path.join(ROOT, 'clients', CLIENT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const MS_EMAIL = process.env.MS_USERNAME || '';
const MS_PASS = process.env.MS_PASSWORD || '';
const OKTA_USER = MS_EMAIL.split('@')[0];
const DATABRICKS_TOKEN = process.env.DATABRICKS_TEST_TOKEN || '';

const urlArg = process.argv.indexOf('--url');
// Dev workspace blocked (has PHI), Test workspace accessible
const DATABRICKS_URL = urlArg !== -1
  ? process.argv[urlArg + 1]
  : (process.env.DATABRICKS_TEST_HOST || 'https://adb-2393860672770324.4.azuredatabricks.net/');

// Helper: call Databricks REST API from browser context
async function dbFetch(page, endpoint, method = 'GET', body = null) {
  const url = `${DATABRICKS_URL.replace(/\/$/, '')}/api/2.0/${endpoint}`;
  try {
    const result = await page.evaluate(async (opts) => {
      const fetchOpts = {
        method: opts.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      };
      if (opts.body) fetchOpts.body = JSON.stringify(opts.body);
      const res = await fetch(opts.url, fetchOpts);
      if (!res.ok) return { _error: true, status: res.status, statusText: res.statusText };
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    }, { url, method, body });
    return result;
  } catch (e) {
    return { _error: true, message: e.message };
  }
}

// Unity Catalog uses API 2.1
async function ucFetch(page, endpoint) {
  const url = `${DATABRICKS_URL.replace(/\/$/, '')}/api/2.1/unity-catalog/${endpoint}`;
  try {
    const result = await page.evaluate(async (fetchUrl) => {
      const res = await fetch(fetchUrl, { credentials: 'include' });
      if (!res.ok) return { _error: true, status: res.status, statusText: res.statusText };
      return await res.json();
    }, url);
    return result;
  } catch (e) {
    return { _error: true, message: e.message };
  }
}

function save(name, data) {
  const filePath = path.join(OUT_DIR, name);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, 'utf-8');
  const size = Buffer.byteLength(content, 'utf-8');
  console.log(`  → ${name} (${size.toLocaleString()} bytes)`);
  return size;
}

async function waitForAuth(page, maxWaitMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(3000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 3000) || '');
    const elapsed = Math.round((Date.now() - start) / 1000);

    // Databricks "Continue with Entra ID" button
    if (url.includes('databricks.net') && (bodyText.includes('Continue with') || bodyText.includes('Sign in'))) {
      try {
        const entraBtn = await page.$('button:has-text("Continue"), button:has-text("Entra"), a:has-text("Continue"), a:has-text("Entra")');
        if (entraBtn) {
          console.log(`  [${elapsed}s] → Clicking "Continue with Entra ID"`);
          await entraBtn.click();
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // Microsoft login: enter email
    if (url.includes('login.microsoftonline.com')) {
      try {
        const emailField = await page.$('input[type="email"], input[name="loginfmt"]');
        if (emailField) {
          const val = await emailField.inputValue();
          if (!val && MS_EMAIL) {
            console.log(`  [${elapsed}s] → Filling Microsoft email: ${MS_EMAIL}`);
            await emailField.fill(MS_EMAIL);
            await page.waitForTimeout(500);
            await page.click('input[type="submit"]');
            await page.waitForTimeout(4000);
            continue;
          }
        }
      } catch (e) { /* ignore */ }

      // "Pick an account" — click on our account
      try {
        const accountTile = await page.$(`div[data-test-id="${MS_EMAIL}"], div:has-text("${MS_EMAIL}")`);
        if (accountTile) {
          console.log(`  [${elapsed}s] → Selecting account: ${MS_EMAIL}`);
          await accountTile.click();
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // Stay signed in? Yes
      try {
        const yesBtn = await page.$('input[value="Yes"]');
        if (yesBtn) {
          console.log(`  [${elapsed}s] → Clicking "Stay signed in? Yes"`);
          await yesBtn.click();
          await page.waitForTimeout(3000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // Microsoft password
      try {
        const passField = await page.$('input[type="password"][name="passwd"]');
        if (passField) {
          console.log(`  [${elapsed}s] → Filling Microsoft password`);
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          await page.click('input[type="submit"]');
          await page.waitForTimeout(4000);
          continue;
        }
      } catch (e) { /* ignore */ }
    }

    // Okta SSO
    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) {
          const val = await userField.inputValue();
          if (!val) {
            console.log(`  [${elapsed}s] → Filling Okta username: ${OKTA_USER}`);
            await userField.fill(OKTA_USER);
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) {
          const val = await passField.inputValue();
          if (!val) {
            console.log(`  [${elapsed}s] → Filling Okta password`);
            await passField.fill(MS_PASS);
          }
        }
      } catch (e) { /* ignore */ }

      try {
        const submitBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
        if (submitBtn) {
          console.log(`  [${elapsed}s] → Clicking Sign In`);
          await submitBtn.click();
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }

      if (bodyText.includes('Okta Verify') || bodyText.includes('Send push') || bodyText.includes('Push notification')) {
        try {
          const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")');
          if (pushBtn) {
            console.log(`  [${elapsed}s] → Clicking "Send Push"`);
            await pushBtn.click();
          }
        } catch (e) { /* ignore */ }
        console.log(`  [${elapsed}s] 📱 MFA: Approve Okta Verify push on phone!`);
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(5000);
          const currentUrl = page.url();
          if (!currentUrl.includes('okta') && !currentUrl.includes('sso.') && !currentUrl.includes('login.microsoftonline.com')) {
            console.log(`  ✅ MFA approved!`);
            await page.waitForTimeout(3000);
            return true;
          }
          console.log(`  [${Math.round((Date.now() - start) / 1000)}s] Waiting for MFA approval...`);
        }
      }
      continue;
    }

    // Check if Databricks is loaded
    if (url.includes('databricks.net') && !url.includes('/login') && bodyText.length > 200 &&
        !bodyText.includes('Sign in') && !bodyText.includes('Continue with')) {
      return true;
    }

    // Access denied
    if (bodyText.includes('Contact your site administrator') || bodyText.includes('request access')) {
      console.log(`  ❌ Access denied: ${bodyText.substring(0, 200)}`);
      return false;
    }

    console.log(`  [${elapsed}s] Auth: ${url.substring(0, 60)}...`);
  }
  return false;
}

// Recursively list workspace files
async function listWorkspace(page, dirPath = '/', depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return [];
  const result = await dbFetch(page, 'workspace/list', 'GET');
  // workspace/list needs path parameter via GET query
  const url = `${DATABRICKS_URL.replace(/\/$/, '')}/api/2.0/workspace/list?path=${encodeURIComponent(dirPath)}`;
  const data = await page.evaluate(async (fetchUrl) => {
    const res = await fetch(fetchUrl, { credentials: 'include' });
    if (!res.ok) return { _error: true, status: res.status };
    return await res.json();
  }, url);

  if (data._error || !data.objects) return [];

  const allObjects = [...data.objects];
  for (const obj of data.objects) {
    if (obj.object_type === 'DIRECTORY' && depth < maxDepth) {
      const children = await listWorkspace(page, obj.path, depth + 1, maxDepth);
      allObjects.push(...children);
    }
  }
  return allObjects;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Databricks Workspace Scraper (REST API)        ║');
  console.log(`║  URL: ${DATABRICKS_URL.substring(0, 43).padEnd(43)}║`);
  console.log('╚══════════════════════════════════════════════════╝');

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log(`\nNavigating to ${DATABRICKS_URL}...`);
  await page.goto(DATABRICKS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('>>> Auto-login via Entra ID / Okta SSO (3 min timeout)...');
  const authed = await waitForAuth(page);
  if (!authed) {
    console.log('❌ Authentication failed. Saving screenshot and exiting.');
    await page.screenshot({ path: path.join(OUT_DIR, '00-auth-failed.png'), fullPage: false });
    await context.close();
    process.exit(1);
  }
  console.log('✅ Authenticated!\n');

  // Screenshot of Databricks home
  await page.screenshot({ path: path.join(OUT_DIR, '00-databricks-home.png'), fullPage: false });

  const stats = { totalBytes: 0, errors: [] };

  // ═══════════════════════════════════════════════════
  // 1. WORKSPACE FILE TREE
  // ═══════════════════════════════════════════════════
  console.log('\n─── 1. WORKSPACE FILES ───');
  const workspaceFiles = await listWorkspace(page, '/', 0, 4);
  if (workspaceFiles.length > 0) {
    save('01-workspace-tree.json', workspaceFiles);
    console.log(`  Files/folders: ${workspaceFiles.length}`);

    // Summary
    const notebooks = workspaceFiles.filter(f => f.object_type === 'NOTEBOOK');
    const dirs = workspaceFiles.filter(f => f.object_type === 'DIRECTORY');
    const libs = workspaceFiles.filter(f => f.object_type === 'LIBRARY');
    const files = workspaceFiles.filter(f => f.object_type === 'FILE');
    console.log(`    Notebooks: ${notebooks.length}, Dirs: ${dirs.length}, Libraries: ${libs.length}, Files: ${files.length}`);

    // Export notebook source (first 50 notebooks)
    if (notebooks.length > 0) {
      console.log('\n  Exporting notebook sources...');
      const notebookSources = [];
      for (const nb of notebooks.slice(0, 50)) {
        const exportUrl = `${DATABRICKS_URL.replace(/\/$/, '')}/api/2.0/workspace/export?path=${encodeURIComponent(nb.path)}&format=SOURCE`;
        const exported = await page.evaluate(async (fetchUrl) => {
          const res = await fetch(fetchUrl, { credentials: 'include' });
          if (!res.ok) return { _error: true, status: res.status };
          return await res.json();
        }, exportUrl);

        if (!exported._error && exported.content) {
          const decoded = Buffer.from(exported.content, 'base64').toString('utf-8');
          notebookSources.push({ path: nb.path, language: nb.language, content: decoded });
          console.log(`    ✓ ${nb.path} (${decoded.length} chars)`);
        }
      }
      if (notebookSources.length > 0) {
        save('01-notebook-sources.json', notebookSources);

        // Also save as readable text
        let text = `# Databricks Notebook Sources\nExported: ${new Date().toISOString()}\nNotebooks: ${notebookSources.length}\n\n`;
        for (const nb of notebookSources) {
          text += `\n${'═'.repeat(60)}\n## ${nb.path} (${nb.language})\n${'═'.repeat(60)}\n\n${nb.content}\n`;
        }
        save('01-notebook-sources.txt', text);
      }
    }
  } else {
    console.log('  No workspace files found (may need permissions)');
    stats.errors.push({ section: 'workspace', error: 'no files' });
  }

  // ═══════════════════════════════════════════════════
  // 2. CLUSTERS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 2. CLUSTERS ───');
  const clusters = await dbFetch(page, 'clusters/list');
  if (!clusters._error && clusters.clusters) {
    save('02-clusters.json', clusters);
    console.log(`  Clusters: ${clusters.clusters.length}`);
    for (const c of clusters.clusters) {
      console.log(`    - ${c.cluster_name} (${c.state}, ${c.spark_version})`);
    }
  } else {
    console.log(`  ⚠ ${clusters.status || clusters.message || 'No clusters or no access'}`);
    if (clusters._error) stats.errors.push({ section: 'clusters', error: clusters });
  }

  // ═══════════════════════════════════════════════════
  // 3. JOBS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 3. JOBS ───');
  const jobs = await dbFetch(page, 'jobs/list');
  if (!jobs._error && jobs.jobs) {
    save('03-jobs.json', jobs);
    console.log(`  Jobs: ${jobs.jobs.length}`);
    for (const j of jobs.jobs.slice(0, 20)) {
      console.log(`    - ${j.settings?.name || j.job_id}`);
    }
  } else if (!jobs._error && !jobs.jobs) {
    console.log('  No jobs found');
  } else {
    console.log(`  ⚠ ${jobs.status || jobs.message || 'No access'}`);
    if (jobs._error) stats.errors.push({ section: 'jobs', error: jobs });
  }

  // ═══════════════════════════════════════════════════
  // 4. SQL WAREHOUSES
  // ═══════════════════════════════════════════════════
  console.log('\n─── 4. SQL WAREHOUSES ───');
  const warehouses = await dbFetch(page, 'sql/warehouses');
  if (!warehouses._error && warehouses.warehouses) {
    save('04-sql-warehouses.json', warehouses);
    console.log(`  Warehouses: ${warehouses.warehouses.length}`);
  } else {
    console.log(`  ⚠ ${warehouses.status || warehouses.message || 'No warehouses'}`);
  }

  // ═══════════════════════════════════════════════════
  // 5. UNITY CATALOG
  // ═══════════════════════════════════════════════════
  console.log('\n─── 5. UNITY CATALOG ───');

  // 5a. Catalogs
  const catalogs = await ucFetch(page, 'catalogs');
  if (!catalogs._error && catalogs.catalogs) {
    save('05-catalogs.json', catalogs);
    console.log(`  Catalogs: ${catalogs.catalogs.length}`);

    // 5b. Schemas per catalog
    for (const cat of catalogs.catalogs) {
      console.log(`\n  📦 Catalog: ${cat.name}`);
      const schemas = await ucFetch(page, `schemas?catalog_name=${encodeURIComponent(cat.name)}`);
      if (!schemas._error && schemas.schemas) {
        const slug = cat.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        save(`05-catalog-${slug}-schemas.json`, schemas);
        console.log(`    Schemas: ${schemas.schemas.length}`);

        // 5c. Tables per schema
        for (const schema of schemas.schemas) {
          const tables = await ucFetch(page, `tables?catalog_name=${encodeURIComponent(cat.name)}&schema_name=${encodeURIComponent(schema.name)}`);
          if (!tables._error && tables.tables) {
            const schemaSlug = `${slug}-${schema.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
            save(`05-catalog-${schemaSlug}-tables.json`, tables);
            console.log(`      ${schema.name}: ${tables.tables.length} tables`);
          }
        }
      }
    }
  } else {
    console.log(`  ⚠ ${catalogs.status || catalogs.message || 'No catalogs or no access'}`);
    if (catalogs._error) stats.errors.push({ section: 'unity-catalog', error: catalogs });
  }

  // ═══════════════════════════════════════════════════
  // 6. SECRET SCOPES (names only)
  // ═══════════════════════════════════════════════════
  console.log('\n─── 6. SECRET SCOPES ───');
  const scopes = await dbFetch(page, 'secrets/scopes/list');
  if (!scopes._error && scopes.scopes) {
    save('06-secret-scopes.json', scopes);
    console.log(`  Scopes: ${scopes.scopes.length}`);
  } else {
    console.log(`  ⚠ ${scopes.status || scopes.message || 'No scopes'}`);
  }

  // ═══════════════════════════════════════════════════
  // 7. INSTANCE POOLS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 7. INSTANCE POOLS ───');
  const pools = await dbFetch(page, 'instance-pools/list');
  if (!pools._error && pools.instance_pools) {
    save('07-instance-pools.json', pools);
    console.log(`  Pools: ${pools.instance_pools.length}`);
  } else {
    console.log(`  ⚠ No pools or no access`);
  }

  // ═══════════════════════════════════════════════════
  // 8. PAGE TEXT CAPTURE (fallback — visible content)
  // ═══════════════════════════════════════════════════
  console.log('\n─── 8. PAGE CONTENT ───');
  const pageText = await page.evaluate(() => document.body?.innerText || '');
  save('08-page-text.txt', pageText);
  console.log(`  Page text: ${pageText.length} chars`);

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(50));
  console.log('  DATABRICKS CAPTURE SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  URL: ${DATABRICKS_URL}`);
  const files = fs.readdirSync(OUT_DIR);
  let totalSize = 0;
  for (const f of files) {
    totalSize += fs.statSync(path.join(OUT_DIR, f)).size;
  }
  console.log(`  Files: ${files.length}`);
  console.log(`  Total size: ${(totalSize / 1024).toFixed(1)} KB`);
  if (stats.errors.length > 0) {
    console.log(`  Errors: ${stats.errors.length}`);
    for (const e of stats.errors) {
      console.log(`    - ${e.section}: ${JSON.stringify(e.error).substring(0, 80)}`);
    }
  }

  save('_capture-summary.json', {
    captured: new Date().toISOString(),
    url: DATABRICKS_URL,
    files: files.length + 1,
    totalBytes: totalSize,
    errors: stats.errors,
  });

  console.log('\n>>> Closing browser in 5 seconds...');
  await page.waitForTimeout(5000);
  await context.close();
  console.log('Done.');
})();
