/**
 * SharePoint File Downloader + Content Extractor
 * 
 * Downloads .xlsx and .docx files from SharePoint using Playwright (Okta SSO session),
 * then extracts content using exceljs and mammoth.
 *
 * Usage:
 *   node scrape-sharepoint-download.js          # download + extract both files
 *   node scrape-sharepoint-download.js raid      # just RAID.xlsx
 *   node scrape-sharepoint-download.js cr        # just Change Request.docx
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');

const OUT_DIR = path.join(__dirname, 'output', 'onboarding-content');
const DOWNLOAD_DIR = path.join(__dirname, 'output', 'downloads');
const SESSION_DIR = path.join(__dirname, '.playwright-session-okta');

// Load .env (respect existing env vars)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.+)$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const MS_EMAIL = process.env.MS_USERNAME;
const MS_PASS = process.env.MS_PASSWORD;
const OKTA_USER = MS_EMAIL ? MS_EMAIL.split('@')[0] : '';

const FILES = [
  {
    key: 'raid',
    name: 'newUM_RAID.xlsx',
    outName: '07-sharepoint-raid',
    // SharePoint sharing URL → convert to download URL
    viewUrl: 'https://oncologyanalyticsinc.sharepoint.com/:x:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx?d=w2dea0b03cf3c4e6ab0213a70c77834bf&csf=1&web=1&e=34bSYZ',
    downloadUrl: 'https://oncologyanalyticsinc.sharepoint.com/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/newUM_RAID.xlsx',
    type: 'xlsx',
  },
  {
    key: 'cr',
    name: 'NewUM_Change Request.docx',
    outName: '08-sharepoint-change-request',
    viewUrl: 'https://oncologyanalyticsinc.sharepoint.com/:w:/r/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx?d=w490ff8ed484b4e358d8669d9ea4360ec&csf=1&web=1&e=cvAcbB',
    downloadUrl: 'https://oncologyanalyticsinc.sharepoint.com/sites/OncoHealth_NewFire/Shared%20Documents/Project%20Management/NewUM_Change%20Request.docx',
    type: 'docx',
  },
];

async function handleAuth(page) {
  for (let round = 0; round < 12; round++) {
    const url = page.url();
    console.log(`  [Auth round ${round}] URL: ${url.substring(0, 80)}...`);

    // Microsoft login
    if (url.includes('login.microsoftonline.com') || url.includes('login.microsoft.com')) {
      // Take debug screenshot
      await page.screenshot({ path: path.join(OUT_DIR, '_sharepoint-auth-debug.png') }).catch(() => {});
      const body = await page.evaluate(() => document.body.innerText).catch(() => '');
      console.log(`  Page text (first 200): ${body.substring(0, 200).replace(/\n/g, ' ')}`);

      try {
        // "Pick an account" page — MUST check first (before email field)
        const accountTile = await page.$('div[data-test-id], .table div.row');
        const hasPickText = body.replace(/\s+/g, ' ').includes('Pick an account') ||
                           body.toLowerCase().includes('pick an account') ||
                           await page.$('div#loginHeader:has-text("Pick")').catch(() => null);
        if (hasPickText || accountTile) {
          console.log('  → "Pick an account" page — clicking account...');
          // Try clicking the email text directly
          try {
            await page.click(`text=${MS_EMAIL}`, { timeout: 3000 });
            console.log('  → Clicked account tile');
            await page.waitForTimeout(5000);
            continue;
          } catch (e1) {
            // Try clicking the first account div
            try {
              const tile = await page.$('.table div[data-test-id]');
              if (tile) { await tile.click(); await page.waitForTimeout(5000); continue; }
            } catch (e2) { /* ignore */ }
            // Try clicking any small element with the email
            try {
              const small = await page.$(`small:has-text("${MS_EMAIL.split('@')[0]}")`);
              if (small) { await small.click(); await page.waitForTimeout(5000); continue; }
            } catch (e3) { /* ignore */ }
          }
        }

        // Check for visible email field
        const emailField = await page.$('input[type="email"]:visible, input[name="loginfmt"]:visible');
        if (emailField) {
          console.log(`  → Filling Microsoft email: ${MS_EMAIL}`);
          await emailField.fill(MS_EMAIL);
          await page.waitForTimeout(500);
          const nextBtn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
          if (nextBtn) { await nextBtn.click(); await page.waitForTimeout(3000); }
          continue;
        }

        // Check for visible password field
        const passField = await page.$('input[type="password"]:visible, input[name="passwd"]:visible');
        if (passField) {
          console.log('  → Filling Microsoft password');
          await passField.fill(MS_PASS);
          await page.waitForTimeout(500);
          const submitBtn = await page.$('input[type="submit"]:visible, button[type="submit"]:visible, #idSIButton9:visible');
          if (submitBtn) { await submitBtn.click(); await page.waitForTimeout(3000); }
          continue;
        }

        // "Stay signed in?" / "Do you want to stay signed in?" prompt
        if (body.includes('Stay signed in') || body.includes('stay signed in')) {
          console.log('  → "Stay signed in?" prompt — clicking Yes');
          const yesBtn = await page.$('#idSIButton9:visible, input[value="Yes"]:visible');
          if (yesBtn) { await yesBtn.click(); await page.waitForTimeout(3000); continue; }
          // Fallback: click any submit button
          const anySubmit = await page.$('input[type="submit"]:visible');
          if (anySubmit) { await anySubmit.click(); await page.waitForTimeout(3000); continue; }
        }

        if (body.includes('Permissions requested') || body.includes('Accept')) {
          console.log('  → OAuth consent/redirect, waiting...');
          await page.waitForTimeout(5000);
          continue;
        }

        // No recognizable form — just wait and try again
        console.log('  → MS login page but no actionable fields, waiting...');
        await page.waitForTimeout(5000);
        continue;
      } catch (e) { console.log(`  MS auth error: ${e.message.substring(0, 80)}`); }
    }

    // Okta login
    if (url.includes('okta.com') || url.includes('sso.oncologyanalytics.com')) {
      try {
        const userField = await page.$('#okta-signin-username, input[name="username"]');
        if (userField) {
          console.log(`  → Filling Okta username: ${OKTA_USER}`);
          await userField.fill(OKTA_USER);
          const passField = await page.$('#okta-signin-password, input[name="password"]');
          if (passField) {
            console.log('  → Filling Okta password');
            await passField.fill(MS_PASS);
          }
          await page.waitForTimeout(500);
          const signInBtn = await page.$('#okta-signin-submit, input[type="submit"], button[type="submit"]');
          if (signInBtn) {
            await signInBtn.click();
            await page.waitForTimeout(5000);
            continue;
          }
        }

        // MFA push
        const body = await page.evaluate(() => document.body.innerText).catch(() => '');
        if (body.includes('Verify') || body.includes('push') || body.includes('Okta Verify')) {
          console.log('  📱 MFA push detected — approve on your phone (60s timeout)...');
          try {
            // Try clicking send push button if present
            const pushBtn = await page.$('input[value="Send Push"], button:has-text("Send Push"), a:has-text("Send Push")');
            if (pushBtn) await pushBtn.click();
          } catch (e) { /* push already sent */ }

          for (let mfa = 0; mfa < 12; mfa++) {
            await page.waitForTimeout(5000);
            const curUrl = page.url();
            if (!curUrl.includes('okta') && !curUrl.includes('sso.')) {
              console.log('  ✅ MFA approved!');
              break;
            }
          }
          continue;
        }
      } catch (e) { console.log(`  Okta auth error: ${e.message.substring(0, 80)}`); }
    }

    // Check if we're past auth
    if (!url.includes('login') && !url.includes('okta') && !url.includes('sso.') && !url.includes('microsoftonline')) {
      console.log('  ✅ Authenticated!');
      return true;
    }

    await page.waitForTimeout(3000);
  }
  console.log('  ❌ Auth timeout');
  return false;
}

async function downloadFile(page, file) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Downloading: ${file.name}`);
  console.log(`${'─'.repeat(50)}`);

  const localPath = path.join(DOWNLOAD_DIR, file.name);

  // Strategy 1: Direct download URL
  console.log('  Strategy 1: Direct download URL...');
  try {
    const response = await page.goto(file.downloadUrl, { waitUntil: 'commit', timeout: 15000 });
    const contentType = response?.headers()['content-type'] || '';
    console.log(`  Content-Type: ${contentType}`);

    // If we got the actual file (not a redirect to login or HTML page)
    if (contentType.includes('spreadsheet') || contentType.includes('document') ||
        contentType.includes('octet-stream') || contentType.includes('officedocument')) {
      const buffer = await response.body();
      fs.writeFileSync(localPath, buffer);
      console.log(`  ✅ Downloaded via direct URL: ${buffer.length} bytes`);
      return localPath;
    }
  } catch (e) {
    console.log(`  Direct download failed: ${e.message.substring(0, 80)}`);
  }

  // If redirected to auth, handle it
  if (page.url().includes('login') || page.url().includes('okta') || page.url().includes('sso.')) {
    console.log('  Auth required, logging in...');
    await handleAuth(page);
    // Retry direct download after auth
    try {
      const response = await page.goto(file.downloadUrl, { waitUntil: 'commit', timeout: 15000 });
      const contentType = response?.headers()['content-type'] || '';
      if (contentType.includes('spreadsheet') || contentType.includes('document') ||
          contentType.includes('octet-stream') || contentType.includes('officedocument')) {
        const buffer = await response.body();
        fs.writeFileSync(localPath, buffer);
        console.log(`  ✅ Downloaded via direct URL (post-auth): ${buffer.length} bytes`);
        return localPath;
      }
    } catch (e) {
      console.log(`  Direct download retry failed: ${e.message.substring(0, 60)}`);
    }
  }

  // Strategy 2: Navigate to view URL, then use Office Online's download button
  console.log('  Strategy 2: Office Online download button...');
  try {
    await page.goto(file.viewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    // Handle auth if needed
    if (page.url().includes('login') || page.url().includes('okta') || page.url().includes('sso.')) {
      await handleAuth(page);
      await page.goto(file.viewUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(5000);
    }

    // Set up download handler
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      (async () => {
        // Try File menu → Download / Save As
        // Excel Online: File → Save As → Download a Copy
        // Word Online: File → Save As → Download a Copy
        const fileTab = await page.$('[data-unique-id="FileMenu"], #FileMenu, button[name="File"], [aria-label="File"]');
        if (fileTab) {
          console.log('  → Clicking File menu...');
          await fileTab.click();
          await page.waitForTimeout(2000);

          // Look for Download or Save As
          const downloadBtn = await page.$('[data-unique-id="Download"], [data-unique-id="SaveAs"], button:has-text("Save As"), button:has-text("Download"), a:has-text("Download a Copy"), [id*="Download"]');
          if (downloadBtn) {
            console.log('  → Clicking Download...');
            await downloadBtn.click();
            await page.waitForTimeout(2000);

            // May need "Download a Copy" sub-option
            const copyBtn = await page.$('button:has-text("Download a Copy"), a:has-text("Download a Copy")');
            if (copyBtn) {
              console.log('  → Clicking "Download a Copy"...');
              await copyBtn.click();
            }
          }
        } else {
          // Fallback: try keyboard shortcut or other download triggers
          console.log('  → No File menu found, trying Ctrl+S...');
          await page.keyboard.press('Control+s');
          await page.waitForTimeout(3000);
        }
      })(),
    ]);

    const filePath = await download.path();
    if (filePath) {
      fs.copyFileSync(filePath, localPath);
      const size = fs.statSync(localPath).size;
      console.log(`  ✅ Downloaded via Office Online: ${size} bytes`);
      return localPath;
    }
  } catch (e) {
    console.log(`  Office Online download failed: ${e.message.substring(0, 80)}`);
  }

  // Strategy 3: Use SharePoint API download endpoint
  console.log('  Strategy 3: SharePoint _layouts/download.aspx...');
  const apiDownloadUrl = file.type === 'xlsx'
    ? 'https://oncologyanalyticsinc.sharepoint.com/sites/OncoHealth_NewFire/_layouts/15/download.aspx?UniqueId=2dea0b03-cf3c-4e6a-b021-3a70c77834bf'
    : 'https://oncologyanalyticsinc.sharepoint.com/sites/OncoHealth_NewFire/_layouts/15/download.aspx?UniqueId=490ff8ed-484b-4e35-8d86-69d9ea4360ec';

  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.goto(apiDownloadUrl, { timeout: 20000 }),
    ]);

    const filePath = await download.path();
    if (filePath) {
      fs.copyFileSync(filePath, localPath);
      const size = fs.statSync(localPath).size;
      console.log(`  ✅ Downloaded via _layouts: ${size} bytes`);
      return localPath;
    }
  } catch (e) {
    console.log(`  _layouts download failed: ${e.message.substring(0, 80)}`);
  }

  // Strategy 4: Use fetch with cookies from existing page context
  console.log('  Strategy 4: Fetch with session cookies...');
  try {
    // Navigate to SharePoint first to ensure cookies are set
    await page.goto('https://oncologyanalyticsinc.sharepoint.com/sites/OncoHealth_NewFire/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    if (page.url().includes('login') || page.url().includes('okta')) {
      await handleAuth(page);
    }

    // Use page.evaluate to fetch the file using browser context (with cookies)
    const base64 = await page.evaluate(async (url) => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(blob);
      });
    }, file.downloadUrl);

    const buffer = Buffer.from(base64, 'base64');
    fs.writeFileSync(localPath, buffer);
    console.log(`  ✅ Downloaded via fetch: ${buffer.length} bytes`);
    return localPath;
  } catch (e) {
    console.log(`  Fetch download failed: ${e.message.substring(0, 80)}`);
  }

  console.log(`  ❌ All download strategies failed for ${file.name}`);
  return null;
}

async function extractXlsx(filePath, outName) {
  console.log(`\n  📊 Extracting Excel content...`);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const lines = [];
  lines.push(`SharePoint RAID - newUM_RAID.xlsx`);
  lines.push(`Source: SharePoint Online (OncoHealth_NewFire) — downloaded file`);
  lines.push(`Extracted: ${new Date().toISOString()}`);
  lines.push(`Sheets: ${workbook.worksheets.map(s => s.name).join(', ')}`);
  lines.push('');

  for (const sheet of workbook.worksheets) {
    lines.push(`${'='.repeat(60)}`);
    lines.push(`SHEET: ${sheet.name}`);
    lines.push(`Rows: ${sheet.rowCount}, Columns: ${sheet.columnCount}`);
    lines.push(`${'='.repeat(60)}`);
    lines.push('');

    // Get headers from first row
    const headers = [];
    const headerRow = sheet.getRow(1);
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      headers[colNumber] = cell.text || `Col${colNumber}`;
    });

    // Process all rows
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) {
        // Header row
        const headerLine = headers.filter(Boolean).join(' | ');
        lines.push(`[Headers] ${headerLine}`);
        lines.push('-'.repeat(80));
      } else {
        const cells = [];
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const header = headers[colNumber] || `Col${colNumber}`;
          const value = cell.text || '';
          if (value.trim()) {
            cells.push(`${header}: ${value}`);
          }
        });
        if (cells.length > 0) {
          lines.push(`[Row ${rowNumber}] ${cells.join(' | ')}`);
        }
      }
    });
    lines.push('');
  }

  const content = lines.join('\n');
  const outPath = path.join(OUT_DIR, `${outName}.txt`);
  fs.writeFileSync(outPath, content, 'utf-8');
  console.log(`  ✅ Extracted ${content.length} chars → ${outName}.txt`);
  return content.length;
}

async function extractDocx(filePath, outName) {
  console.log(`\n  📝 Extracting Word content...`);

  // Extract as plain text
  const textResult = await mammoth.extractRawText({ path: filePath });
  // Also extract as HTML for structure
  const htmlResult = await mammoth.convertToHtml({ path: filePath });

  const lines = [];
  lines.push(`SharePoint Change Request - NewUM_Change Request.docx`);
  lines.push(`Source: SharePoint Online (OncoHealth_NewFire) — downloaded file`);
  lines.push(`Extracted: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('=== PLAIN TEXT CONTENT ===');
  lines.push(textResult.value);
  lines.push('');
  lines.push('=== WARNINGS ===');
  if (textResult.messages.length > 0) {
    for (const msg of textResult.messages) lines.push(`- ${msg.message}`);
  } else {
    lines.push('(none)');
  }

  const content = lines.join('\n');
  const outPath = path.join(OUT_DIR, `${outName}.txt`);
  fs.writeFileSync(outPath, content, 'utf-8');
  console.log(`  ✅ Extracted ${content.length} chars → ${outName}.txt`);

  // Also save HTML version
  const htmlPath = path.join(OUT_DIR, `${outName}.html`);
  fs.writeFileSync(htmlPath, htmlResult.value, 'utf-8');
  console.log(`  ✅ HTML version → ${outName}.html`);

  return content.length;
}

async function main() {
  const target = (process.argv[2] || 'all').toLowerCase();
  const filesToProcess = target === 'all' ? FILES : FILES.filter(f => f.key === target);

  if (filesToProcess.length === 0) {
    console.log('Usage: node scrape-sharepoint-download.js [raid|cr|all]');
    process.exit(1);
  }

  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('🚀 SharePoint File Downloader + Extractor\n');
  console.log(`Auth: ${MS_EMAIL} → Okta SSO`);
  console.log(`Files: ${filesToProcess.map(f => f.name).join(', ')}`);

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
  });

  const page = await browser.newPage();
  const results = {};

  for (const file of filesToProcess) {
    try {
      const localPath = await downloadFile(page, file);
      if (localPath && fs.existsSync(localPath)) {
        const size = fs.statSync(localPath).size;
        console.log(`\n  📦 File saved: ${localPath} (${size} bytes)`);

        // Extract content
        let chars = 0;
        if (file.type === 'xlsx') {
          chars = await extractXlsx(localPath, file.outName);
        } else if (file.type === 'docx') {
          chars = await extractDocx(localPath, file.outName);
        }
        results[file.key] = { status: 'SUCCESS', bytes: size, chars };
      } else {
        results[file.key] = { status: 'FAILED', error: 'No file downloaded' };
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}`);
      results[file.key] = { status: 'ERROR', error: e.message.substring(0, 200) };
    }
  }

  await browser.close();

  console.log('\n📋 Results:');
  for (const [key, res] of Object.entries(results)) {
    console.log(`  ${key}: ${res.status} ${res.chars ? `(${res.chars} chars)` : ''} ${res.error || ''}`);
  }

  // Save results
  fs.writeFileSync(
    path.join(OUT_DIR, '_sharepoint-download-results.json'),
    JSON.stringify(results, null, 2)
  );
}

main().catch(e => { console.error(e); process.exit(1); });
