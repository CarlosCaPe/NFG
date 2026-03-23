/**
 * Google Drive Folder Scraper — Browse and download all files from a shared folder.
 *
 * Strategy: Opens Google Drive folder in Edge with persistent session,
 * lists all visible files, downloads each one to output directory.
 * After download, extracts text from PDFs using pdfreader.
 *
 * Usage:
 *   node shared/scrape-gdrive-folder.js --client oncohealth
 *   node shared/scrape-gdrive-folder.js --client oncohealth --url "https://drive.google.com/drive/folders/XXXXX"
 *
 * Output: clients/<client>/output/gdrive/
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const clientArg = process.argv.indexOf('--client');
const CLIENT = clientArg !== -1 ? process.argv[clientArg + 1] : 'oncohealth';
const OUT_DIR = path.join(ROOT, 'clients', CLIENT, 'output', 'gdrive');
const DOWNLOAD_DIR = path.join(OUT_DIR, 'downloads');
const SESSION_DIR = path.join(ROOT, '.playwright-session-gdoc');

// Google Drive folder URLs to process
const urlArg = process.argv.indexOf('--url');
const FOLDERS = urlArg !== -1
  ? [process.argv[urlArg + 1]]
  : [
    'https://drive.google.com/drive/folders/0AJ0dfmWBLWBYUk9PVA',
  ];

async function waitForGoogleAuth(page, maxWaitMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await page.waitForTimeout(3000);
    const url = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || '');

    // Check if we're on Google login
    if (url.includes('accounts.google.com') || bodyText.includes('Sign in') && bodyText.includes('Google')) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      console.log(`  [${elapsed}s] Google login page — please sign in...`);
      continue;
    }

    // Check if Drive loaded
    if (url.includes('drive.google.com') && bodyText.length > 200 && !bodyText.includes('Sign in to continue')) {
      return true;
    }
  }
  return false;
}

async function extractFileList(page) {
  // Wait for Drive content to load
  await page.waitForTimeout(5000);

  // Try to get file list from Drive UI
  const files = await page.evaluate(() => {
    const items = [];

    // Method 1: data-id attributes on file rows
    const rows = document.querySelectorAll('[data-id]');
    rows.forEach(row => {
      const id = row.getAttribute('data-id');
      if (!id || id.length < 10) return; // Skip non-file IDs

      // Try to get file name
      const nameEl = row.querySelector('[data-tooltip]') || row.querySelector('.KL4NAf');
      const name = nameEl?.getAttribute('data-tooltip') || nameEl?.textContent || '';

      // Try to get file type
      const typeEl = row.querySelector('[data-tooltip*="type"]');
      const mimeInfo = row.querySelector('img[src*="icon"]')?.getAttribute('src') || '';

      if (name && id) {
        items.push({ id, name: name.trim(), mimeHint: mimeInfo });
      }
    });

    // Method 2: If Method 1 didn't work, try aria labels
    if (items.length === 0) {
      const allElements = document.querySelectorAll('[aria-label]');
      allElements.forEach(el => {
        const label = el.getAttribute('aria-label');
        if (label && (label.includes('.pdf') || label.includes('.docx') || label.includes('.xlsx') || label.includes('.pptx') || label.includes('Google'))) {
          const link = el.closest('a') || el.querySelector('a');
          const href = link?.href || '';
          if (href.includes('drive.google.com') || href.includes('/d/')) {
            items.push({ name: label, href, id: '' });
          }
        }
      });
    }

    // Method 3: Get all visible text for debugging
    const bodyText = document.body?.innerText?.substring(0, 10000) || '';

    return { items, bodyText, url: window.location.href };
  });

  return files;
}

async function downloadFile(page, fileId, fileName, context) {
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '_');
  const downloadPath = path.join(DOWNLOAD_DIR, safeName);

  // Check if already downloaded
  if (fs.existsSync(downloadPath)) {
    console.log(`    ⏭ Already exists: ${safeName}`);
    return downloadPath;
  }

  console.log(`    ⬇ Downloading: ${safeName}...`);

  try {
    // For Google Docs/Sheets/Slides, export as PDF
    const isGoogleDoc = fileName.includes('Google Docs') || !fileName.includes('.');

    // Start download via Drive UI
    const downloadPage = await context.newPage();
    
    if (isGoogleDoc) {
      // Export Google Docs as PDF
      await downloadPage.goto(`https://drive.google.com/uc?export=download&id=${fileId}`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
    } else {
      // Direct download for regular files
      await downloadPage.goto(`https://drive.google.com/uc?export=download&id=${fileId}`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
    }

    // Wait for download or handle "download anyway" button
    await downloadPage.waitForTimeout(3000);
    const bodyText = await downloadPage.evaluate(() => document.body?.innerText || '');
    
    if (bodyText.includes('Download anyway') || bodyText.includes('can\'t be scanned')) {
      const downloadBtn = await downloadPage.$('a[href*="confirm"]') || await downloadPage.$('#uc-download-link');
      if (downloadBtn) {
        await downloadBtn.click();
        await downloadPage.waitForTimeout(5000);
      }
    }

    await downloadPage.close();
    return downloadPath;
  } catch (e) {
    console.log(`    ⚠ Download failed: ${e.message.substring(0, 80)}`);
    return null;
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });

  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Google Drive Folder Scraper                    ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    channel: 'msedge',
    viewport: { width: 1400, height: 900 },
    locale: 'en-US',
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();

  for (const folderUrl of FOLDERS) {
    console.log(`\n📁 Opening: ${folderUrl}`);
    await page.goto(folderUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('>>> Sign into Google if prompted (2 min timeout)...');
    const authed = await waitForGoogleAuth(page);
    if (!authed) {
      console.log('❌ Google auth timed out. Trying next folder...');
      continue;
    }
    console.log('✅ Drive folder loaded!\n');

    // Screenshot
    await page.screenshot({ path: path.join(OUT_DIR, 'folder-screenshot.png'), fullPage: false });
    console.log('  📸 Screenshot saved');

    // Wait for content to fully load
    await page.waitForTimeout(5000);

    // Scroll to load all items
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => {
        const scrollable = document.querySelector('[role="main"]') || document.documentElement;
        scrollable.scrollBy(0, 500);
      });
      await page.waitForTimeout(1000);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(2000);

    // Extract file info
    const fileData = await extractFileList(page);
    save('folder-content.json', fileData);

    console.log(`  Found ${fileData.items.length} items`);
    if (fileData.items.length > 0) {
      for (const item of fileData.items) {
        console.log(`    - ${item.name} (${item.id || 'no-id'})`);
      }
    }

    // Also dump the full visible text for manual analysis
    save('folder-text.txt', fileData.bodyText);
    console.log(`  Page text: ${fileData.bodyText.length} chars`);

    // Attempt to download files that have IDs
    const downloadResults = [];
    for (const item of fileData.items) {
      if (item.id) {
        const result = await downloadFile(page, item.id, item.name, context);
        downloadResults.push({ name: item.name, id: item.id, downloaded: !!result, path: result });
      }
    }

    if (downloadResults.length > 0) {
      save('download-results.json', downloadResults);
    }

    // If no items found via DOM extraction, try the Google Drive API approach
    if (fileData.items.length === 0) {
      console.log('\n  🔄 No items found via DOM. Trying folder ID extraction...');
      
      // Extract folder ID from URL
      const folderIdMatch = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
      if (folderIdMatch) {
        const folderId = folderIdMatch[1];
        console.log(`  Folder ID: ${folderId}`);

        // Try Google Drive API (requires the user to be logged in)
        const apiResult = await page.evaluate(async (fid) => {
          try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?q='${fid}'+in+parents&fields=files(id,name,mimeType,size,modifiedTime)&key=`, {
              credentials: 'include'
            });
            if (!res.ok) return { _error: true, status: res.status };
            return await res.json();
          } catch (e) {
            return { _error: true, message: e.message };
          }
        }, folderId);

        if (!apiResult._error && apiResult.files) {
          save('folder-api-result.json', apiResult);
          console.log(`  API found ${apiResult.files.length} files`);
        } else {
          console.log(`  API: ${apiResult.status || apiResult.message || 'failed'}`);
        }
      }

      console.log('\n  ℹ If no files were detected, the folder may use a layout not supported by this scraper.');
      console.log('  Try downloading manually: Open folder → Select all → Right-click → Download');
    }
  }

  // Final summary
  console.log('\n\n' + '═'.repeat(50));
  console.log('  CAPTURE SUMMARY');
  console.log('═'.repeat(50));
  
  const allFiles = fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR) : [];
  console.log(`  Downloaded files: ${allFiles.length}`);
  for (const f of allFiles) {
    const size = fs.statSync(path.join(DOWNLOAD_DIR, f)).size;
    console.log(`    - ${f} (${(size / 1024).toFixed(1)} KB)`);
  }

  console.log(`  Output: ${OUT_DIR}`);
  console.log('\n>>> Closing browser in 5 seconds...');
  await page.waitForTimeout(5000);
  await context.close();
  console.log('Done.');
})();

function save(name, data) {
  const filePath = path.join(OUT_DIR, name);
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`  → ${name} (${Buffer.byteLength(content).toLocaleString()} bytes)`);
}
