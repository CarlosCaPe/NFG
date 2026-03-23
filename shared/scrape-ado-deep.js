/**
 * Azure DevOps Deep Scraper — Uses REST API via authenticated browser session.
 *
 * Strategy: Playwright opens ADO, user authenticates via Okta SSO,
 * then we call ADO REST APIs using the browser session cookies.
 * This yields structured JSON data — much richer than HTML scraping.
 *
 * Captures:
 *   - Project overview & properties
 *   - Git repositories (list, branches, README, file trees)
 *   - Work items (epics, features, user stories, tasks, bugs)
 *   - Boards & iterations
 *   - Pipelines & recent builds
 *   - Wiki pages (if accessible)
 *
 * Usage:
 *   node shared/scrape-ado-deep.js --client oncohealth
 *
 * Output: clients/<client>/output/ado/
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const OUT_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'ado');
const SESSION_DIR = path.join(ROOT, '.playwright-session-ado');

// Load .env
const envPath = path.join(ROOT, 'clients', CLIENT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}
const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = (MS_EMAIL || '').split('@')[0];

const ORG = 'oncologyanalytics';
const PROJECT = 'newUM';
const BASE = `https://dev.azure.com/${ORG}/${PROJECT}`;
const API = `https://dev.azure.com/${ORG}/${PROJECT}/_apis`;
const API_VER = 'api-version=7.0';

// Helper: call ADO REST API from browser context
async function adoFetch(page, endpoint, params = '') {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${API}/${endpoint}${sep}${API_VER}${params ? '&' + params : ''}`;
  try {
    const result = await page.evaluate(async (fetchUrl) => {
      const res = await fetch(fetchUrl, { credentials: 'include' });
      if (!res.ok) return { _error: true, status: res.status, statusText: res.statusText, url: fetchUrl };
      const text = await res.text();
      try { return JSON.parse(text); } catch { return { _raw: text }; }
    }, url);
    return result;
  } catch (e) {
    return { _error: true, message: e.message };
  }
}

// Helper: call org-level API
async function adoOrgFetch(page, endpoint, params = '') {
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `https://dev.azure.com/${ORG}/_apis/${endpoint}${sep}${API_VER}${params ? '&' + params : ''}`;
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

    // ---- Microsoft login: enter email ----
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

      // "Stay signed in?" 
      try {
        const yesBtn = await page.$('input[value="Yes"]');
        if (yesBtn) {
          console.log(`  [${elapsed}s] → Clicking "Stay signed in? Yes"`);
          await yesBtn.click();
          await page.waitForTimeout(3000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // Password on Microsoft
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

    // ---- Okta SSO ----
    if (url.includes('sso.oncologyanalytics.com') || url.includes('okta.com')) {
      // Username
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"], input[name="identifier"]');
        if (userField) {
          const val = await userField.inputValue();
          if (!val) {
            console.log(`  [${elapsed}s] → Filling Okta username: ${OKTA_USER}`);
            await userField.fill(OKTA_USER);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      // Password
      try {
        const passField = await page.$('#okta-signin-password, input[name="password"], input[type="password"]');
        if (passField) {
          const val = await passField.inputValue();
          if (!val) {
            console.log(`  [${elapsed}s] → Filling Okta password`);
            await passField.fill(MS_PASS);
            await page.waitForTimeout(500);
          }
        }
      } catch (e) { /* ignore */ }

      // Submit
      try {
        const submitBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
        if (submitBtn) {
          console.log(`  [${elapsed}s] → Clicking Sign In`);
          await submitBtn.click();
          await page.waitForTimeout(5000);
          continue;
        }
      } catch (e) { /* ignore */ }

      // MFA push
      if (bodyText.includes('Okta Verify') || bodyText.includes('Send push') || bodyText.includes('Push notification')) {
        try {
          const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")');
          if (pushBtn) {
            console.log(`  [${elapsed}s] → Clicking "Send Push"`);
            await pushBtn.click();
          }
        } catch (e) { /* ignore */ }
        console.log(`  [${elapsed}s] 📱 MFA: Approve Okta Verify push on your phone!`);
        for (let i = 0; i < 12; i++) {
          await page.waitForTimeout(5000);
          const currentUrl = page.url();
          if (!currentUrl.includes('okta') && !currentUrl.includes('sso.oncologyanalytics.com') && !currentUrl.includes('login.microsoftonline.com')) {
            console.log(`  ✅ MFA approved!`);
            await page.waitForTimeout(3000);
            return true;
          }
          console.log(`  [${Math.round((Date.now() - start) / 1000)}s] Waiting for MFA approval...`);
        }
      }
      continue;
    }

    // Auto-click "Stay signed in? Yes" (can appear after Okta redirect)
    try {
      const yesBtn = await page.$('input[value="Yes"]');
      if (yesBtn) { await yesBtn.click(); await page.waitForTimeout(3000); continue; }
    } catch {}

    // Check if we're on ADO (authenticated)
    if (url.includes('dev.azure.com') && bodyText.length > 200 && !bodyText.includes('Sign in')) {
      return true;
    }

    console.log(`  [${elapsed}s] Auth: ${url.substring(0, 60)}...`);
  }
  return false;
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Azure DevOps Deep Scraper (REST API)           ║');
  console.log(`║  Org: ${ORG} / Project: ${PROJECT}              ║`);
  console.log('╚══════════════════════════════════════════════════╝');

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  // Navigate to ADO
  console.log(`\nNavigating to ${BASE}...`);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });

  console.log('>>> Authenticate via Okta SSO if prompted (3 min timeout)...');
  const authed = await waitForAuth(page);
  if (!authed) {
    console.log('❌ Authentication timed out. Exiting.');
    await context.close();
    process.exit(1);
  }
  console.log('✅ Authenticated!\n');

  // Screenshot of project home
  await page.screenshot({ path: path.join(OUT_DIR, '00-project-home.png'), fullPage: false });

  const stats = { sections: {}, totalBytes: 0, errors: [] };

  // ═══════════════════════════════════════════════════
  // 1. PROJECT INFO
  // ═══════════════════════════════════════════════════
  console.log('\n─── 1. PROJECT INFO ───');
  const projectInfo = await adoOrgFetch(page, `projects/${PROJECT}`);
  if (!projectInfo._error) {
    stats.sections.project = save('01-project-info.json', projectInfo);
    stats.totalBytes += stats.sections.project;
  } else {
    console.log(`  ⚠ ${projectInfo.status || projectInfo.message}`);
    stats.errors.push({ section: 'project', error: projectInfo });
  }

  // ═══════════════════════════════════════════════════
  // 2. GIT REPOSITORIES
  // ═══════════════════════════════════════════════════
  console.log('\n─── 2. GIT REPOSITORIES ───');
  const repos = await adoFetch(page, 'git/repositories');
  if (!repos._error && repos.value) {
    save('02-repos-list.json', repos);
    console.log(`  Found ${repos.value.length} repo(s)`);

    for (const repo of repos.value) {
      const repoSlug = repo.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      console.log(`\n  📦 Repo: ${repo.name} (${repo.defaultBranch || 'no default branch'})`);

      // Branches
      const branches = await adoFetch(page, `git/repositories/${repo.id}/refs?filter=heads/`);
      if (!branches._error && branches.value) {
        save(`02-repo-${repoSlug}-branches.json`, branches);
        console.log(`    Branches: ${branches.value.length}`);
      }

      // File tree (top 2 levels)
      const items = await adoFetch(page, `git/repositories/${repo.id}/items`, 'recursionLevel=OneLevel&scopePath=/');
      if (!items._error && items.value) {
        save(`02-repo-${repoSlug}-tree.json`, items);
        console.log(`    Root items: ${items.value.length}`);

        // Get deeper tree for important dirs (src, tests, docs, etc.)
        const topDirs = items.value.filter(i => i.isFolder && !i.path.startsWith('/.'));
        for (const dir of topDirs.slice(0, 10)) {
          const subItems = await adoFetch(page, `git/repositories/${repo.id}/items`, `recursionLevel=OneLevel&scopePath=${encodeURIComponent(dir.path)}`);
          if (!subItems._error && subItems.value) {
            const dirName = dir.path.replace(/^\//, '').replace(/\//g, '_');
            save(`02-repo-${repoSlug}-tree-${dirName}.json`, subItems);
          }
        }
      }

      // README
      const readme = await adoFetch(page, `git/repositories/${repo.id}/items`, 'scopePath=/README.md');
      if (!readme._error && !readme._raw?.includes('404')) {
        const readmeContent = readme._raw || JSON.stringify(readme, null, 2);
        save(`02-repo-${repoSlug}-README.md`, readmeContent);
      }

      // Key config files
      for (const configFile of ['.gitignore', 'package.json', 'Directory.Build.props', 'global.json', '.editorconfig', 'docker-compose.yml', 'Dockerfile']) {
        const cfg = await adoFetch(page, `git/repositories/${repo.id}/items`, `scopePath=/${configFile}`);
        if (!cfg._error && cfg._raw && !cfg._raw.includes('404') && !cfg.message) {
          save(`02-repo-${repoSlug}-${configFile.replace(/[.]/g, '_')}`, cfg._raw || JSON.stringify(cfg));
        }
      }
    }
    stats.sections.repos = repos.value.length;
  } else {
    console.log(`  ⚠ ${repos.status || repos.message || 'No repos found'}`);
    stats.errors.push({ section: 'repos', error: repos });
  }

  // ═══════════════════════════════════════════════════
  // 3. WORK ITEMS — Epics, Features, User Stories, Tasks, Bugs
  // ═══════════════════════════════════════════════════
  console.log('\n─── 3. WORK ITEMS ───');
  const workItemTypes = ['Epic', 'Feature', 'User Story', 'Task', 'Bug'];

  for (const wiType of workItemTypes) {
    const query = {
      query: `SELECT [System.Id],[System.Title],[System.State],[System.AssignedTo],[System.CreatedDate],[System.Tags],[System.IterationPath],[System.AreaPath],[Microsoft.VSTS.Common.Priority] FROM WorkItems WHERE [System.TeamProject] = '${PROJECT}' AND [System.WorkItemType] = '${wiType}' ORDER BY [System.CreatedDate] DESC`
    };

    const wiql = await page.evaluate(async (opts) => {
      const res = await fetch(opts.url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts.body)
      });
      if (!res.ok) return { _error: true, status: res.status };
      return await res.json();
    }, { url: `${API}/wit/wiql?${API_VER}`, body: query });

    if (!wiql._error && wiql.workItems) {
      console.log(`  ${wiType}: ${wiql.workItems.length} items`);

      if (wiql.workItems.length > 0) {
        // Fetch details in batches of 200
        const allDetails = [];
        const ids = wiql.workItems.map(wi => wi.id);
        for (let i = 0; i < ids.length; i += 200) {
          const batch = ids.slice(i, i + 200);
          const details = await page.evaluate(async (opts) => {
            const res = await fetch(opts.url, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(opts.body)
            });
            if (!res.ok) return { _error: true, status: res.status };
            return await res.json();
          }, {
            url: `${API}/wit/workitemsbatch?${API_VER}`,
            body: {
              ids: batch,
              fields: [
                'System.Id', 'System.Title', 'System.State', 'System.WorkItemType',
                'System.AssignedTo', 'System.CreatedDate', 'System.ChangedDate',
                'System.Tags', 'System.IterationPath', 'System.AreaPath',
                'System.Description', 'Microsoft.VSTS.Common.AcceptanceCriteria',
                'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.Scheduling.StoryPoints',
                'System.Parent'
              ]
            }
          });

          if (!details._error && details.value) {
            allDetails.push(...details.value);
          }
        }

        const slug = wiType.toLowerCase().replace(/\s/g, '-');
        const bytes = save(`03-workitems-${slug}.json`, { count: allDetails.length, items: allDetails });
        stats.totalBytes += bytes;

        // Also save a readable text summary
        const lines = allDetails.map(wi => {
          const f = wi.fields;
          const assigned = f['System.AssignedTo']?.displayName || 'Unassigned';
          const state = f['System.State'] || '?';
          const title = f['System.Title'] || '?';
          const priority = f['Microsoft.VSTS.Common.Priority'] || '';
          const points = f['Microsoft.VSTS.Scheduling.StoryPoints'] || '';
          const tags = f['System.Tags'] || '';
          const iter = f['System.IterationPath'] || '';
          return `[${state}] #${wi.id} ${title} | ${assigned} | P${priority} | ${points}pts | ${iter} | ${tags}`;
        });
        save(`03-workitems-${slug}.txt`, `${wiType}s (${allDetails.length})\n${'='.repeat(60)}\n${lines.join('\n')}`);
      }
    } else {
      console.log(`  ${wiType}: ⚠ ${wiql.status || wiql.message || 'failed'}`);
      stats.errors.push({ section: `workitems-${wiType}`, error: wiql });
    }
  }

  // ═══════════════════════════════════════════════════
  // 4. ITERATIONS (SPRINTS)
  // ═══════════════════════════════════════════════════
  console.log('\n─── 4. ITERATIONS / SPRINTS ───');
  const iterations = await adoFetch(page, 'work/teamsettings/iterations');
  if (!iterations._error && iterations.value) {
    save('04-iterations.json', iterations);
    console.log(`  Iterations: ${iterations.value.length}`);
    stats.sections.iterations = iterations.value.length;

    const iterSummary = iterations.value.map(it => {
      const start = it.attributes?.startDate ? new Date(it.attributes.startDate).toISOString().split('T')[0] : '?';
      const end = it.attributes?.finishDate ? new Date(it.attributes.finishDate).toISOString().split('T')[0] : '?';
      return `${it.name} | ${start} → ${end} | ${it.attributes?.timeFrame || ''}`;
    });
    save('04-iterations.txt', `Iterations (${iterations.value.length})\n${'='.repeat(60)}\n${iterSummary.join('\n')}`);
  }

  // ═══════════════════════════════════════════════════
  // 5. BOARDS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 5. BOARDS ───');
  const boards = await adoFetch(page, 'work/boards');
  if (!boards._error && boards.value) {
    save('05-boards.json', boards);
    console.log(`  Boards: ${boards.value.length}`);
    stats.sections.boards = boards.value.length;
  }

  // ═══════════════════════════════════════════════════
  // 6. PIPELINES
  // ═══════════════════════════════════════════════════
  console.log('\n─── 6. PIPELINES ───');
  const pipelines = await adoFetch(page, 'pipelines');
  if (!pipelines._error && pipelines.value) {
    save('06-pipelines.json', pipelines);
    console.log(`  Pipelines: ${pipelines.value.length}`);
    stats.sections.pipelines = pipelines.value.length;

    // Get recent runs for each pipeline
    for (const pl of pipelines.value.slice(0, 20)) {
      const runs = await adoFetch(page, `pipelines/${pl.id}/runs`, '$top=5');
      if (!runs._error && runs.value) {
        const slug = pl.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        save(`06-pipeline-${slug}-runs.json`, { pipeline: pl.name, runs: runs.value });
      }
    }
  }

  // Build definitions (classic pipelines)
  const builds = await adoFetch(page, 'build/definitions');
  if (!builds._error && builds.value) {
    save('06-build-definitions.json', builds);
    console.log(`  Build definitions: ${builds.value.length}`);
  }

  // ═══════════════════════════════════════════════════
  // 7. WIKI
  // ═══════════════════════════════════════════════════
  console.log('\n─── 7. WIKI ───');
  const wikis = await adoFetch(page, 'wiki/wikis');
  if (!wikis._error && wikis.value && wikis.value.length > 0) {
    save('07-wikis-list.json', wikis);
    console.log(`  Wikis: ${wikis.value.length}`);

    for (const wiki of wikis.value) {
      console.log(`  📖 Wiki: ${wiki.name} (type: ${wiki.type})`);

      // Get all pages
      const pages = await adoFetch(page, `wiki/wikis/${wiki.id}/pages`, 'recursionLevel=full&includeContent=true');
      if (!pages._error) {
        const slug = wiki.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const bytes = save(`07-wiki-${slug}-pages.json`, pages);
        stats.totalBytes += bytes;

        // Extract text content from all pages
        const extractPages = (pg, depth = 0) => {
          let text = '';
          if (pg.content) {
            text += `${'#'.repeat(Math.min(depth + 1, 6))} ${pg.path || 'Home'}\n\n${pg.content}\n\n`;
          }
          if (pg.subPages) {
            for (const sub of pg.subPages) {
              text += extractPages(sub, depth + 1);
            }
          }
          return text;
        };
        const wikiText = extractPages(pages);
        if (wikiText.length > 10) {
          save(`07-wiki-${slug}-full.md`, wikiText);
        }
      } else {
        console.log(`    ⚠ Pages: ${pages.status || pages.message}`);
        stats.errors.push({ section: `wiki-${wiki.name}`, error: pages });
      }
    }
  } else {
    console.log(`  ⚠ ${wikis.status || wikis.message || 'No wikis found'}`);
  }

  // ═══════════════════════════════════════════════════
  // 8. TEAMS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 8. TEAMS ───');
  const teams = await adoOrgFetch(page, `projects/${PROJECT}/teams`);
  if (!teams._error && teams.value) {
    save('08-teams.json', teams);
    console.log(`  Teams: ${teams.value.length}`);

    for (const team of teams.value) {
      const members = await adoOrgFetch(page, `projects/${PROJECT}/teams/${team.id}/members`);
      if (!members._error && members.value) {
        const slug = team.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        save(`08-team-${slug}-members.json`, members);
        console.log(`    ${team.name}: ${members.value.length} members`);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // 9. AREA PATHS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 9. AREA PATHS ───');
  const areas = await adoFetch(page, 'wit/classificationnodes/areas', '$depth=5');
  if (!areas._error) {
    save('09-area-paths.json', areas);
    console.log('  Area paths captured');
  }

  // ═══════════════════════════════════════════════════
  // 10. DASHBOARDS
  // ═══════════════════════════════════════════════════
  console.log('\n─── 10. DASHBOARDS ───');
  // Dashboard API uses a different endpoint
  const dashboards = await page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return { _error: true, status: res.status };
    return await res.json();
  }, `https://dev.azure.com/${ORG}/${PROJECT}/_apis/dashboard/dashboards?api-version=7.0-preview.3`);
  if (!dashboards._error && dashboards.dashboardEntries) {
    save('10-dashboards.json', dashboards);
    console.log(`  Dashboards: ${dashboards.dashboardEntries.length}`);
  }

  // ═══════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════
  console.log('\n\n' + '═'.repeat(50));
  console.log('  CAPTURE SUMMARY');
  console.log('═'.repeat(50));
  console.log(`  Output: ${OUT_DIR}`);
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
      console.log(`    - ${e.section}: ${e.error.status || e.error.message || 'unknown'}`);
    }
  }

  save('_capture-summary.json', {
    captured: new Date().toISOString(),
    org: ORG,
    project: PROJECT,
    files: files.length,
    totalBytes: totalSize,
    errors: stats.errors
  });

  console.log('\n>>> Closing browser in 5 seconds...');
  await page.waitForTimeout(5000);
  await context.close();
  console.log('Done.');
})();
